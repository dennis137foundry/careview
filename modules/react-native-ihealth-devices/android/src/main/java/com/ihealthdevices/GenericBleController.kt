package com.ihealthdevices

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.util.ArrayDeque
import java.util.Calendar
import java.util.UUID

/**
 * Generic BLE (Bluetooth SIG standard profile) support — currently the
 * A&D UA-651BLE blood pressure monitor and anything else speaking the standard
 * Blood Pressure Profile.
 *
 * Deliberately a SEPARATE class from IHealthDevicesModule. Nothing here touches
 * iHealthDevicesManager, and the module only routes into it for device types
 * prefixed "GATT_". The iHealth sequential-scan rotation is never running while
 * a generic capture is in progress, so the two never contend for the scanner.
 *
 * Device model this is built around (verified on real UA-651BLE hardware):
 *   - The monitor advertises ONLY in pairing mode and for roughly one minute
 *     after a completed measurement. It is invisible the rest of the time.
 *   - It powers itself off about a minute after a connection is established, so
 *     we must never hold a link open while waiting. arm() therefore uses
 *     autoConnect, which does not contact the device until it advertises.
 *   - Readings are stored on the device and pushed on the next connection, so a
 *     missed window loses nothing.
 *
 * Two Android-specific hazards this code exists to avoid, both visible as
 * unresolved issues on A&D's own sample repos:
 *   1. 0x2A35 is INDICATE, not NOTIFY. Writing ENABLE_NOTIFICATION_VALUE to the
 *      CCCD leaves you connected but silent — no data ever arrives.
 *   2. GATT operations must be serialised. Android silently drops a request
 *      issued while another is in flight, so every read/write goes through the
 *      queue below rather than being fired off back to back.
 */
