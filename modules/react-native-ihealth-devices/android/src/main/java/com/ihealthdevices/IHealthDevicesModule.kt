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

    private var isAuthenticated = false
    private var isInitialized = false
    private var callbackId = 0
    private val connectedDevices = mutableMapOf<String, String>()
    private var targetMAC: String? = null
    private var targetType: String? = null

    override fun getName(): String = NAME

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun sendDebugLog(message: String) {
        Log.d(TAG, message)
        val params = Arguments.createMap().apply {
            putString("message", message)
            putDouble("timestamp", System.currentTimeMillis().toDouble())
        }
        sendEvent("onDebugLog", params)
    }

    private fun sendError(code: String, message: String) {
        Log.e(TAG, "Error [$code]: $message")
        val params = Arguments.createMap().apply {
            putString("code", code)
            putString("message", message)
        }
        sendEvent("onError", params)
    }

    private fun getDiscoveryType(deviceType: String): DiscoveryTypeEnum? {
        return when (deviceType.uppercase()) {
            "BP3L" -> DiscoveryTypeEnum.BP3L
            "BP5" -> DiscoveryTypeEnum.BP5
            "BP5S" -> DiscoveryTypeEnum.BP5S
            "BG5" -> DiscoveryTypeEnum.BG5
            "BG5S" -> DiscoveryTypeEnum.BG5S
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
            type.contains("BG5S", ignoreCase = true) -> "BG5S"
            type.contains("BG5", ignoreCase = true) -> "BG5"
            type.contains("HS2S", ignoreCase = true) -> "HS2S"
            type.contains("HS2", ignoreCase = true) -> "HS2"
            type.contains("HS4S", ignoreCase = true) || type.contains("HS4", ignoreCase = true) -> "HS4S"
            else -> type
        }
    }

    // =========================================================================
    // iHEALTH CALLBACK - SDK v2.15.1 signatures
    // =========================================================================

    private val iHealthCallback = object : iHealthDevicesCallback() {

        override fun onScanDevice(mac: String?, deviceType: String?, rssi: Int) {
            sendDebugLog("SCAN: Found device mac=$mac type=$deviceType rssi=$rssi")
            if (mac == null || deviceType == null) return
            val normalizedType = getDeviceTypeName(deviceType)
            val params = Arguments.createMap().apply {
                putString("mac", mac)
                putString("deviceType", normalizedType)
                putString("name", "$normalizedType ($mac)")
                putInt("rssi", rssi)
            }
            sendEvent("onDeviceFound", params)
        }

        override fun onScanFinish() {
            sendDebugLog("SCAN: Finished")
            val params = Arguments.createMap().apply {
                putString("state", "stopped")
            }
            sendEvent("onScanStateChanged", params)
        }

        override fun onDeviceConnectionStateChange(mac: String?, deviceType: String?, status: Int, errorId: Int) {
            sendDebugLog("CONNECTION: mac=$mac type=$deviceType status=$status errorId=$errorId")
            if (mac == null || deviceType == null) return
            val normalizedType = getDeviceTypeName(deviceType)
            val state = when (status) {
                iHealthDevicesManager.DEVICE_STATE_CONNECTED -> {
                    connectedDevices[mac] = normalizedType
                    "connected"
                }
                iHealthDevicesManager.DEVICE_STATE_DISCONNECTED -> {
                    connectedDevices.remove(mac)
                    "disconnected"
                }
                iHealthDevicesManager.DEVICE_STATE_CONNECTIONFAIL -> "failed"
                else -> "unknown_$status"
            }
            val params = Arguments.createMap().apply {
                putString("mac", mac)
                putString("deviceType", normalizedType)
                putString("state", state)
                putInt("statusCode", status)
                putInt("errorId", errorId)
            }
            sendEvent("onConnectionStateChanged", params)
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
                    normalizedType.startsWith("BG") -> handleBGNotification(mac, normalizedType, action, json)
                    normalizedType.startsWith("HS") -> handleHSNotification(mac, normalizedType, action, json)
                    else -> sendDebugLog("NOTIFY: Unhandled device type: $normalizedType")
                }
            } catch (e: Exception) {
                sendDebugLog("NOTIFY: Parse error: ${e.message}")
            }
        }
    }

    // =========================================================================
    // BLOOD PRESSURE
    // =========================================================================

    private fun handleBPNotification(mac: String, deviceType: String, action: String, json: JSONObject) {
        sendDebugLog("BP[$deviceType]: action=$action keys=${json.keys().asSequence().toList()}")
        when {
            action.contains("result", ignoreCase = true) -> {
                val systolic = json.optInt("hp", json.optInt("sys", 0))
                val diastolic = json.optInt("lp", json.optInt("dia", 0))
                val pulse = json.optInt("pr", json.optInt("pulse", 0))
                val ahr = json.optBoolean("ahr", false)
                if (systolic > 0 && diastolic > 0) {
                    sendDebugLog("BP RESULT: sys=$systolic dia=$diastolic pulse=$pulse")
                    val params = Arguments.createMap().apply {
                        putString("mac", mac)
                        putString("deviceType", deviceType)
                        putInt("systolic", systolic)
                        putInt("diastolic", diastolic)
                        putInt("pulse", pulse)
                        putBoolean("irregularHeartbeat", ahr)
                        putString("timestamp", System.currentTimeMillis().toString())
                    }
                    sendEvent("onBloodPressureReading", params)
                }
            }
            action.contains("pressure", ignoreCase = true) -> {
                sendDebugLog("BP PRESSURE: ${json.optInt("pressure", 0)} mmHg")
            }
            action.contains("offline", ignoreCase = true) || action.contains("history", ignoreCase = true) -> {
                sendDebugLog("BP OFFLINE: $json")
            }
            action.contains("error", ignoreCase = true) -> {
                sendError("BP_ERROR", "Blood pressure error: $json")
            }
            else -> sendDebugLog("BP: Unhandled action: $action")
        }
    }

    // =========================================================================
    // BLOOD GLUCOSE
    // =========================================================================

    private fun handleBGNotification(mac: String, deviceType: String, action: String, json: JSONObject) {
        sendDebugLog("BG[$deviceType]: action=$action keys=${json.keys().asSequence().toList()}")
        when {
            action.contains("strip", ignoreCase = true) -> {
                val params = Arguments.createMap().apply {
                    putString("mac", mac)
                    putString("deviceType", deviceType)
                    putString("state", "strip_inserted")
                }
                sendEvent("onBloodGlucoseReading", params)
            }
            action.contains("blood", ignoreCase = true) -> {
                val params = Arguments.createMap().apply {
                    putString("mac", mac)
                    putString("deviceType", deviceType)
                    putString("state", "measuring")
                }
                sendEvent("onBloodGlucoseReading", params)
            }
            action.contains("result", ignoreCase = true) || action.contains("value", ignoreCase = true) -> {
                val glucose = json.optInt("value", json.optInt("glucose", 0))
                if (glucose > 0) {
                    sendDebugLog("BG RESULT: glucose=$glucose mg/dL")
                    val params = Arguments.createMap().apply {
                        putString("mac", mac)
                        putString("deviceType", deviceType)
                        putInt("glucose", glucose)
                        putString("state", "result")
                        putString("timestamp", System.currentTimeMillis().toString())
                    }
                    sendEvent("onBloodGlucoseReading", params)
                }
            }
            action.contains("error", ignoreCase = true) -> sendError("BG_ERROR", "Glucose error: $json")
            else -> sendDebugLog("BG: Unhandled action: $action")
        }
    }

    // =========================================================================
    // SCALE (WEIGHT)
    // =========================================================================

    private fun handleHSNotification(mac: String, deviceType: String, action: String, json: JSONObject) {
        sendDebugLog("HS[$deviceType]: action=$action keys=${json.keys().asSequence().toList()}")
        when {
            action.contains("unstable", ignoreCase = true) || action.contains("unsteady", ignoreCase = true) -> {
                sendDebugLog("HS UNSTABLE: weight=${json.optDouble("weight", 0.0)} kg")
            }
            action.contains("result", ignoreCase = true) || action.contains("stable", ignoreCase = true) -> {
                val weight = json.optDouble("weight", 0.0)
                if (weight > 0) {
                    val weightLbs = weight * 2.20462
                    sendDebugLog("HS RESULT: weight=${weight}kg (${String.format("%.1f", weightLbs)}lbs)")
                    val params = Arguments.createMap().apply {
                        putString("mac", mac)
                        putString("deviceType", deviceType)
                        putDouble("weight", weight)
                        putDouble("weightLbs", weightLbs)
                        putString("timestamp", System.currentTimeMillis().toString())
                    }
                    sendEvent("onWeightReading", params)
                }
            }
            action.contains("error", ignoreCase = true) -> sendError("HS_ERROR", "Scale error: $json")
            else -> sendDebugLog("HS: Unhandled action: $action")
        }
    }

    // =========================================================================
    // EXPORTED METHODS
    // =========================================================================

    @ReactMethod
    fun initialize(promise: Promise) {
        try {
            sendDebugLog("Initializing iHealth SDK...")
            val app = reactApplicationContext.applicationContext as Application
            iHealthDevicesManager.getInstance().init(app, Log.VERBOSE, Log.VERBOSE)
            callbackId = iHealthDevicesManager.getInstance().registerClientCallback(iHealthCallback)
            sendDebugLog("Registered callback with ID: $callbackId")
            isInitialized = true
            promise.resolve(true)
        } catch (e: Exception) {
            sendDebugLog("Init error: ${e.message}")
            promise.reject("INIT_ERROR", "Failed to initialize: ${e.message}", e)
        }
    }

    @ReactMethod
    fun authenticate(promise: Promise) {
        try {
            sendDebugLog("Authenticating with license...")
            val context = reactApplicationContext.applicationContext
            val inputStream = context.assets.open("license.pem")
            val buffer = ByteArray(inputStream.available())
            inputStream.read(buffer)
            inputStream.close()
            val isPass = iHealthDevicesManager.getInstance().sdkAuthWithLicense(buffer)
            sendDebugLog("Auth result: $isPass")
            if (isPass) {
                isAuthenticated = true
                promise.resolve(true)
            } else {
                sendDebugLog("First auth returned false, retrying...")
                Thread.sleep(1000)
                val retryPass = iHealthDevicesManager.getInstance().sdkAuthWithLicense(buffer)
                sendDebugLog("Auth retry result: $retryPass")
                isAuthenticated = retryPass
                promise.resolve(retryPass)
            }
        } catch (e: java.io.IOException) {
            promise.reject("AUTH_ERROR", "license.pem not found in assets folder", e)
        } catch (e: Exception) {
            promise.reject("AUTH_ERROR", "Authentication failed: ${e.message}", e)
        }
    }

    @ReactMethod
    fun scanForDevices(deviceType: String, promise: Promise) {
        try {
            if (!isInitialized) {
                promise.reject("NOT_INITIALIZED", "Call initialize() first")
                return
            }
            val discoveryType = getDiscoveryType(deviceType)
            if (discoveryType == null) {
                promise.reject("INVALID_TYPE", "Unknown device type: $deviceType")
                return
            }
            sendDebugLog("Starting scan for $deviceType")
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BP3L)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BP5)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BP5S)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BG5)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_BG5S)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_HS2)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_HS2S)
            iHealthDevicesManager.getInstance().addCallbackFilterForDeviceType(callbackId, iHealthDevicesManager.TYPE_HS4S)
            iHealthDevicesManager.getInstance().startDiscovery(discoveryType)
            targetType = deviceType
            val params = Arguments.createMap().apply {
                putString("state", "scanning")
                putString("deviceType", deviceType)
            }
            sendEvent("onScanStateChanged", params)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SCAN_ERROR", "Failed to start scan: ${e.message}", e)
        }
    }

    @ReactMethod
    fun stopScan(promise: Promise) {
        try {
            iHealthDevicesManager.getInstance().stopDiscovery()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_SCAN_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun connectDevice(mac: String, deviceType: String, promise: Promise) {
        try {
            if (!isAuthenticated) {
                promise.reject("NOT_AUTHENTICATED", "Call authenticate() first")
                return
            }
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

    @ReactMethod
    fun disconnectDevice(mac: String, promise: Promise) {
        try {
            connectedDevices.remove(mac)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DISCONNECT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun startMeasurement(mac: String, deviceType: String, promise: Promise) {
        try {
            val t = getDeviceTypeName(deviceType)
            sendDebugLog("Starting measurement on $t at $mac")
            when (t) {
                "BP3L" -> {
                    val c = iHealthDevicesManager.getInstance().getBp3lControl(mac)
                    if (c != null) { c.startMeasure(); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "BP3L not connected")
                }
                "BP5" -> {
                    val c = iHealthDevicesManager.getInstance().getBp5Control(mac)
                    if (c != null) { c.startMeasure(); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "BP5 not connected")
                }
                "BP5S" -> {
                    val c = iHealthDevicesManager.getInstance().getBp5sControl(mac)
                    if (c != null) { c.startMeasure(); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "BP5S not connected")
                }
                "BG5" -> {
                    sendDebugLog("BG5: Strip-triggered. Insert test strip.")
                    promise.resolve(true)
                }
                "BG5S" -> {
                    sendDebugLog("BG5S: Strip-triggered. Insert test strip.")
                    promise.resolve(true)
                }
                "HS2" -> {
                    val c = iHealthDevicesManager.getInstance().getHs2Control(mac)
                    if (c != null) { sendDebugLog("HS2: Ready. Step on scale."); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "HS2 not connected")
                }
                "HS2S" -> {
                    val c = iHealthDevicesManager.getInstance().getHs2sControl(mac)
                    if (c != null) { sendDebugLog("HS2S: Ready. Step on scale."); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "HS2S not connected")
                }
                "HS4S" -> {
                    val c = iHealthDevicesManager.getInstance().getHs4sControl(mac)
                    if (c != null) { sendDebugLog("HS4S: Ready. Step on scale."); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "HS4S not connected")
                }
                else -> promise.reject("UNSUPPORTED", "Unsupported: $t")
            }
        } catch (e: Exception) {
            promise.reject("MEASURE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getOfflineData(mac: String, deviceType: String, promise: Promise) {
        try {
            val t = getDeviceTypeName(deviceType)
            sendDebugLog("Getting offline data from $t at $mac")
            when (t) {
                "BP5" -> {
                    val c = iHealthDevicesManager.getInstance().getBp5Control(mac)
                    if (c != null) { c.getOfflineData(); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "BP5 not connected")
                }
                "BP5S" -> {
                    val c = iHealthDevicesManager.getInstance().getBp5sControl(mac)
                    if (c != null) { c.getOfflineData(); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "BP5S not connected")
                }
                "HS2" -> {
                    val c = iHealthDevicesManager.getInstance().getHs2Control(mac)
                    if (c != null) { c.getOfflineData(); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "HS2 not connected")
                }
                "HS2S" -> {
                    val c = iHealthDevicesManager.getInstance().getHs2sControl(mac)
                    if (c != null) { c.getOfflineData(""); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "HS2S not connected")
                }
                "HS4S" -> {
                    val c = iHealthDevicesManager.getInstance().getHs4sControl(mac)
                    if (c != null) { c.getOfflineData(); promise.resolve(true) }
                    else promise.reject("NO_CONTROL", "HS4S not connected")
                }
                else -> {
                    sendDebugLog("Offline data not supported for $t")
                    promise.resolve(false)
                }
            }
        } catch (e: Exception) {
            promise.reject("OFFLINE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getConnectedDevices(promise: Promise) {
        val result = Arguments.createArray()
        for ((mac, type) in connectedDevices) {
            val device = Arguments.createMap().apply {
                putString("mac", mac)
                putString("deviceType", type)
            }
            result.pushMap(device)
        }
        promise.resolve(result)
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        try {
            iHealthDevicesManager.getInstance().unRegisterClientCallback(callbackId)
            iHealthDevicesManager.getInstance().stopDiscovery()
            connectedDevices.clear()
            isAuthenticated = false
            isInitialized = false
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DESTROY_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}