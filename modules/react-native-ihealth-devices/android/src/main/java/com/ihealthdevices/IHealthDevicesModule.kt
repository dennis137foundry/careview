package com.ihealthdevices

import android.Manifest
import android.app.Application
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.ihealth.communication.control.*
import com.ihealth.communication.manager.iHealthDevicesCallback
import com.ihealth.communication.manager.iHealthDevicesManager
import com.ihealth.communication.manager.DiscoveryTypeEnum
import org.json.JSONObject
import org.json.JSONTokener

class IHealthDevicesModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "IHealthDevices"
        private const val NAME = "IHealthDevices"
        // Seconds each device type gets to be discovered before moving to next
        private const val SCAN_WINDOW_MS = 3000L
    }

    private var isAuthenticatedFlag = false
    private var isInitialized = false
    private var callbackId = 0
    // Stores mac -> { "type": "BP3L", "source": "iHealthSDK" }
    private val connectedDevices = mutableMapOf<String, MutableMap<String, String>>()
    private var targetMAC: String? = null
    private var targetType: String? = null

    // BG5S glucose meter control — obtained after connect to issue SDK commands
    // (setTime / setUnit / startMeasure / getOfflineData). Mirrors iOS BG5SController.
    private var bg5sControl: Bg5sControl? = null

    // Set by connectForSetup (add-device flow): this connection also sets the
    // device's own clock (BP5S via getFunctionInfo; the BG5S chain sets it on
    // every connect anyway). A device's stored readings carry ITS timestamp,
    // and out of the box that clock reads 2017 — the meter's clock is read
    // BEFORE it is set and reported to JS (onDeviceClockSet.deviceDateBefore),
    // which is what lets readings taken on the unset clock be dated later.
    // Mirrors iOS _setupMAC. Cleared once consumed.
    private var setupMac: String? = null

    // setDeviceClock(purge=true) on an already-connected BG5S: erase memory
    // after the clock is set. Consumed by the ACTION_SET_TIME handler.
    private var bg5sPurgePendingMac: String? = null

    // deleteDeviceRecords: settled when the meter confirms the erase.
    private var pendingDeletePromise: Promise? = null

    // Offline record count reported by the last BG5S status query. The pull
    // is deferred until AFTER the clock is set so JS always has clockSetAt
    // before any stored record arrives.
    private var bg5sOfflineNum = 0

    // Resolved when the async clock-set chain finishes (setDeviceClock).
    private var pendingClockPromise: Promise? = null

    // Timer-based sequential scan
    private val scanHandler = Handler(Looper.getMainLooper())
    private var scanTypesList = listOf<String>()
    private var currentScanIndex = 0
    private var isScanningActive = false
    // True while a generic-BLE scan runs in parallel with the iHealth rotation.
    private var genericContinuousScan = false

    private val scanNextRunnable = Runnable { advanceToNextType() }

    // Generic BLE (A&D UA-651BLE and other standard GATT BP/scale profiles).
    // Entirely separate from the iHealth SDK: this module only routes into it
    // for device types prefixed "GATT_", and it never calls iHealthDevicesManager.
    // Created lazily so nothing BLE-related runs for iHealth-only sessions.
    private var genericBle: GenericBleController? = null

    private fun ensureGenericBle(): GenericBleController {
        return genericBle ?: GenericBleController(
            reactApplicationContext,
            object : GenericBleController.Events {
                override fun emit(eventName: String, params: WritableMap) = sendEvent(eventName, params)
                override fun debug(message: String) = sendDebugLog(message)
                override fun error(code: String, message: String) = sendError(code, message)
            }
        ).also { genericBle = it }
    }

    override fun getName(): String = NAME

    override fun invalidate() {
        super.invalidate()
        // Releases the scanner, any open GATT link, and the bond-state receiver.
        genericBle?.teardown()
        genericBle = null
    }

    // =========================================================================
    // Event Helpers
    // =========================================================================

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun sendDebugLog(message: String) {
        Log.d(TAG, message)
        try {
            val params = Arguments.createMap().apply {
                putString("message", message)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }
            sendEvent("onDebugLog", params)
        } catch (e: Exception) {
            // Ignore if event emitter not ready
        }
    }

    private fun sendError(code: String, message: String) {
        Log.e(TAG, "Error [$code]: $message")
        try {
            val params = Arguments.createMap().apply {
                putString("code", code)
                putString("message", message)
            }
            sendEvent("onError", params)
        } catch (e: Exception) {
            // Ignore if event emitter not ready
        }
    }

    private fun hasPermission(permission: String): Boolean {
        return if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            true
        } else {
            reactApplicationContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun isLocationEnabled(): Boolean {
        val lm = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lm.isLocationEnabled
        } else {
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }
    }

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
            val manager = reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            manager.adapter
        } else {
            @Suppress("DEPRECATION")
            BluetoothAdapter.getDefaultAdapter()
        }
    }

    private fun buildBluetoothStatus(): WritableMap {
        val adapter = getBluetoothAdapter()
        val available = adapter != null
        val scanPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            hasPermission(Manifest.permission.BLUETOOTH_SCAN)
        } else {
            hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        val connectPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            true
        }
        val authorized = scanPermission && connectPermission
        val poweredOn = if (!authorized) {
            false
        } else {
            try {
                adapter?.isEnabled == true
            } catch (_: SecurityException) {
                false
            }
        }
        val locationEnabled = isLocationEnabled()

        val state: String
        val message: String
        when {
            !available -> {
                state = "unsupported"
                message = "This device does not support Bluetooth scanning."
            }
            !authorized -> {
                state = "unauthorized"
                message = "Bluetooth permission is off for CareView. Allow Bluetooth permissions in Settings, then try again."
            }
            !poweredOn -> {
                state = "powered_off"
                message = "Bluetooth is off. Turn on Bluetooth, then try again."
            }
            !locationEnabled -> {
                state = "location_disabled"
                message = "Location Services must be on for Bluetooth scanning on this Android device."
            }
            else -> {
                state = "powered_on"
                message = "Bluetooth is ready."
            }
        }

        return Arguments.createMap().apply {
            putBoolean("available", available)
            putBoolean("authorized", authorized)
            putBoolean("poweredOn", poweredOn)
            putBoolean("locationServicesEnabled", locationEnabled)
            putBoolean("ready", available && authorized && poweredOn && locationEnabled)
            putString("state", state)
            putString("message", message)
        }
    }

    // =========================================================================
    // Device Type Helpers
    // =========================================================================

    private fun getDiscoveryType(deviceType: String): DiscoveryTypeEnum? {
        return when (deviceType.uppercase()) {
            "BP3L" -> DiscoveryTypeEnum.BP3L
            "BP5" -> DiscoveryTypeEnum.BP5
            "BP5S" -> DiscoveryTypeEnum.BP5S
            "HS2" -> DiscoveryTypeEnum.HS2
            "HS2S" -> DiscoveryTypeEnum.HS2S
            "HS4S" -> DiscoveryTypeEnum.HS4S
            "BG5S" -> DiscoveryTypeEnum.BG5S
            else -> null
        }
    }

    private fun getDeviceTypeName(type: String): String {
        return when {
            type.contains("BP3L", ignoreCase = true) -> "BP3L"
            type.contains("BP5S", ignoreCase = true) -> "BP5S"
            type.contains("BP5", ignoreCase = true) -> "BP5"
            type.contains("HS2S", ignoreCase = true) -> "HS2S"
            type.contains("HS2", ignoreCase = true) -> "HS2"
            type.contains("HS4S", ignoreCase = true) || type.contains("HS4", ignoreCase = true) -> "HS4S"
            type.contains("BG5S", ignoreCase = true) -> "BG5S"
            else -> type
        }
    }

    /**
     * Look up stored device type by MAC from connectedDevices map.
     * Used by startMeasurement which only receives mac from JS.
     */
    private fun getConnectedDeviceType(mac: String): String? {
        return connectedDevices[mac]?.get("type")
    }

    // =========================================================================
    // Timer-Based Sequential Scan
    // =========================================================================

    /**
     * Start discovery for the current type, then schedule the next one
     * after SCAN_WINDOW_MS. Each type gets a fixed time window.
     * This avoids race conditions from onScanFinish callbacks.
     */
    private fun advanceToNextType() {
        if (!isScanningActive) return

        // Stop previous discovery before starting next
        try { iHealthDevicesManager.getInstance().stopDiscovery() } catch (_: Exception) {}
        // The generic scanner now runs for the whole session, so the rotation
        // must not stop it between iHealth windows. Only tear it down here if
        // it is NOT in continuous mode.
        if (!genericContinuousScan) {
            genericBle?.stopScan()
        }

        if (currentScanIndex >= scanTypesList.size) {
            // The iHealth Android SDK can only discover one device type at a time, so we
            // cycle through the list. Rather than stopping after a single pass (which means
            // a device whose 3s window was missed is never found), loop back to the start
            // and keep scanning until stopScan() or the JS auto-stop timeout fires. This
            // gives every type — e.g. the HS2S scale — repeated discovery windows.
            if (scanTypesList.isEmpty()) {
                isScanningActive = false
                sendEvent("onScanStateChanged", Arguments.createMap().apply {
                    putBoolean("scanning", false)
                })
                return
            }
            currentScanIndex = 0
            sendDebugLog("SCAN: Completed a full pass — looping for continuous discovery")
        }

        val type = scanTypesList[currentScanIndex]
        currentScanIndex++

        // "GATT" never reaches the rotation any more — startScan strips it out
        // and runs that scanner continuously instead. Guard anyway so a stale
        // caller cannot burn an iHealth window on a no-op.
        if (type.equals("GATT", ignoreCase = true)) {
            advanceToNextType()
            return
        }

        val discoveryType = getDiscoveryType(type)

        if (discoveryType != null) {
            sendDebugLog("Scanning for $type (${scanTypesList.size - currentScanIndex} types after this)")
            iHealthDevicesManager.getInstance().startDiscovery(discoveryType)
            // Schedule next type after the scan window
            scanHandler.postDelayed(scanNextRunnable, SCAN_WINDOW_MS)
        } else {
            sendDebugLog("Skipping unsupported type: $type")
            // Immediately try next type
            advanceToNextType()
        }
    }

    // =========================================================================
    // SDK Initialization (called internally, not from JS)
    // =========================================================================

    private fun ensureInitialized() {
        if (isInitialized) return
        try {
            sendDebugLog("Initializing iHealth SDK...")
            val app = reactApplicationContext.applicationContext as Application
            iHealthDevicesManager.getInstance().init(app, Log.VERBOSE, Log.VERBOSE)
            callbackId = iHealthDevicesManager.getInstance().registerClientCallback(iHealthCallback)
            sendDebugLog("Registered callback with ID: $callbackId")

            // Register callback filters for all supported device types
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BP3L)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BP5)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BP5S)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_HS2)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_HS2S)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_HS4S)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BG5S)

            isInitialized = true
            sendDebugLog("iHealth SDK initialized successfully")
        } catch (e: Exception) {
            sendDebugLog("Init error: ${e.message}")
        }
    }

    // =========================================================================
    // iHealth SDK Callback
    // =========================================================================

    private val iHealthCallback = object : iHealthDevicesCallback() {

        override fun onScanDevice(mac: String?, deviceType: String?, rssi: Int) {
            sendDebugLog("SCAN: Found device mac=$mac type=$deviceType rssi=$rssi")
            if (mac == null || deviceType == null) return
            val normalizedType = getDeviceTypeName(deviceType)
            val params = Arguments.createMap().apply {
                putString("mac", mac)
                putString("name", "$normalizedType ($mac)")
                putString("type", normalizedType)
                putInt("rssi", rssi)
                putString("source", "iHealthSDK")
            }
            sendEvent("onDeviceFound", params)
        }

        override fun onScanFinish() {
            // Timer handles scan chaining — do not chain from here
            sendDebugLog("SCAN: SDK reported scan finished")
        }

        override fun onDeviceConnectionStateChange(mac: String?, deviceType: String?, status: Int, errorId: Int) {
            sendDebugLog("CONNECTION: mac=$mac type=$deviceType status=$status errorId=$errorId")
            if (mac == null || deviceType == null) return
            val normalizedType = getDeviceTypeName(deviceType)

            when (status) {
                iHealthDevicesManager.DEVICE_STATE_CONNECTED -> {
                    connectedDevices[mac] = mutableMapOf(
                        "type" to normalizedType,
                        "mac" to mac,
                        "source" to "iHealthSDK"
                    )
                    targetMAC = null
                    targetType = null

                    val params = Arguments.createMap().apply {
                        putString("mac", mac)
                        putString("type", normalizedType)
                        putBoolean("connected", true)
                        putString("source", "iHealthSDK")
                    }
                    sendEvent("onConnectionStateChanged", params)

                    // BG5S needs an explicit prep sequence (status → time → unit) and an
                    // offline-record pull, the same way iOS does on connect.
                    if (normalizedType == "BG5S") {
                        prepareBg5s(mac)
                    } else {
                        // BP/HS: best-effort battery read. The result arrives async via
                        // onDeviceNotify (action battery_bp / battery_hs) and is forwarded
                        // as an onBatteryLevel event. Never blocks measurement.
                        queryDeviceBattery(mac, normalizedType)
                        // Setup connect: sync the cuff's clock too. Only the BP5S
                        // exposes it on Android (getFunctionInfo); its answer arrives
                        // as function_info_bp and is reported as onDeviceClockSet.
                        // BP readings are live and phone-stamped regardless.
                        if (setupMac.equals(mac, ignoreCase = true)) {
                            setupMac = null
                            if (normalizedType == "BP5S") {
                                try { iHealthDevicesManager.getInstance().getBp5sControl(mac)?.getFunctionInfo() }
                                catch (e: Exception) { sendDebugLog("BP5S getFunctionInfo error: ${e.message}") }
                            }
                        }
                    }
                }
                iHealthDevicesManager.DEVICE_STATE_DISCONNECTED -> {
                    connectedDevices.remove(mac)
                    if (normalizedType == "BG5S") {
                        try { bg5sControl?.destroy() } catch (_: Exception) {}
                        bg5sControl = null
                    }
                    val params = Arguments.createMap().apply {
                        putString("mac", mac)
                        putString("type", normalizedType)
                        putBoolean("connected", false)
                    }
                    sendEvent("onConnectionStateChanged", params)
                }
                iHealthDevicesManager.DEVICE_STATE_CONNECTIONFAIL -> {
                    val params = Arguments.createMap().apply {
                        putString("mac", mac)
                        putString("type", normalizedType)
                        putBoolean("connected", false)
                    }
                    sendEvent("onConnectionStateChanged", params)
                }
            }
        }

        override fun onUserStatus(username: String?, userId: Int) {
            sendDebugLog("AUTH: username=$username userId=$userId")
        }

        override fun onDeviceNotify(mac: String?, deviceType: String?, action: String?, message: String?) {
            sendDebugLog("NOTIFY: mac=$mac type=$deviceType action=$action")
            if (mac == null || deviceType == null || action == null) return
            val normalizedType = getDeviceTypeName(deviceType)
            try {
                val json = if (!message.isNullOrEmpty()) {
                    JSONObject(JSONTokener(message))
                } else {
                    JSONObject()
                }
                when {
                    normalizedType.startsWith("BP") -> handleBPNotification(mac, normalizedType, action, json)
                    normalizedType.startsWith("HS") -> handleHSNotification(mac, normalizedType, action, json)
                    normalizedType == "BG5S" -> handleBG5SNotification(mac, normalizedType, action, json)
                    else -> sendDebugLog("NOTIFY: Unhandled device type: $normalizedType")
                }
            } catch (e: Exception) {
                sendDebugLog("NOTIFY: Parse error: ${e.message}")
            }
        }
    }

    // =========================================================================
    // Blood Pressure Notification Handler
    // =========================================================================

    /**
     * Best-effort battery query on connect. getBattery() is void; the result
     * comes back asynchronously through onDeviceNotify (handled by emitBattery).
     * HS4S has no battery API in the SDK, so it is skipped (stays "unknown").
     */
    private fun queryDeviceBattery(mac: String, deviceType: String) {
        try {
            val mgr = iHealthDevicesManager.getInstance()
            when (deviceType) {
                "BP3L" -> mgr.getBp3lControl(mac)?.getBattery()
                "BP5"  -> mgr.getBp5Control(mac)?.getBattery()
                "BP5S" -> mgr.getBp5sControl(mac)?.getBattery()
                "HS2"  -> mgr.getHs2Control(mac)?.getBattery()
                "HS2S" -> mgr.getHs2sControl(mac)?.getBattery()
                else   -> sendDebugLog("Battery: no SDK API for $deviceType")
            }
        } catch (e: Exception) {
            sendDebugLog("Battery query error for $mac: ${e.message}")
        }
    }

    /**
     * Forward a battery reading (from onDeviceNotify) to JS as onBatteryLevel.
     * Ignores out-of-range values so a bogus reading never reaches the UI.
     */
    private fun emitBattery(mac: String, deviceType: String, json: JSONObject) {
        val level = json.optInt("battery", json.optInt("Battery", -1))
        if (level in 0..100) {
            sendDebugLog("BATTERY[$deviceType]: $level%")
            val params = Arguments.createMap().apply {
                putString("mac", mac)
                putString("type", deviceType)
                putInt("level", level)
                putString("source", "iHealthSDK")
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }
            sendEvent("onBatteryLevel", params)
        } else {
            sendDebugLog("BATTERY[$deviceType]: out of range ($level) json=$json")
        }
    }

    private fun handleBPNotification(mac: String, deviceType: String, action: String, json: JSONObject) {
        sendDebugLog("BP[$deviceType]: action=$action keys=${json.keys().asSequence().toList()}")
        when {
            action.contains("battery", ignoreCase = true) -> {
                emitBattery(mac, deviceType, json)
            }
            action == BpProfile.ACTION_FUNCTION_INFORMATION_BP -> {
                // getFunctionInfo() doubles as the SDK's "synchronize time".
                emitClockSet(mac, deviceType, purged = false, deviceDateBefore = null)
                pendingClockPromise?.resolve(true)
                pendingClockPromise = null
            }
            action.contains("result", ignoreCase = true) -> {
                // iHealth Android SDK sends uppercase keys (HP, LP, PR, AHR).
                // Fallback to lowercase variants for defensive compatibility.
                val systolic = json.optInt("HP", json.optInt("hp", json.optInt("sys", 0)))
                val diastolic = json.optInt("LP", json.optInt("lp", json.optInt("dia", 0)))
                val pulse = json.optInt("PR", json.optInt("pr", json.optInt("pulse", json.optInt("heartRate", 0))))
                val ahr = json.optBoolean("AHR", json.optBoolean("ahr", json.optBoolean("irregular", false)))
                if (systolic > 0 && diastolic > 0) {
                    sendDebugLog("BP RESULT: sys=$systolic dia=$diastolic pulse=$pulse")
                    val params = Arguments.createMap().apply {
                        putString("mac", mac)
                        putString("type", deviceType)
                        putInt("systolic", systolic)
                        putInt("diastolic", diastolic)
                        putInt("pulse", pulse)
                        putBoolean("irregular", ahr)
                        putString("source", "iHealthSDK")
                        putDouble("timestamp", System.currentTimeMillis().toDouble())
                    }
                    sendEvent("onBloodPressureReading", params)
                }
            }
            action.contains("pressure", ignoreCase = true) -> {
                sendDebugLog("BP PRESSURE: ${json.optInt("pressure", 0)} mmHg")
            }
            action.contains("error", ignoreCase = true) -> {
                sendError("BP_ERROR", "Blood pressure error: $json")
            }
            else -> sendDebugLog("BP: Unhandled action: $action")
        }
    }

    // =========================================================================
    // Scale (Weight) Notification Handler
    // =========================================================================

    private fun handleHSNotification(mac: String, deviceType: String, action: String, json: JSONObject) {
        sendDebugLog("HS[$deviceType]: action=$action keys=${json.keys().asSequence().toList()}")
        when {
            action.contains("battery", ignoreCase = true) -> {
                emitBattery(mac, deviceType, json)
            }
            action.contains("unstable", ignoreCase = true) || action.contains("unsteady", ignoreCase = true) -> {
                sendDebugLog("HS UNSTABLE: weight=${json.optDouble("weight", 0.0)} kg")
            }
            action.contains("result", ignoreCase = true) || action.contains("stable", ignoreCase = true) -> {
                val weight = json.optDouble("weight", json.optDouble("Weight", 0.0))
                if (weight > 0) {
                    sendDebugLog("HS RESULT: weight=${weight}kg")
                    val params = Arguments.createMap().apply {
                        putString("mac", mac)
                        putString("type", deviceType)
                        putDouble("weight", weight)
                        putString("unit", "kg")
                        putString("source", "iHealthSDK")
                        putDouble("timestamp", System.currentTimeMillis().toDouble())
                    }
                    sendEvent("onWeightReading", params)
                }
            }
            action.contains("error", ignoreCase = true) -> sendError("HS_ERROR", "Scale error: $json")
            else -> sendDebugLog("HS: Unhandled action: $action")
        }
    }

    // =========================================================================
    // Blood Glucose (BG5S) — discovery + connect + measure + offline records.
    // Mirrors the iOS BG5S flow (status → setTime → setUnit(mg/dL) → measure) and
    // emits the same JS events iOS does: onBloodGlucoseReading + onGlucoseMeterEvent.
    // The iHealth Android SDK only delivers BG5S data via onDeviceNotify using the
    // Bg5sProfile action strings, so all parsing keys come from that profile.
    // =========================================================================

    /**
     * Runs when a BG5S connects. Grabs the control, queries status, and — chained
     * via the notify callbacks below — sets time and unit, then pulls any stored
     * offline records so readings taken away from the phone sync just like iOS.
     */
    private fun prepareBg5s(mac: String) {
        try {
            val control = iHealthDevicesManager.getInstance().getBg5sControl(mac)
            if (control == null) {
                sendDebugLog("BG5S: control unavailable for $mac")
                return
            }
            bg5sControl = control
            control.init()
            control.getStatusInfo()
            sendGlucoseMeterEvent(mac, "prepare", "BG5S connected — querying status")
        } catch (e: Exception) {
            sendDebugLog("BG5S prepare error: ${e.message}")
        }
    }

    private fun handleBG5SNotification(mac: String, deviceType: String, action: String, json: JSONObject) {
        sendDebugLog("BG5S[$deviceType]: action=$action json=$json")
        val control = bg5sControl
        when (action) {
            Bg5sProfile.ACTION_GET_STATUS_INFO -> {
                bg5sOfflineNum = json.optInt(Bg5sProfile.INFO_OFFLINE_DATA_NUM, 0)
                bg5sDeviceDateBefore = bg5sStatusDeviceDate(json)
                sendGlucoseMeterEvent(mac, "status",
                    "Status received; offline records=$bg5sOfflineNum; meter clock=${bg5sDeviceDateBefore?.let { java.util.Date(it.toLong()) } ?: "unknown"}")
                // A setup connect on the BG5S needs nothing extra: this chain sets
                // the clock and reports it on every connect.
                if (setupMac.equals(mac, ignoreCase = true)) setupMac = null
                // Continue the prep chain: set the meter clock. The offline pull
                // is issued from ACTION_SET_TIME, never here, so JS receives
                // onDeviceClockSet (with the clock's pre-set reading) before any
                // stored record.
                try { control?.setTime(java.util.Date(), localTimezoneOffsetHours()) }
                catch (e: Exception) { sendDebugLog("BG5S setTime error: ${e.message}") }
            }
            Bg5sProfile.ACTION_SET_TIME -> {
                if (bg5sPurgePendingMac.equals(mac, ignoreCase = true)) {
                    bg5sPurgePendingMac = null
                    sendGlucoseMeterEvent(mac, "set_time", "Clock set; erasing memory")
                    try { control?.deleteOfflineData() }
                    catch (e: Exception) {
                        sendDebugLog("BG5S deleteOfflineData error: ${e.message}")
                        finishBg5sClockSet(mac, purged = false)
                    }
                    return
                }
                sendGlucoseMeterEvent(mac, "set_time", "Clock set; setting unit to mg/dL")
                finishBg5sClockSet(mac, purged = false)
                // Pull stored readings so offline measurements reach the EMR (iOS
                // parity). Each carries the meter's timestamp and its time-proof
                // flag; JS dates the flagged ones by the clock offset. When the
                // meter holds nothing, say so — JS is waiting for this batch.
                if (bg5sOfflineNum > 0) {
                    try { control?.getOfflineData() }
                    catch (e: Exception) { sendDebugLog("BG5S getOfflineData error: ${e.message}") }
                } else {
                    sendGlucoseMeterEvent(mac, "offline_synced", "Synced 0 offline record(s)")
                }
            }
            Bg5sProfile.ACTION_DELETE_OFFLINE_DATA -> {
                sendGlucoseMeterEvent(mac, "delete_offline_ok", "Meter memory erased")
                bg5sOfflineNum = 0
                if (pendingDeletePromise != null) {
                    // deleteDeviceRecords after an import — not the clock chain.
                    pendingDeletePromise?.resolve(true)
                    pendingDeletePromise = null
                } else {
                    finishBg5sClockSet(mac, purged = true)
                }
            }
            Bg5sProfile.ACTION_SET_UNIT ->
                sendGlucoseMeterEvent(mac, "ready", "Unit set to mg/dL; meter ready")
            Bg5sProfile.ACTION_START_MEASURE ->
                sendGlucoseMeterEvent(mac, "start_measure", "Measurement started — insert strip")
            Bg5sProfile.ACTION_STRIP_IN ->
                sendGlucoseMeterEvent(mac, "strip_in", "Strip inserted — apply blood")
            Bg5sProfile.ACTION_GET_BLOOD ->
                sendGlucoseMeterEvent(mac, "blood_detected", "Blood detected — analyzing")
            Bg5sProfile.ACTION_STRIP_OUT ->
                sendGlucoseMeterEvent(mac, "strip_out", "Strip removed")
            Bg5sProfile.ACTION_ENTER_CHARGED_STATE ->
                sendGlucoseMeterEvent(mac, "charging", "Meter charging")
            Bg5sProfile.ACTION_LEAVE_CHARGED_STATE ->
                sendGlucoseMeterEvent(mac, "charging", "Meter unplugged")
            Bg5sProfile.ACTION_RESULT -> {
                // Live result. We set UNIT_MG, so the value is mg/dL.
                val value = json.optDouble(Bg5sProfile.RESULT_VALUE,
                    json.optInt(Bg5sProfile.RESULT_VALUE, 0).toDouble())
                val dataID = json.optString(Bg5sProfile.DATA_ID, "")
                if (value > 0) emitGlucoseReading(mac, value, dataID, System.currentTimeMillis().toDouble())
                else sendDebugLog("BG5S result had no positive value: $json")
            }
            Bg5sProfile.ACTION_GET_OFFLINE_DATA -> {
                // Stored records pulled from the meter; OFFLINE_DATA is a JSON array.
                val arr = json.optJSONArray(Bg5sProfile.OFFLINE_DATA)
                if (arr != null) {
                    var emitted = 0
                    for (i in 0 until arr.length()) {
                        val rec = arr.optJSONObject(i) ?: continue
                        val value = rec.optDouble(Bg5sProfile.DATA_VALUE, 0.0)
                        if (value > 0) {
                            // DATA_TIME_PROOF: true = the meter's clock had been set when this
                            // reading was taken, so its timestamp is trustworthy; false = taken
                            // on the unset (2017) clock — JS dates it by the clock offset.
                            // Absent on old firmware: treat as proven and let JS's plausibility
                            // check catch a 2017 stamp.
                            val timeProof = if (rec.has(Bg5sProfile.DATA_TIME_PROOF)) rec.optBoolean(Bg5sProfile.DATA_TIME_PROOF, true) else true
                            emitGlucoseReading(mac, value, rec.optString(Bg5sProfile.DATA_ID, "offline-$i"),
                                bg5sRecordTimestamp(rec), timeProof)
                            emitted++
                        }
                    }
                    sendGlucoseMeterEvent(mac, "offline_synced", "Synced $emitted offline record(s)")
                } else {
                    sendDebugLog("BG5S offline data not an array: $json")
                }
            }
            Bg5sProfile.ACTION_ERROR -> {
                val num = json.optInt(Bg5sProfile.ERROR_NUM, -1)
                val desc = json.optString(Bg5sProfile.ERROR_DESCRIPTION, "")
                val message = "BG5S error $num $desc".trim()
                sendGlucoseMeterEvent(mac, "error", message)
                sendError("BG5S_ERROR", message)
                // A clock-set chain or erase that was waiting on this meter is over.
                bg5sPurgePendingMac = null
                pendingClockPromise?.resolve(false)
                pendingClockPromise = null
                pendingDeletePromise?.resolve(false)
                pendingDeletePromise = null
            }
            else -> sendDebugLog("BG5S: Unhandled action: $action")
        }
    }

    // The meter's clock as reported by getStatusInfo (epoch ms), or null.
    // Reported to JS as deviceDateBefore: (phone − this) is the offset that
    // dates readings taken on the unset clock, so it MUST be parsed in the
    // same frame as bg5sRecordTimestamp parses the records — the meter
    // reports both as "yyyy-MM-dd HH:mm:ss" in UTC. Parsing this one in
    // local time would shift every corrected reading by the phone's UTC
    // offset.
    private fun bg5sStatusDeviceDate(json: JSONObject): Double? {
        val raw = json.opt(Bg5sProfile.INFO_TIME) ?: return null
        return try {
            if (raw is Number) {
                val v = raw.toDouble(); if (v < 1e11) v * 1000 else v
            } else {
                val s = raw.toString().trim()
                s.toDoubleOrNull()?.let { v -> return if (v < 1e11) v * 1000 else v }
                val sdf = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US)
                sdf.timeZone = java.util.TimeZone.getTimeZone("GMT")
                sdf.parse(s)?.time?.toDouble()
            }
        } catch (_: Exception) { null }
    }
    private var bg5sDeviceDateBefore: Double? = null

    // Clock-set chain finished (set, or set + erased): tell JS, settle any
    // waiting setDeviceClock promise, then finish the prep with the unit.
    private fun finishBg5sClockSet(mac: String, purged: Boolean) {
        emitClockSet(mac, "BG5S", purged, bg5sDeviceDateBefore)
        bg5sDeviceDateBefore = null
        pendingClockPromise?.resolve(true)
        pendingClockPromise = null
        try { bg5sControl?.setUnit(Bg5sProfile.UNIT_MG) }
        catch (e: Exception) { sendDebugLog("BG5S setUnit error: ${e.message}") }
    }

    /**
     * Tell JS the app has just set a device's own clock. `at` is the phone's
     * time at that moment (epoch ms); JS stores it as the device's clockSetAt
     * and drops any stored reading stamped earlier. Mirrors iOS
     * emitClockSetForMac.
     */
    private fun emitClockSet(mac: String, deviceType: String, purged: Boolean, deviceDateBefore: Double?) {
        val at = System.currentTimeMillis().toDouble()
        sendDebugLog("CLOCK SET[$deviceType]: at=${at.toLong()} purged=$purged before=${deviceDateBefore?.toLong() ?: "?"}")
        val params = Arguments.createMap().apply {
            putString("mac", mac)
            putString("type", deviceType)
            putDouble("at", at)
            putBoolean("purged", purged)
            putString("source", "iHealthSDK")
            if (deviceDateBefore != null) putDouble("deviceDateBefore", deviceDateBefore)
        }
        sendEvent("onDeviceClockSet", params)
    }

    private fun emitGlucoseReading(mac: String, value: Double, dataID: String, timestamp: Double, timeProof: Boolean = true) {
        sendDebugLog("BG5S RESULT: $value mg/dL (dataID=$dataID, ts=${timestamp.toLong()}, timeProof=$timeProof)")
        val params = Arguments.createMap().apply {
            putString("mac", mac)
            putString("type", "BG5S")
            putDouble("value", value)
            putString("unit", "mg/dL")
            putString("dataID", dataID)
            putString("source", "iHealthSDK")
            // NaN = the meter's time string could not be parsed; omit the key
            // so JS sees no timestamp rather than a bogus one.
            if (!timestamp.isNaN()) putDouble("timestamp", timestamp)
            putBoolean("timeProof", timeProof)
        }
        sendEvent("onBloodGlucoseReading", params)
    }

    private fun sendGlucoseMeterEvent(mac: String, stage: String, message: String) {
        val params = Arguments.createMap().apply {
            putString("stage", stage)
            putString("mac", mac)
            putString("type", "BG5S")
            putString("message", message)
            putString("source", "iHealthSDK")
        }
        sendEvent("onGlucoseMeterEvent", params)
        sendDebugLog("BG5S $stage: $message")
    }

    private fun localTimezoneOffsetHours(): Float =
        java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 3600000.0f

    /**
     * Offline records carry the meter's measure time; the exact key/format can vary
     * by firmware, so parse defensively and fall back to "now" if unparseable.
     */
    private fun bg5sRecordTimestamp(rec: JSONObject): Double {
        val raw = rec.opt(Bg5sProfile.DATA_MEASURE_TIME)
        // Numeric epoch (seconds or millis).
        if (raw is Number) {
            val v = raw.toDouble()
            return if (v > 1_000_000_000_000.0) v else v * 1000.0
        }
        if (raw is String) {
            // Some firmware sends a numeric epoch as a string.
            raw.toDoubleOrNull()?.let { v ->
                return if (v > 1_000_000_000_000.0) v else v * 1000.0
            }
            // BG5S firmware reports the measure time ALREADY IN UTC as "yyyy-MM-dd HH:mm:ss"
            // (verified against the device clock / info_time vs. phone-local time). The
            // separate DATA_MEASURE_TIMEZONE field is the local offset for display only, so
            // we parse the string as GMT and use it directly — no offset shift.
            try {
                val sdf = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US)
                sdf.timeZone = java.util.TimeZone.getTimeZone("GMT")
                val parsedUtc = sdf.parse(raw)
                if (parsedUtc != null) return parsedUtc.time.toDouble()
            } catch (e: Exception) {
                sendDebugLog("BG5S time parse failed for '$raw': ${e.message}")
            }
        }
        // Unparseable: report no timestamp at all. JS treats a reading it
        // cannot date as undatable and leaves it on the meter — never dates
        // it by import time.
        return Double.NaN
    }

    // =========================================================================
    // @ReactMethod — Signatures match iOS + deviceService.ts exactly
    // =========================================================================

    /**
     * authenticate(licensePath: String, promise: Promise)
     *
     * JS calls: IHealthDevices.authenticate("")
     * iOS sig:  authenticate:(NSString *)licensePath resolver:reject:
     *
     * On Android we auto-initialize the SDK here (iOS does it in init + initializeControllers).
     */
    @ReactMethod
    fun authenticate(licensePath: String, promise: Promise) {
        try {
            // Auto-initialize SDK if needed (iOS does this in its constructor)
            ensureInitialized()

            sendDebugLog("Authenticating with license...")
            val context = reactApplicationContext.applicationContext
            val inputStream = context.assets.open("license.pem")
            val buffer = ByteArray(inputStream.available())
            inputStream.read(buffer)
            inputStream.close()

            val isPass = iHealthDevicesManager.getInstance().sdkAuthWithLicense(buffer)
            sendDebugLog("Auth result: $isPass")

            if (isPass) {
                isAuthenticatedFlag = true
                promise.resolve(true)
            } else {
                // iHealth SDK docs: first call may return false while syncing with server
                sendDebugLog("First auth returned false, retrying...")
                Thread.sleep(1000)
                val retryPass = iHealthDevicesManager.getInstance().sdkAuthWithLicense(buffer)
                sendDebugLog("Auth retry result: $retryPass")
                isAuthenticatedFlag = retryPass
                promise.resolve(retryPass)
            }
        } catch (e: java.io.IOException) {
            isAuthenticatedFlag = false
            promise.reject("AUTH_ERROR", "license.pem not found in assets folder", e)
        } catch (e: Exception) {
            sendDebugLog("Auth exception: ${e.message}")
            isAuthenticatedFlag = false
            promise.resolve(false)
        }
    }

    /**
     * isAuthenticated(promise: Promise)
     *
     * JS calls: IHealthDevices.isAuthenticated()
     * iOS sig:  isAuthenticated:resolver:reject:
     */
    @ReactMethod
    fun isAuthenticated(promise: Promise) {
        promise.resolve(isAuthenticatedFlag)
    }

    @ReactMethod
    fun getBluetoothStatus(promise: Promise) {
        promise.resolve(buildBluetoothStatus())
    }

    /**
     * startScan(deviceTypes: ReadableArray, promise: Promise)
     *
     * JS calls: IHealthDevices.startScan(["BP3L", "BP5", "BP5S", "HS2", "HS2S", "HS4S"])
     * iOS sig:  startScan:(NSArray *)deviceTypes resolver:reject:
     *
     * Android iHealth SDK only supports discovering one DiscoveryTypeEnum at a time.
     * We scan each type sequentially using a timer. Each type gets SCAN_WINDOW_MS
     * milliseconds before we move to the next. This avoids race conditions from
     * onScanFinish callbacks firing unpredictably.
     */
    @ReactMethod
    fun startScan(deviceTypes: ReadableArray, promise: Promise) {
        try {
            ensureInitialized()

            val btStatus = buildBluetoothStatus()
            if (!btStatus.getBoolean("ready")) {
                val state = btStatus.getString("state") ?: "unknown"
                val message = btStatus.getString("message") ?: "Bluetooth is not ready."
                val code = when (state) {
                    "unauthorized" -> "BLUETOOTH_UNAUTHORIZED"
                    "location_disabled" -> "LOCATION_DISABLED"
                    "unsupported" -> "BLUETOOTH_UNSUPPORTED"
                    else -> "BLUETOOTH_OFF"
                }
                sendEvent("onBluetoothStateChanged", buildBluetoothStatus())
                sendError(code, message)
                promise.reject(code, message)
                return
            }

            // Cancel any in-progress scan
            scanHandler.removeCallbacks(scanNextRunnable)
            isScanningActive = false
            try { iHealthDevicesManager.getInstance().stopDiscovery() } catch (_: Exception) {}

            val types = mutableListOf<String>()
            for (i in 0 until deviceTypes.size()) {
                deviceTypes.getString(i)?.let { types.add(it) }
            }
            sendDebugLog("Starting scan for: $types")

            // "GATT" asks for generic BLE monitors. Rather than giving it a slot
            // in the rotation, run its scanner CONTINUOUSLY alongside. The
            // iHealth SDK can only discover one type at a time, so its types
            // must take turns — our own scanner has no such limit.
            //
            // As a rotation slot it was 8th of 8, so a generic monitor was only
            // discoverable for 3s out of every 24s and took up to a minute to
            // appear. Continuous means it shows up almost immediately.
            //
            // This leaves the iHealth rotation completely untouched: same seven
            // types, same 3s windows, same order — it no longer even gives up a
            // slot. It also adds nothing to Android's 5-scans-per-30s throttle,
            // since our scanner starts once per session instead of restarting
            // every cycle.
            genericContinuousScan = types.removeAll { it.equals("GATT", ignoreCase = true) }
            if (genericContinuousScan) {
                sendDebugLog("Generic BLE: continuous scan alongside iHealth rotation")
                ensureGenericBle().startScan()
            }

            scanTypesList = types.toList()
            currentScanIndex = 0
            isScanningActive = true

            val params = Arguments.createMap().apply {
                putBoolean("scanning", true)
            }
            sendEvent("onScanStateChanged", params)

            // Begin scanning first type
            advanceToNextType()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SCAN_ERROR", "Failed to start scan: ${e.message}", e)
        }
    }

    /**
     * stopScan(promise: Promise)
     *
     * JS calls: IHealthDevices.stopScan()
     * iOS sig:  stopScan:resolver:reject:
     */
    @ReactMethod
    fun stopScan(promise: Promise) {
        try {
            isScanningActive = false
            scanHandler.removeCallbacks(scanNextRunnable)
            genericBle?.stopScan()
            iHealthDevicesManager.getInstance().stopDiscovery()
            val params = Arguments.createMap().apply {
                putBoolean("scanning", false)
            }
            sendEvent("onScanStateChanged", params)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("STOP_SCAN_ERROR", e.message, e)
        }
    }

    /**
     * connectDevice(mac: String, deviceType: String, promise: Promise)
     *
     * JS calls: IHealthDevices.connectDevice(mac, deviceType)
     * iOS sig:  connectDevice:(NSString *)mac deviceType:(NSString *)deviceType resolver:reject:
     */
    @ReactMethod
    fun connectDevice(mac: String, deviceType: String, promise: Promise) {
        try {
            // Generic BLE devices have their own connect path. Handing one to the
            // iHealth SDK would pass an unknown type name straight through to
            // connectDevice() and confuse it, so intercept before that can happen.
            if (deviceType.startsWith("GATT_", ignoreCase = true)) {
                sendDebugLog("Generic BLE connect requested for $mac — arming instead")
                promise.resolve(ensureGenericBle().arm(mac))
                return
            }

            sendDebugLog("Connecting to $deviceType at $mac")
            targetMAC = mac
            targetType = deviceType

            // Stop scanning before connecting
            isScanningActive = false
            scanHandler.removeCallbacks(scanNextRunnable)
            iHealthDevicesManager.getInstance().stopDiscovery()

            iHealthDevicesManager.getInstance().connectDevice("", mac, getDeviceTypeName(deviceType))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CONNECT_ERROR", "Failed to connect: ${e.message}", e)
        }
    }

    /**
     * connectForBattery(mac: String, deviceType: String, promise: Promise)
     *
     * Connect briefly just to capture a battery level (add-device flow).
     * Android's connect handler already queries battery on every connection
     * and never auto-starts a measurement, so this is a plain connect plus
     * scheduled bookkeeping cleanup — the SDK drops the link itself when
     * the device goes back to sleep. HS4S has no battery API: resolves
     * false without connecting. Battery arrives via onBatteryLevel.
     *
     * iOS sig: connectForBattery:(NSString *)mac deviceType:(NSString *)deviceType resolver:reject:
     */
    @ReactMethod
    fun connectForBattery(mac: String, deviceType: String, promise: Promise) {
        startBatteryOnlyConnect(mac, deviceType, setup = false, promise)
    }

    /**
     * connectForSetup(mac: String, deviceType: String, promise: Promise)
     *
     * Add-device flow. Same short connection as connectForBattery, but the
     * device's own clock is set on the way (and the BG5S's memory erased) —
     * see setupMac. The result lands via onDeviceClockSet; JS records it as
     * the device's clockSetAt. Resolves false for types this cannot reach.
     *
     * iOS sig: connectForSetup:(NSString *)mac deviceType:(NSString *)deviceType resolver:reject:
     */
    @ReactMethod
    fun connectForSetup(mac: String, deviceType: String, promise: Promise) {
        startBatteryOnlyConnect(mac, deviceType, setup = true, promise)
    }

    /**
     * setDeviceClock(mac: String, deviceType: String, purge: Boolean, promise: Promise)
     *
     * Set the clock on a device that is ALREADY connected (capture flow).
     * BG5S: setTime, and with `purge` erase its memory too — used when a
     * meter reaches the capture screen never having been set up, so the
     * patient is asked for a fresh reading instead of importing one stamped
     * 2017. BP5S: getFunctionInfo (the SDK's time sync). Everything else
     * resolves false. Settles when the SDK's notify for the last step lands.
     *
     * iOS sig: setDeviceClock:(NSString *)mac deviceType:(NSString *)deviceType purge:(BOOL)purge resolver:reject:
     */
    @ReactMethod
    fun setDeviceClock(mac: String, deviceType: String, purge: Boolean, promise: Promise) {
        try {
            when (deviceType) {
                "BG5S" -> {
                    val control = bg5sControl ?: iHealthDevicesManager.getInstance().getBg5sControl(mac)
                    if (control == null) { promise.resolve(false); return }
                    bg5sControl = control
                    pendingClockPromise?.resolve(false)
                    pendingClockPromise = promise
                    bg5sPurgePendingMac = if (purge) mac else null
                    control.setTime(java.util.Date(), localTimezoneOffsetHours())
                }
                "BP5S" -> {
                    val control = iHealthDevicesManager.getInstance().getBp5sControl(mac)
                    if (control == null) { promise.resolve(false); return }
                    pendingClockPromise?.resolve(false)
                    pendingClockPromise = promise
                    control.getFunctionInfo()
                }
                else -> promise.resolve(false)
            }
        } catch (e: Exception) {
            pendingClockPromise = null
            bg5sPurgePendingMac = null
            promise.reject("SET_CLOCK_ERROR", "Failed to set $deviceType clock: ${e.message}", e)
        }
    }

    /**
     * deleteDeviceRecords(mac: String, deviceType: String, promise: Promise)
     *
     * Erase the stored readings on an ALREADY-connected glucose meter. Called
     * by the capture flow after every record it pulled has been saved
     * locally, so a record is never re-delivered — and never re-dated against
     * a later, different clock offset. Best-effort: if the meter has gone to
     * sleep the records simply stay, and the app's deterministic reading ids
     * skip them next time. Resolves true only when the meter confirmed.
     *
     * iOS sig: deleteDeviceRecords:(NSString *)mac deviceType:(NSString *)deviceType resolver:reject:
     */
    @ReactMethod
    fun deleteDeviceRecords(mac: String, deviceType: String, promise: Promise) {
        if (deviceType != "BG5S") { promise.resolve(false); return }
        try {
            val control = bg5sControl ?: iHealthDevicesManager.getInstance().getBg5sControl(mac)
            if (control == null) { promise.resolve(false); return }
            pendingDeletePromise?.resolve(false)
            pendingDeletePromise = promise
            sendGlucoseMeterEvent(mac, "delete_offline", "Erasing imported records from the meter")
            control.deleteOfflineData()
        } catch (e: Exception) {
            pendingDeletePromise = null
            sendDebugLog("BG5S deleteOfflineData error: ${e.message}")
            promise.resolve(false)
        }
    }

    private fun startBatteryOnlyConnect(mac: String, deviceType: String, setup: Boolean, promise: Promise) {
        val supported = setOf("BP3L", "BP5", "BP5S", "HS2", "HS2S", "BG5S")
        if (deviceType !in supported) {
            promise.resolve(false)
            return
        }
        try {
            sendDebugLog("${if (setup) "Setup" else "Battery-only"} connect: $deviceType at $mac")
            setupMac = if (setup) mac else null
            targetMAC = mac
            targetType = deviceType

            isScanningActive = false
            scanHandler.removeCallbacks(scanNextRunnable)
            iHealthDevicesManager.getInstance().stopDiscovery()

            iHealthDevicesManager.getInstance().connectDevice("", mac, getDeviceTypeName(deviceType))
            promise.resolve(true)

            // No delayed cleanup here on purpose: the SDK's own
            // DEVICE_STATE_DISCONNECTED callback maintains connectedDevices.
            // A blind timed removal raced with a real capture started on the
            // same device shortly after adding it, making startMeasurement
            // reject with NOT_CONNECTED while the BLE link was actually up.
        } catch (e: Exception) {
            promise.reject("CONNECT_ERROR", "Failed battery-only connect: ${e.message}", e)
        }
    }

    /**
     * disconnectDevice(mac: String, promise: Promise)
     *
     * JS calls: IHealthDevices.disconnectDevice(mac)
     * iOS sig:  disconnectDevice:(NSString *)mac resolver:reject:
     */
    @ReactMethod
    fun disconnectDevice(mac: String, promise: Promise) {
        try {
            sendDebugLog("Disconnecting: $mac")
            connectedDevices.remove(mac)
            // The Android SDK auto-disconnects when the connection drops.
            // No explicit disconnect API like iOS commandDisconnectDevice.
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("DISCONNECT_ERROR", e.message, e)
        }
    }

    /**
     * disconnectAll(promise: Promise)
     *
     * JS calls: IHealthDevices.disconnectAll()
     * iOS sig:  disconnectAll:resolver:reject:
     */
    @ReactMethod
    fun disconnectAll(promise: Promise) {
        try {
            sendDebugLog("Disconnecting all devices")
            connectedDevices.clear()
            targetMAC = null
            targetType = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("DISCONNECT_ALL_ERROR", e.message, e)
        }
    }

    /**
     * startMeasurement(mac: String, promise: Promise)
     *
     * JS calls: IHealthDevices.startMeasurement(mac)
     * iOS sig:  startMeasurement:(NSString *)mac resolver:reject:
     *
     * Device type is looked up from connectedDevices map (iOS does the same internally).
     */
    @ReactMethod
    fun startMeasurement(mac: String, promise: Promise) {
        try {
            val deviceType = getConnectedDeviceType(mac)
            if (deviceType == null) {
                promise.reject("NOT_CONNECTED", "No connected device with mac: $mac")
                return
            }

            sendDebugLog("Starting measurement on $deviceType at $mac")
            when (deviceType) {
                "BP3L" -> {
                    val c = iHealthDevicesManager.getInstance().getBp3lControl(mac)
                    if (c != null) { c.startMeasure(); promise.resolve(null) }
                    else promise.reject("NO_CONTROL", "BP3L control not available")
                }
                "BP5" -> {
                    val c = iHealthDevicesManager.getInstance().getBp5Control(mac)
                    if (c != null) { c.startMeasure(); promise.resolve(null) }
                    else promise.reject("NO_CONTROL", "BP5 control not available")
                }
                "BP5S" -> {
                    val c = iHealthDevicesManager.getInstance().getBp5sControl(mac)
                    if (c != null) { c.startMeasure(); promise.resolve(null) }
                    else promise.reject("NO_CONTROL", "BP5S control not available")
                }
                "HS2" -> {
                    val c = iHealthDevicesManager.getInstance().getHs2Control(mac)
                    if (c != null) { sendDebugLog("HS2: Ready. Step on scale."); promise.resolve(null) }
                    else promise.reject("NO_CONTROL", "HS2 control not available")
                }
                "HS2S" -> {
                    val c = iHealthDevicesManager.getInstance().getHs2sControl(mac)
                    if (c != null) { sendDebugLog("HS2S: Ready. Step on scale."); promise.resolve(null) }
                    else promise.reject("NO_CONTROL", "HS2S control not available")
                }
                "HS4S" -> {
                    val c = iHealthDevicesManager.getInstance().getHs4sControl(mac)
                    if (c != null) { sendDebugLog("HS4S: Ready. Step on scale."); promise.resolve(null) }
                    else promise.reject("NO_CONTROL", "HS4S control not available")
                }
                "BG5S" -> {
                    val c = bg5sControl ?: iHealthDevicesManager.getInstance().getBg5sControl(mac)
                    if (c != null) {
                        bg5sControl = c
                        c.startMeasure(Bg5sProfile.MEASURE_BLOOD)
                        sendGlucoseMeterEvent(mac, "start_measure", "Insert a strip and apply blood")
                        promise.resolve(null)
                    } else promise.reject("NO_CONTROL", "BG5S control not available")
                }
                else -> promise.reject("UNSUPPORTED", "Unsupported device: $deviceType")
            }
        } catch (e: Exception) {
            promise.reject("MEASURE_ERROR", e.message, e)
        }
    }

    /**
     * stopMeasurement(mac: String, promise: Promise)
     *
     * JS calls: IHealthDevices.stopMeasurement(mac)
     * iOS sig:  stopMeasurement:(NSString *)mac resolver:reject:
     */
    @ReactMethod
    fun stopMeasurement(mac: String, promise: Promise) {
        // iOS also just resolves nil here
        promise.resolve(null)
    }

    /**
     * getConnectedDevices(promise: Promise)
     *
     * JS calls: IHealthDevices.getConnectedDevices()
     * iOS sig:  getConnectedDevices:resolver:reject:
     */
    @ReactMethod
    fun getConnectedDevices(promise: Promise) {
        val result = Arguments.createArray()
        for ((mac, info) in connectedDevices) {
            val device = Arguments.createMap().apply {
                putString("mac", mac)
                putString("type", info["type"] ?: "Unknown")
                putString("source", info["source"] ?: "iHealthSDK")
            }
            result.pushMap(device)
        }
        promise.resolve(result)
    }

    /**
     * getBatteryLevel(mac: String, promise: Promise)
     *
     * JS calls: IHealthDevices.getBatteryLevel(mac)
     * iOS sig:  getBatteryLevel:(NSString *)mac resolver:reject:
     *
     * Returns -1 (not available) — matches iOS behavior.
     */
    @ReactMethod
    fun getBatteryLevel(mac: String, promise: Promise) {
        promise.resolve(-1)
    }

    // =========================================================================
    // Generic BLE (A&D and other standard GATT BP/scale profiles)
    //
    // Mirrors the iOS bleBondDevice / bleArm / bleDisarm surface. Deliberately
    // separate entry points: nothing here goes near the iHealth SDK, and the
    // iHealth methods never route in here.
    // =========================================================================

    /**
     * bleBondDevice(address, promise) — Add Device flow.
     *
     * Must run while the monitor is advertising in pairing mode (UA-651BLE: hold
     * START ~3s until "Pr" shows with a flashing Bluetooth icon). Connecting is
     * what triggers Android's bonding prompt; without a bond the device never
     * advertises again and capture can never reach it.
     *
     * Also sets the device clock and reads identity + battery, delivered as
     * onBleDeviceInfo. Resolving true means the connect was started, not that
     * bonding succeeded — the user can still decline the prompt.
     */
    @ReactMethod
    fun bleBondDevice(address: String, promise: Promise) {
        try {
            // The rotation must not restart iHealth discovery mid-bond.
            isScanningActive = false
            scanHandler.removeCallbacks(scanNextRunnable)
            try { iHealthDevicesManager.getInstance().stopDiscovery() } catch (_: Exception) {}

            val started = ensureGenericBle().bondDevice(address)
            if (started) {
                promise.resolve(true)
            } else {
                promise.reject(
                    "BLE_NO_PERIPHERAL",
                    "Device not found. Put the monitor in pairing mode and scan again."
                )
            }
        } catch (e: Exception) {
            promise.reject("BLE_BOND_ERROR", e.message, e)
        }
    }

    /**
     * bleArm(address, promise) — capture flow.
     *
     * Leaves a standing autoConnect request open. Android does not contact the
     * monitor until it advertises, so the cuff stays asleep and its own idle
     * power-off timer never starts early. The patient measures whenever they
     * like and the phone collects the moment the monitor broadcasts.
     */
    @ReactMethod
    fun bleArm(address: String, promise: Promise) {
        try {
            isScanningActive = false
            scanHandler.removeCallbacks(scanNextRunnable)
            try { iHealthDevicesManager.getInstance().stopDiscovery() } catch (_: Exception) {}

            promise.resolve(ensureGenericBle().arm(address))
        } catch (e: Exception) {
            promise.reject("BLE_ARM_ERROR", e.message, e)
        }
    }

    /**
     * bleDisarm(address, promise) — cancels the standing request and any live
     * link. Safe to call when nothing is armed.
     */
    @ReactMethod
    fun bleDisarm(address: String, promise: Promise) {
        try {
            genericBle?.disarm(address)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("BLE_DISARM_ERROR", e.message, e)
        }
    }

    // =========================================================================
    // Required for NativeEventEmitter
    // =========================================================================

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN NativeEventEmitter
    }
}
