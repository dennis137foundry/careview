/**
 * deviceService.ts
 *
 * Wrapper service for IHealthDevices native module.
 * Supports both iHealth SDK devices and generic BLE GATT devices.
 *
 * Device Sources:
 * - iHealthSDK: BP3L, BP5, BP5S, HS2, HS2S, HS4S
 * - BLE_GATT: Any device advertising BP (0x1810) or Scale (0x181D) services
 */

import { NativeModules, NativeEventEmitter, EmitterSubscription } from "react-native";

const { IHealthDevices } = NativeModules;
const eventEmitter = new NativeEventEmitter(IHealthDevices);

// Device type mapping
export type DeviceCategory = "BP" | "SCALE";
export type DeviceSource = "iHealthSDK" | "BLE_GATT";

export interface DiscoveredDevice {
  mac: string;
  name: string;
  type: string; // e.g., "BP3L", "HS2S", "GATT_BP", "GATT_SCALE"
  category?: DeviceCategory;
  rssi?: number;
  source: DeviceSource;
}

export interface ConnectionEvent {
  mac: string;
  type: string;
  connected: boolean;
  source?: DeviceSource;
}

export interface BloodPressureReading {
  mac: string;
  type: string;
  systolic: number;
  diastolic: number;
  pulse: number;
  irregular?: boolean;
  source?: DeviceSource;
  timestamp?: number;
}

export interface WeightReading {
  mac: string;
  type: string;
  weight: number;
  unit: string;
  source?: DeviceSource;
  timestamp?: number;
}

export interface DeviceError {
  mac: string;
  type: string;
  error: number;
  message?: string;
}

export interface DebugLogEvent {
  message: string;
  timestamp: number;
}

// Supported iHealth device types for scanning
const IHEALTH_DEVICE_TYPES = ["BP3L", "BP5", "BP5S", "HS2", "HS2S", "HS4S"];

/**
 * Map device type string to category. Returns "BP" as a safe fallback
 * for unknown types — throwing here crashes the scan-list render and
 * wipes the UI, which is worse than a mis-category that the nurse can
 * visually correct. A previous attempt to throw on unknown types caused
 * exactly that regression.
 */
function getDeviceCategory(type: string): DeviceCategory {
  const upperType = type.toUpperCase();
  if (upperType.includes("BP") || upperType.includes("BLOOD")) {
    return "BP";
  }
  if (upperType.includes("HS") || upperType.includes("SCALE") || upperType.includes("WEIGHT")) {
    return "SCALE";
  }
  if (__DEV__) {
    console.warn(`[deviceService] Unknown device type "${type}" — defaulting to BP`);
  }
  return "BP";
}

/**
 * Device Service - Unified interface for device operations
 */