class GenericBleController(
    private val context: Context,
    private val events: Events
) {

    interface Events {
        fun emit(eventName: String, params: WritableMap)
        fun debug(message: String)
        fun error(code: String, message: String)
    }

    companion object {
        private const val SOURCE = "BLE_GATT"

        // Services
        private val SERVICE_BLOOD_PRESSURE = uuid16("1810")
        private val SERVICE_WEIGHT_SCALE = uuid16("181D")
        private val SERVICE_DEVICE_INFO = uuid16("180A")
        private val SERVICE_BATTERY = uuid16("180F")

        // Characteristics
        private val CHAR_BP_MEASUREMENT = uuid16("2A35")  // Indicate
        private val CHAR_WEIGHT_MEASUREMENT = uuid16("2A9D")
        private val CHAR_DATE_TIME = uuid16("2A08")       // Read/Write — see writeDeviceTime
        private val CHAR_SYSTEM_ID = uuid16("2A23")
        private val CHAR_SERIAL_NUMBER = uuid16("2A25")
        private val CHAR_MODEL_NUMBER = uuid16("2A24")
        private val CHAR_BATTERY_LEVEL = uuid16("2A19")
        private val DESCRIPTOR_CCCD = uuid16("2902")

        // Android drops a GATT request issued while another is outstanding, and
        // gives no callback for the dropped one. If a callback never arrives the
        // queue would stall forever, so each operation gets a watchdog.
        private const val OP_TIMEOUT_MS = 6000L

        // Discovering services immediately after CONNECTED is a well-known source
        // of status-129/133 failures and, on A&D hardware, of the device hanging
        // up mid-discovery. A short settle delay is the standard mitigation.
        private const val DISCOVER_DELAY_MS = 700L

        private fun uuid16(short: String): UUID =
            UUID.fromString("0000$short-0000-1000-8000-00805F9B34FB")
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    /** Resolved via BluetoothManager; BluetoothAdapter's static getter is deprecated. */
    private fun adapter(): BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private var scanner: android.bluetooth.le.BluetoothLeScanner? = null
    private var isScanning = false

    private var gatt: BluetoothGatt? = null
    private var connectedAddress: String? = null

    /** Address we hold an autoConnect request for. Survives disconnects on purpose. */
    private var armedAddress: String? = null

    /** Address currently being provisioned (Add Device). Gets the clock write. */
    private var bondingAddress: String? = null

    private val deviceInfo = mutableMapOf<String, Any>()

    // ---- Serialised GATT operation queue -----------------------------------

    private val opQueue = ArrayDeque<Pair<String, () -> Unit>>()
    private var opInFlight: String? = null
    private val opWatchdog = Runnable {
        val stalled = opInFlight
        if (stalled != null) {
            events.debug("BLE: operation '$stalled' timed out — continuing")
            finishOp()
        }
    }

    private fun enqueueOp(label: String, op: () -> Unit) {
        mainHandler.post {
            opQueue.add(label to op)
            if (opInFlight == null) startNextOp()
        }
    }

    private fun startNextOp() {
        if (opInFlight != null) return
        val next = opQueue.poll() ?: return
        opInFlight = next.first
        mainHandler.postDelayed(opWatchdog, OP_TIMEOUT_MS)
        try {
            next.second()
        } catch (e: Exception) {
            events.debug("BLE: operation '${next.first}' threw: ${e.message}")
            finishOp()
        }
    }

    private fun finishOp() {
        mainHandler.post {
            mainHandler.removeCallbacks(opWatchdog)
            opInFlight = null
            startNextOp()
        }
    }

    private fun clearOps() {
        mainHandler.removeCallbacks(opWatchdog)
        opQueue.clear()
        opInFlight = null
    }

    // ---- Scanning ----------------------------------------------------------

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device ?: return
            val uuids = result.scanRecord?.serviceUuids ?: emptyList()

            val isBp = uuids.any { it.uuid == SERVICE_BLOOD_PRESSURE }
            val isScale = uuids.any { it.uuid == SERVICE_WEIGHT_SCALE }
            if (!isBp && !isScale) return

            val type = if (isBp) "GATT_BP" else "GATT_SCALE"
            val category = if (isBp) "BP" else "SCALE"
            val name = safeName(device) ?: result.scanRecord?.deviceName ?: ""

            events.emit("onDeviceFound", Arguments.createMap().apply {
                putString("mac", device.address)
                putString("name", if (name.isNotEmpty()) name else "BLE Blood Pressure")
                putString("type", type)
                putString("category", category)
                putInt("rssi", result.rssi)
                putString("source", SOURCE)
            })
        }

        override fun onScanFailed(errorCode: Int) {
            events.debug("BLE scan failed: $errorCode")
            isScanning = false
        }
    }

    @SuppressLint("MissingPermission")
    fun startScan() {
        if (isScanning) return
        val adapter = adapter() ?: return
        scanner = adapter.bluetoothLeScanner ?: return

        // Filter on the advertised service so we only surface medical devices,
        // never the surrounding noise of headphones and watches.
        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_BLOOD_PRESSURE)).build(),
            ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_WEIGHT_SCALE)).build()
        )
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        try {
            scanner?.startScan(filters, settings, scanCallback)
            isScanning = true
            events.debug("BLE: generic scan started (0x1810 / 0x181D)")
        } catch (e: Exception) {
            events.debug("BLE: startScan threw: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    fun stopScan() {
        if (!isScanning) return
        try {
            scanner?.stopScan(scanCallback)
        } catch (e: Exception) {
            // Adapter may have been turned off underneath us.
        }
        isScanning = false
        events.debug("BLE: generic scan stopped")
    }

    // ---- Bonding (Add Device) ----------------------------------------------

    private val bondReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            if (intent?.action != BluetoothDevice.ACTION_BOND_STATE_CHANGED) return
            val state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, -1)
            val device: BluetoothDevice? =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                }
            if (device == null) return

            when (state) {
                BluetoothDevice.BOND_BONDED -> {
                    events.debug("BLE: bonded with ${device.address}")
                    // Only now is it safe to discover services on a device whose
                    // measurement characteristic requires encryption.
                    mainHandler.postDelayed({ discoverServices() }, DISCOVER_DELAY_MS)
                }
                BluetoothDevice.BOND_NONE -> {
                    events.debug("BLE: bonding failed or was refused for ${device.address}")
                }
            }
        }
    }

    private var bondReceiverRegistered = false

    private fun registerBondReceiver() {
        if (bondReceiverRegistered) return
        context.registerReceiver(
            bondReceiver,
            IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
        )
        bondReceiverRegistered = true
    }

    fun teardown() {
        stopScan()
        clearOps()
        closeGatt()
        if (bondReceiverRegistered) {
            try {
                context.unregisterReceiver(bondReceiver)
            } catch (e: Exception) {
                // Already unregistered.
            }
            bondReceiverRegistered = false
        }
    }

    /**
     * Connect while the monitor is in pairing mode, bond, set its clock and read
     * its identity. Called from the Add Device flow.
     */
    @SuppressLint("MissingPermission")
    fun bondDevice(address: String): Boolean {
        val adapter = adapter() ?: return false
        val device = try {
            adapter.getRemoteDevice(address)
        } catch (e: Exception) {
            events.error("BLE_BAD_ADDRESS", "Invalid device address: $address")
            return false
        }

        registerBondReceiver()
        stopScan()
        bondingAddress = address
        deviceInfo.clear()

        events.debug("BLE: bonding connect to $address")
        connect(device, autoConnect = false)
        return true
    }

    // ---- Arm / disarm (capture) --------------------------------------------

    /**
     * Leave a standing connection request open. autoConnect does NOT contact the
     * device; Android waits until it advertises and connects then. That is what
     * lets the patient take a reading at their own pace without the monitor's
     * one-minute idle timer running down.
     */
    @SuppressLint("MissingPermission")
    fun arm(address: String): Boolean {
        val adapter = adapter() ?: return false
        val device = try {
            adapter.getRemoteDevice(address)
        } catch (e: Exception) {
            events.error("BLE_BAD_ADDRESS", "Invalid device address: $address")
            return false
        }

        registerBondReceiver()
        armedAddress = address
        events.debug("BLE: armed $address (autoConnect)")
        connect(device, autoConnect = true)

        // Redundant discovery path. If the standing request misses the
        // advertisement, the scan still surfaces the device.
        startScan()
        return true
    }

    fun disarm(address: String) {
        if (armedAddress == address) armedAddress = null
        stopScan()
        clearOps()
        closeGatt()
        events.debug("BLE: disarmed $address")
    }

    // ---- Connection --------------------------------------------------------

    @SuppressLint("MissingPermission")
    private fun connect(device: BluetoothDevice, autoConnect: Boolean) {
        closeGatt()
        // TRANSPORT_LE explicitly: without it Android may attempt BR/EDR on
        // dual-mode devices and fail with status 133.
        mainHandler.post {
            gatt = device.connectGatt(context, autoConnect, gattCallback, BluetoothDevice.TRANSPORT_LE)
        }
    }

    @SuppressLint("MissingPermission")
    private fun closeGatt() {
        gatt?.let {
            try {
                it.disconnect()
                it.close()
            } catch (e: Exception) {
                // Nothing useful to do.
            }
        }
        gatt = null
        connectedAddress = null
    }

    @SuppressLint("MissingPermission")
    private fun discoverServices() {
        val g = gatt ?: return
        events.debug("BLE: discovering services")
        mainHandler.post { g.discoverServices() }
    }

    private val gattCallback = object : BluetoothGattCallback() {

        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            val address = g.device?.address ?: return

            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedAddress = address
                gatt = g
                events.debug("BLE: connected to $address")
                events.emit("onConnectionStateChanged", Arguments.createMap().apply {
                    putString("mac", address)
                    putString("type", "GATT_BP")
                    putBoolean("connected", true)
                    putString("source", SOURCE)
                })

                // A device whose measurement characteristic is encrypted must be
                // bonded before service discovery, or discovery returns nothing
                // useful and the monitor hangs up. When already bonded, just let
                // the link settle first.
                val bondState = g.device.bondState
                if (bondState == BluetoothDevice.BOND_NONE) {
                    events.debug("BLE: not bonded — requesting bond")
                    g.device.createBond()
                } else if (bondState == BluetoothDevice.BOND_BONDED) {
                    mainHandler.postDelayed({ discoverServices() }, DISCOVER_DELAY_MS)
                }
                // BOND_BONDING: the receiver fires discovery when it completes.
                return
            }

            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                events.debug("BLE: disconnected from $address (status $status)")
                clearOps()
                connectedAddress = null
                try {
                    g.close()
                } catch (e: Exception) {
                    // Already closed.
                }
                if (gatt === g) gatt = null

                events.emit("onConnectionStateChanged", Arguments.createMap().apply {
                    putString("mac", address)
                    putString("type", "GATT_BP")
                    putBoolean("connected", false)
                    putString("source", SOURCE)
                })

                // These monitors hang up as soon as they have handed over their
                // stored readings. If capture is still running, re-establish the
                // standing request so the next reading is caught too.
                val stillArmed = armedAddress
                if (stillArmed == address) {
                    events.debug("BLE: still armed — re-issuing autoConnect")
                    mainHandler.postDelayed({
                        val adapter = adapter() ?: return@postDelayed
                        if (armedAddress != address) return@postDelayed
                        connect(adapter.getRemoteDevice(address), autoConnect = true)
                    }, 500L)
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                events.debug("BLE: service discovery failed ($status)")
                return
            }
            events.debug("BLE: discovered ${g.services.size} services")

            // Order matters. Indications first so a reading arriving mid-session
            // is never missed, then the clock, then the identity reads.
            enableIndications(g)

            if (bondingAddress == g.device?.address) {
                writeDeviceTime(g)
            }

            queueDeviceInfoReads(g)
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            events.debug("BLE: CCCD write ${if (status == BluetoothGatt.GATT_SUCCESS) "ok" else "failed ($status)"}")
            finishOp()
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (characteristic.uuid == CHAR_DATE_TIME) {
                events.debug("BLE: clock write ${if (status == BluetoothGatt.GATT_SUCCESS) "ok" else "failed ($status)"}")
            }
            finishOp()
        }

        // Android 12 and below.
        @Deprecated("Superseded by the value-carrying overload on API 33+")
        override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            @Suppress("DEPRECATION")
            handleRead(characteristic.uuid, characteristic.value, status, g)
        }

        // API 33+.
        override fun onCharacteristicRead(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
            status: Int
        ) {
            handleRead(characteristic.uuid, value, status, g)
        }

        @Deprecated("Superseded by the value-carrying overload on API 33+")
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            handleNotification(characteristic.uuid, characteristic.value, g)
        }

        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            handleNotification(characteristic.uuid, value, g)
        }
    }

    // ---- Characteristic setup ----------------------------------------------

    @SuppressLint("MissingPermission")
    private fun enableIndications(g: BluetoothGatt) {
        val service = g.getService(SERVICE_BLOOD_PRESSURE) ?: g.getService(SERVICE_WEIGHT_SCALE)
        if (service == null) {
            events.debug("BLE: no BP or scale service present")
            return
        }

        val characteristic =
            service.getCharacteristic(CHAR_BP_MEASUREMENT)
                ?: service.getCharacteristic(CHAR_WEIGHT_MEASUREMENT)
                ?: return

        val descriptor = characteristic.getDescriptor(DESCRIPTOR_CCCD) ?: run {
            events.debug("BLE: measurement characteristic has no CCCD")
            return
        }

        // The choice below is the whole ballgame. 0x2A35 on a standards-compliant
        // BP monitor is INDICATE. Writing the notification value instead leaves
        // the connection up and completely silent — the failure mode reported and
        // never resolved on A&D's own Android sample.
        val enableValue = if (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0) {
            BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        } else {
            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        }

        enqueueOp("enable-indications") {
            g.setCharacteristicNotification(characteristic, true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeDescriptor(descriptor, enableValue)
            } else {
                @Suppress("DEPRECATION")
                descriptor.value = enableValue
                @Suppress("DEPRECATION")
                g.writeDescriptor(descriptor)
            }
        }
    }

    /**
     * Write the current time to Date Time (0x2A08), which on these monitors sits
     * inside the Blood Pressure service rather than a Current Time Service.
     *
     * Data flows without this — A&D's own sample never writes it — but a device
     * whose clock was never set omits the timestamp from every measurement, and
     * pulse shifts down the packet accordingly. Since CareView collects readings
     * after the fact, an undated reading would be stamped with collection time.
     * So this is written once, during pairing.
     */
    @SuppressLint("MissingPermission")
    private fun writeDeviceTime(g: BluetoothGatt) {
        val service = g.getService(SERVICE_BLOOD_PRESSURE) ?: return
        val characteristic = service.getCharacteristic(CHAR_DATE_TIME) ?: return
        if (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE == 0) return

        val now = Calendar.getInstance()
        val year = now.get(Calendar.YEAR)
        val payload = byteArrayOf(
            (year and 0xFF).toByte(),
            ((year shr 8) and 0xFF).toByte(),
            (now.get(Calendar.MONTH) + 1).toByte(), // Calendar months are 0-based
            now.get(Calendar.DAY_OF_MONTH).toByte(),
            now.get(Calendar.HOUR_OF_DAY).toByte(),
            now.get(Calendar.MINUTE).toByte(),
            now.get(Calendar.SECOND).toByte()
        )

        enqueueOp("write-clock") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeCharacteristic(
                    characteristic,
                    payload,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                )
            } else {
                @Suppress("DEPRECATION")
                characteristic.value = payload
                characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                @Suppress("DEPRECATION")
                g.writeCharacteristic(characteristic)
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun queueDeviceInfoReads(g: BluetoothGatt) {
        val info = g.getService(SERVICE_DEVICE_INFO)
        val battery = g.getService(SERVICE_BATTERY)

        val reads = listOfNotNull(
            info?.getCharacteristic(CHAR_SYSTEM_ID),
            info?.getCharacteristic(CHAR_SERIAL_NUMBER),
            info?.getCharacteristic(CHAR_MODEL_NUMBER),
            battery?.getCharacteristic(CHAR_BATTERY_LEVEL)
        )

        for (characteristic in reads) {
            enqueueOp("read-${characteristic.uuid}") {
                g.readCharacteristic(characteristic)
            }
        }

        // Because operations are serialised, the queue is the sequencing
        // primitive: this runs only once every read above has come back.
        enqueueOp("flush-device-info") {
            flushDeviceInfo(g.device?.address)
            finishOp()
        }
    }

    // ---- Reads and notifications -------------------------------------------

    private fun handleRead(uuid: UUID, value: ByteArray?, status: Int, g: BluetoothGatt) {
        if (status == BluetoothGatt.GATT_SUCCESS && value != null) {
            when (uuid) {
                CHAR_SYSTEM_ID -> macFromSystemId(value)?.let { deviceInfo["systemIdMac"] = it }
                CHAR_SERIAL_NUMBER -> deviceInfo["serialNumber"] = value.toString(Charsets.UTF_8).trim()
                CHAR_MODEL_NUMBER -> deviceInfo["modelNumber"] = value.toString(Charsets.UTF_8).trim()
                CHAR_BATTERY_LEVEL -> {
                    val level = value.firstOrNull()?.toInt()?.and(0xFF) ?: -1
                    if (level in 0..100) {
                        deviceInfo["battery"] = level
                        events.emit("onBatteryLevel", Arguments.createMap().apply {
                            putString("mac", g.device?.address ?: "")
                            putString("type", "GATT_BP")
                            putInt("level", level)
                            putString("source", SOURCE)
                            putDouble("timestamp", System.currentTimeMillis().toDouble())
                        })
                    }
                }
            }
        }
        finishOp()
    }

    private fun flushDeviceInfo(address: String?) {
        if (address == null) return

        // Android hands us the real hardware address directly, so that is the
        // authoritative value. System ID is read anyway as a cross-check: iOS has
        // no other way to learn the MAC, and if the two ever disagree the iOS
        // decoding is wrong and EMR inventory would split across platforms.
        val normalizedAddress = address.replace(":", "").uppercase()
        val systemIdMac = deviceInfo["systemIdMac"] as? String
        if (systemIdMac != null && systemIdMac != normalizedAddress) {
            events.debug(
                "BLE: System ID MAC ($systemIdMac) differs from address ($normalizedAddress) — " +
                    "iOS derives identity from System ID, so this would split EMR inventory"
            )
        }

        val params = Arguments.createMap().apply {
            putString("identifier", address)
            putString("mac", normalizedAddress)
            (deviceInfo["serialNumber"] as? String)?.let { putString("serialNumber", it) }
            (deviceInfo["modelNumber"] as? String)?.let { putString("modelNumber", it) }
            (deviceInfo["battery"] as? Int)?.let { putInt("battery", it) }
        }
        events.emit("onBleDeviceInfo", params)

        // Provisioning is finished; let the monitor go back to sleep rather than
        // burning its short awake window. Capture sessions stay connected.
        if (bondingAddress == address) {
            bondingAddress = null
            if (armedAddress != address) {
                mainHandler.postDelayed({ closeGatt() }, 500L)
            }
        }
    }

    private fun handleNotification(uuid: UUID, value: ByteArray, g: BluetoothGatt) {
        val address = g.device?.address ?: ""
        when (uuid) {
            CHAR_BP_MEASUREMENT -> parseBloodPressure(value, address)
            CHAR_WEIGHT_MEASUREMENT -> parseWeight(value, address)
        }
    }

    // ---- Parsing (Bluetooth SIG Blood Pressure Measurement, 0x2A35) ---------

    private fun parseBloodPressure(data: ByteArray, address: String) {
        if (data.size < 7) {
            events.debug("BLE: BP payload too short (${data.size} bytes)")
            return
        }

        val flags = data[0].toInt() and 0xFF
        val isKPa = (flags and 0x01) != 0

        var systolic = sfloat(data, 1)
        var diastolic = sfloat(data, 3)
        if (isKPa) {
            systolic *= 7.50062f
            diastolic *= 7.50062f
        }

        // Bytes 5-6 are Mean Arterial Pressure, which CareView does not record.
        var offset = 7
        var measuredAtMs = 0.0

        if ((flags and 0x02) != 0) {
            if (data.size >= offset + 7) {
                val year = (data[offset].toInt() and 0xFF) or ((data[offset + 1].toInt() and 0xFF) shl 8)
                if (year > 0) {
                    val cal = Calendar.getInstance()
                    cal.clear()
                    cal.set(
                        year,
                        (data[offset + 2].toInt() and 0xFF) - 1, // Calendar months are 0-based
                        data[offset + 3].toInt() and 0xFF,
                        data[offset + 4].toInt() and 0xFF,
                        data[offset + 5].toInt() and 0xFF,
                        data[offset + 6].toInt() and 0xFF
                    )
                    measuredAtMs = cal.timeInMillis.toDouble()
                }
            }
            offset += 7
        }

        var pulse = 0
        if ((flags and 0x04) != 0 && data.size >= offset + 2) {
            pulse = sfloat(data, offset).toInt()
        }

        // Drop anything that is not a believable blood pressure. Monitors ship
        // with factory-test records in memory and hand them over on the first
        // connection; those carried NaN fields and reached a patient chart as
        // 2047/2047. Silence is the correct outcome — the capture screen simply
        // keeps waiting for a real reading.
        if (!isPlausibleBP(systolic, diastolic, pulse)) {
            events.debug(
                "BLE: discarded implausible BP $systolic/$diastolic pulse=$pulse " +
                    "(flags=0x%02X, ${data.size} bytes)".format(flags)
            )
            return
        }

        events.debug(
            "BLE: BP ${systolic.toInt()}/${diastolic.toInt()} pulse=$pulse " +
                "deviceTime=${if (measuredAtMs > 0) "yes" else "no"}"
        )

        events.emit("onBloodPressureReading", Arguments.createMap().apply {
            putString("mac", address)
            putString("type", "GATT_BP")
            putInt("systolic", systolic.toInt())
            putInt("diastolic", diastolic.toInt())
            putInt("pulse", pulse)
            putBoolean("irregular", false)
            putString("source", SOURCE)
            putDouble("timestamp", System.currentTimeMillis().toDouble())
            // When the monitor says the reading was taken. 0 = its clock was never set.
            putDouble("measuredAt", measuredAtMs)
        })
    }

    private fun parseWeight(data: ByteArray, address: String) {
        if (data.size < 3) return
        val flags = data[0].toInt() and 0xFF
        val isImperial = (flags and 0x01) != 0
        val raw = (data[1].toInt() and 0xFF) or ((data[2].toInt() and 0xFF) shl 8)

        val weight = if (isImperial) raw * 0.01 else raw * 0.005
        val unit = if (isImperial) "lbs" else "kg"

        events.emit("onWeightReading", Arguments.createMap().apply {
            putString("mac", address)
            putString("type", "GATT_SCALE")
            putDouble("weight", weight)
            putString("unit", unit)
            putString("source", SOURCE)
            putDouble("timestamp", System.currentTimeMillis().toDouble())
        })
    }

    /**
     * IEEE 11073 16-bit SFLOAT: 12-bit signed mantissa, 4-bit signed exponent.
     */
    private fun sfloat(data: ByteArray, offset: Int): Float {
        if (offset + 1 >= data.size) return Float.NaN
        val raw = (data[offset].toInt() and 0xFF) or ((data[offset + 1].toInt() and 0xFF) shl 8)

        // Reserved values are NOT numbers and must never be decoded
        // arithmetically. NaN is 0x07FF, which naively evaluates to 2047 — the
        // value that reached a patient chart as 2047/2047 mmHg from a new
        // monitor's factory-test records.
        when (raw and 0x0FFF) {
            0x07FF -> return Float.NaN               // NaN
            0x0800 -> return Float.NaN               // NRes — not at this resolution
            0x07FE -> return Float.POSITIVE_INFINITY // +INFINITY
            0x0802 -> return Float.NEGATIVE_INFINITY // -INFINITY
            0x0801 -> return Float.NaN               // Reserved
        }

        var mantissa = raw and 0x0FFF
        var exponent = (raw shr 12) and 0x0F

        if (mantissa and 0x0800 != 0) mantissa = mantissa or 0xFFFFF000.toInt() // sign-extend 12→32
        if (exponent and 0x08 != 0) exponent = exponent or 0xFFFFFFF0.toInt()   // sign-extend 4→32

        return (mantissa * Math.pow(10.0, exponent.toDouble())).toFloat()
    }

    /**
     * Physiological sanity gate — the last line of defence before a number
     * reaches a chart. Deliberately wide: the job is to reject impossible
     * values, not to make clinical judgements about unusual ones.
     *
     * Must stay identical to isPlausibleBPSystolic:diastolic:pulse: on iOS.
     */
    private fun isPlausibleBP(systolic: Float, diastolic: Float, pulse: Int): Boolean {
        if (!systolic.isFinite() || !diastolic.isFinite()) return false
        if (systolic < 30f || systolic > 300f) return false
        if (diastolic < 10f || diastolic > 250f) return false
        if (systolic <= diastolic) return false
        if (pulse != 0 && (pulse < 20 || pulse > 250)) return false
        return true
    }

    /**
     * System ID (0x2A23) is 8 bytes: a 40-bit manufacturer identifier then a
     * 24-bit OUI, both little-endian. The 48-bit MAC is bytes 7,6,5 followed by
     * 2,1,0. Must stay byte-for-byte identical to the iOS implementation.
     */
    private fun macFromSystemId(data: ByteArray): String? {
        if (data.size < 8) return null
        return String.format(
            "%02X%02X%02X%02X%02X%02X",
            data[7], data[6], data[5], data[2], data[1], data[0]
        )
    }

    @SuppressLint("MissingPermission")
    private fun safeName(device: BluetoothDevice): String? {
        return try {
            device.name
        } catch (e: SecurityException) {
            null
        }
    }
}
