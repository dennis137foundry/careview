package com.ihealthdevices

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.ihealth.communication.control.*
import com.ihealth.communication.manager.iHealthDevicesManager
import com.ihealth.communication.manager.iHealthDevicesCallback
import org.json.JSONArray

class IHealthDevicesModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var isAuthenticated = false
    private val connectedDevices = mutableMapOf<String, String>()
    private var callbackId: Int = 0

    override fun getName(): String = "IHealthDevices"

    private val iHealthCallback = object : iHealthDevicesCallback() {
        override fun onScanDevice(mac: String?, deviceType: String?, rssi: Int, manufactureData: MutableMap<String, Any>?) {
            mac ?: return
            val params = Arguments.createMap().apply {
                putString("mac", mac)
                putString("name", manufactureData?.get("deviceName")?.toString() ?: deviceType ?: "")
                putString("type", deviceType ?: "")
                putString("connectionType", if (deviceType == "BP5" || deviceType == "BG5") "CLASSIC" else "BLE")
                putInt("rssi", rssi)
            }
            sendEvent("onDeviceFound", params)
        }

        override fun onDeviceConnectionStateChange(mac: String?, deviceType: String?, status: Int, errorId: Int, manufactureData: MutableMap<String, Any>?) {
            mac ?: return
            val connected = status == iHealthDevicesManager.DEVICE_STATE_CONNECTED
            if (connected) {
                connectedDevices[mac] = deviceType ?: ""
            } else {
                connectedDevices.remove(mac)
            }
            val params = Arguments.createMap().apply {
                putString("mac", mac)
                putString("type", deviceType ?: "")
                putBoolean("connected", connected)
            }
            sendEvent("onConnectionStateChanged", params)
        }
    }

    init {
        iHealthDevicesManager.getInstance().init(reactContext.applicationContext, 0, 0)
        callbackId = iHealthDevicesManager.getInstance().registerClientCallback(iHealthCallback)
    }

    override fun onCatalystInstanceDestroy() {
        iHealthDevicesManager.getInstance().unRegisterClientCallback(callbackId)
        super.onCatalystInstanceDestroy()
    }

    @ReactMethod
    fun authenticate(licensePath: String, promise: Promise) {
        try {
            val inputStream = reactContext.assets.open("license.pem")
            val licenseBytes = inputStream.readBytes()
            inputStream.close()
            val result = iHealthDevicesManager.getInstance().sdkAuthWithLicense(reactContext.applicationContext, licenseBytes)
            isAuthenticated = result
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("AUTH_ERROR", e.message)
        }
    }

    @ReactMethod
    fun isAuthenticated(promise: Promise) {
        promise.resolve(isAuthenticated)
    }

    @ReactMethod
    fun startScan(deviceTypes: ReadableArray, promise: Promise) {
        if (!isAuthenticated) {
            promise.reject("NOT_AUTH", "SDK not authenticated")
            return
        }
        var typeMask = 0L
        for (i in 0 until deviceTypes.size()) {
            typeMask = typeMask or getDeviceTypeMask(deviceTypes.getString(i))
        }
        iHealthDevicesManager.getInstance().startDiscovery(typeMask)
        sendEvent("onScanStateChanged", Arguments.createMap().apply { putBoolean("scanning", true) })
        promise.resolve(null)
    }

    @ReactMethod
    fun stopScan(promise: Promise) {
        iHealthDevicesManager.getInstance().stopDiscovery()
        sendEvent("onScanStateChanged", Arguments.createMap().apply { putBoolean("scanning", false) })
        promise.resolve(null)
    }

    @ReactMethod
    fun connectDevice(mac: String, deviceType: String, promise: Promise) {
        iHealthDevicesManager.getInstance().connectDevice("", mac, deviceType)
        promise.resolve(true)
    }

    @ReactMethod
    fun disconnectDevice(mac: String, promise: Promise) {
        val deviceType = connectedDevices[mac] ?: ""
        iHealthDevicesManager.getInstance().disconnectDevice(mac, deviceType)
        connectedDevices.remove(mac)
        promise.resolve(null)
    }

    @ReactMethod
    fun disconnectAll(promise: Promise) {
        connectedDevices.forEach { (mac, type) ->
            iHealthDevicesManager.getInstance().disconnectDevice(mac, type)
        }
        connectedDevices.clear()
        promise.resolve(null)
    }

    @ReactMethod
    fun startMeasurement(mac: String, promise: Promise) {
        val deviceType = connectedDevices[mac]
        when {
            deviceType?.startsWith("BP") == true -> startBPMeasurement(mac, deviceType)
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun stopMeasurement(mac: String, promise: Promise) {
        val deviceType = connectedDevices[mac]
        when {
            deviceType?.startsWith("BP") == true -> stopBPMeasurement(mac, deviceType)
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun syncOfflineData(mac: String, promise: Promise) {
        promise.resolve("[]")
    }

    @ReactMethod
    fun getBatteryLevel(mac: String, promise: Promise) {
        promise.resolve(-1)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun startBPMeasurement(mac: String, type: String) {
        when (type) {
            "BP3L" -> BP3LControl.getInstance().startMeasure(mac)
            "BP5" -> BP5Control.getInstance().startMeasure(mac)
            "BP5S" -> BP5SControl.getInstance().startMeasure(mac)
        }
    }

    private fun stopBPMeasurement(mac: String, type: String) {
        when (type) {
            "BP3L" -> BP3LControl.getInstance().stopMeasure(mac)
            "BP5" -> BP5Control.getInstance().interruptMeasure(mac)
            "BP5S" -> BP5SControl.getInstance().stopMeasure(mac)
        }
    }

    private fun getDeviceTypeMask(type: String): Long {
        return when (type) {
            "BP3L" -> iHealthDevicesManager.DISCOVERY_BP3L
            "BP5" -> iHealthDevicesManager.DISCOVERY_BP5
            "BP5S" -> iHealthDevicesManager.DISCOVERY_BP5S
            "BG5" -> iHealthDevicesManager.DISCOVERY_BG5
            "BG5S" -> iHealthDevicesManager.DISCOVERY_BG5S
            "HS2S" -> iHealthDevicesManager.DISCOVERY_HS2S
            else -> 0L
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(eventName, params)
    }
}
