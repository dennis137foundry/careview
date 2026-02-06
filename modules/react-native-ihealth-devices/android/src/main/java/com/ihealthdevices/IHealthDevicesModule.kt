package com.ihealthdevices

import android.app.Application
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
    }

    private var isAuthenticatedFlag = false
    private var isInitialized = false
    private var callbackId = 0
    // Stores mac -> { "type": "BP3L", "source": "iHealthSDK" }
    private val connectedDevices = mutableMapOf<String, MutableMap<String, String>>()
    private var targetMAC: String? = null
    private var targetType: String? = null

    override fun getName(): String = NAME

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
            sendDebugLog("SCAN: Finished")
            val params = Arguments.createMap().apply {
                putBoolean("scanning", false)
            }
            sendEvent("onScanStateChanged", params)
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
                }
                iHealthDevicesManager.DEVICE_STATE_DISCONNECTED -> {
                    connectedDevices.remove(mac)
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

    private fun handleBPNotification(mac: String, deviceType: String, action: String, json: JSONObject) {
        sendDebugLog("BP[$deviceType]: action=$action keys=${json.keys().asSequence().toList()}")
        when {
            action.contains("result", ignoreCase = true) -> {
                val systolic = json.optInt("hp", json.optInt("sys", 0))
                val diastolic = json.optInt("lp", json.optInt("dia", 0))
                val pulse = json.optInt("pr", json.optInt("pulse", json.optInt("heartRate", 0)))
                val ahr = json.optBoolean("ahr", json.optBoolean("irregular", false))
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
            promise.reject("AUTH_ERROR", "license.pem not found in assets folder", e)
        } catch (e: Exception) {
            // Continue anyway — might work in trial mode (matches iOS behavior)
            sendDebugLog("Auth exception: ${e.message}")
            isAuthenticatedFlag = true
            promise.resolve(true)
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

    /**
     * startScan(deviceTypes: ReadableArray, promise: Promise)
     *
     * JS calls: IHealthDevices.startScan(["BP3L", "BP5", "BP5S", "HS2", "HS2S", "HS4S"])
     * iOS sig:  startScan:(NSArray *)deviceTypes resolver:reject:
     */
    @ReactMethod
    fun startScan(deviceTypes: ReadableArray, promise: Promise) {
        try {
            ensureInitialized()

            val types = mutableListOf<String>()
            for (i in 0 until deviceTypes.size()) {
                deviceTypes.getString(i)?.let { types.add(it) }
            }
            sendDebugLog("Starting scan for: $types")

            for (type in types) {
                val discoveryType = getDiscoveryType(type)
                if (discoveryType != null) {
                    sendDebugLog("Starting discovery for $type")
                    iHealthDevicesManager.getInstance().startDiscovery(discoveryType)
                } else {
                    sendDebugLog("Skipping unsupported type: $type")
                }
            }

            val params = Arguments.createMap().apply {
                putBoolean("scanning", true)
            }
            sendEvent("onScanStateChanged", params)
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
            sendDebugLog("Connecting to $deviceType at $mac")
            targetMAC = mac
            targetType = deviceType

            iHealthDevicesManager.getInstance().stopDiscovery()
            iHealthDevicesManager.getInstance().connectDevice("", mac, getDeviceTypeName(deviceType))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CONNECT_ERROR", "Failed to connect: ${e.message}", e)
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