const deviceService = {
  /**
   * Authenticate with iHealth SDK
   * Required before using iHealth devices
   */
  authenticate: async (): Promise<boolean> => {
    try {
      const result = await IHealthDevices.authenticate("");
      console.log("[deviceService] Authentication result:", result);
      return result === true;
    } catch (error) {
      console.error("[deviceService] Authentication error:", error);
      // Continue anyway - might work in trial mode
      return true;
    }
  },

  /**
   * Check if SDK is authenticated
   */
  isAuthenticated: async (): Promise<boolean> => {
    try {
      return await IHealthDevices.isAuthenticated();
    } catch (error) {
      return false;
    }
  },

  /**
   * Start scanning for devices
   * Scans both iHealth SDK devices and BLE GATT devices simultaneously
   */
  startScan: async (deviceTypes?: string[]): Promise<void> => {
    try {
      const types = deviceTypes || IHEALTH_DEVICE_TYPES;
      console.log("[deviceService] Starting scan for:", types);
      await IHealthDevices.startScan(types);
    } catch (error) {
      console.error("[deviceService] Scan error:", error);
      throw error;
    }
  },

  /**
   * Stop all scanning
   */
  stopScan: async (): Promise<void> => {
    try {
      await IHealthDevices.stopScan();
      console.log("[deviceService] Scan stopped");
    } catch (error) {
      console.error("[deviceService] Stop scan error:", error);
    }
  },

  /**
   * Connect to a device
   * @param mac - Device MAC address or UUID (for GATT devices)
   * @param deviceType - Device type string (e.g., "BP3L", "GATT_BP")
   */
  connect: async (mac: string, deviceType: string): Promise<boolean> => {
    try {
      // MAC is the device serial — dev only.
      if (__DEV__) {
        console.log("[deviceService] Connecting to:", mac, deviceType);
      }
      const result = await IHealthDevices.connectDevice(mac, deviceType);
      return result === true;
    } catch (error) {
      console.error("[deviceService] Connect error:", error);
      throw error;
    }
  },

  /**
   * Disconnect from a device
   */
  disconnect: async (mac: string): Promise<void> => {
    try {
      await IHealthDevices.disconnectDevice(mac);
      console.log("[deviceService] Disconnected:", mac);
    } catch (error) {
      console.error("[deviceService] Disconnect error:", error);
    }
  },

  /**
   * Disconnect from all devices
   */
  disconnectAll: async (): Promise<void> => {
    try {
      await IHealthDevices.disconnectAll();
      console.log("[deviceService] All devices disconnected");
    } catch (error) {
      console.error("[deviceService] Disconnect all error:", error);
    }
  },

  /**
   * Start measurement on a connected device
   */
  startMeasurement: async (mac: string): Promise<void> => {
    try {
      await IHealthDevices.startMeasurement(mac);
      console.log("[deviceService] Measurement started:", mac);
    } catch (error) {
      console.error("[deviceService] Start measurement error:", error);
      throw error;
    }
  },

  /**
   * Stop measurement on a device
   */
  stopMeasurement: async (mac: string): Promise<void> => {
    try {
      await IHealthDevices.stopMeasurement(mac);
      console.log("[deviceService] Measurement stopped:", mac);
    } catch (error) {
      console.error("[deviceService] Stop measurement error:", error);
    }
  },

  /**
   * Get list of currently connected devices
   */
  getConnectedDevices: async (): Promise<Array<{ mac: string; type: string; source: string }>> => {
    try {
      return await IHealthDevices.getConnectedDevices();
    } catch (error) {
      console.error("[deviceService] Get connected devices error:", error);
      return [];
    }
  },

  /**
   * Get battery level for a device
   * Returns -1 if not available
   */
  getBatteryLevel: async (mac: string): Promise<number> => {
    try {
      return await IHealthDevices.getBatteryLevel(mac);
    } catch (error) {
      console.error("[deviceService] Get battery error:", error);
      return -1;
    }
  },

  // ============================================================
  // Event Listeners
  // ============================================================

  /**
   * Listen for discovered devices
   */
  onDeviceFound: (callback: (device: DiscoveredDevice) => void): EmitterSubscription => {
    return eventEmitter.addListener("onDeviceFound", (event) => {
      const device: DiscoveredDevice = {
        mac: event.mac,
        name: event.name,
        type: event.type,
        category: event.category || getDeviceCategory(event.type),
        rssi: event.rssi,
        source: event.source || "iHealthSDK",
      };
      callback(device);
    });
  },

  /**
   * Listen for connection state changes
   */
  onConnectionStateChanged: (callback: (event: ConnectionEvent) => void): EmitterSubscription => {
    return eventEmitter.addListener("onConnectionStateChanged", callback);
  },

  /**
   * Listen for scan state changes
   */
  onScanStateChanged: (callback: (event: { scanning: boolean }) => void): EmitterSubscription => {
    return eventEmitter.addListener("onScanStateChanged", callback);
  },

  /**
   * Listen for blood pressure readings
   */
  onBloodPressureReading: (callback: (reading: BloodPressureReading) => void): EmitterSubscription => {
    return eventEmitter.addListener("onBloodPressureReading", callback);
  },

  /**
   * Listen for weight readings
   */
  onWeightReading: (callback: (reading: WeightReading) => void): EmitterSubscription => {
    return eventEmitter.addListener("onWeightReading", callback);
  },

  /**
   * Listen for device errors
   */
  onError: (callback: (error: DeviceError) => void): EmitterSubscription => {
    return eventEmitter.addListener("onError", callback);
  },

  /**
   * Listen for debug log messages
   */
  onDebugLog: (callback: (event: DebugLogEvent) => void): EmitterSubscription => {
    return eventEmitter.addListener("onDebugLog", callback);
  },

  // ============================================================
  // Utility Functions
  // ============================================================

  /**
   * Get device category from type string
   */
  getCategory: getDeviceCategory,

  /**
   * Check if device type is a GATT device
   */
  isGATTDevice: (type: string): boolean => {
    return type.toUpperCase().startsWith("GATT_");
  },

  /**
   * Get friendly name for device type
   */
  getFriendlyTypeName: (type: string): string => {
    const typeMap: Record<string, string> = {
      BP3L: "iHealth BP3L",
      BP5: "iHealth BP5",
      BP5S: "iHealth BP5S",
      GATT_BP: "BLE Blood Pressure Monitor",
      HS2: "iHealth HS2",
      HS2S: "iHealth HS2S",
      HS4S: "iHealth HS4S",
      GATT_SCALE: "BLE Smart Scale",
    };
    return typeMap[type] || type;
  },
};

export default deviceService;
