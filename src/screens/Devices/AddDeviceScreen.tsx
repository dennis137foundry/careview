/* eslint-disable react-native/no-inline-styles */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  FlatList,
  ActivityIndicator,
  Platform,
  ScrollView,
  Modal,
} from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { addDevice } from "../../redux/deviceSlice";
import type { AppDispatch, RootState } from "../../redux/store";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import {
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
} from "react-native";

const { IHealthDevices } = NativeModules;
const emitter = IHealthDevices ? new NativeEventEmitter(IHealthDevices) : null;

// Map device type codes to human-readable categories
const deviceTypeMap: Record<string, "BP" | "SCALE" | "BG"> = {
  BP3L: "BP",
  BP5: "BP",
  BP5S: "BP",
  BG5: "BG",
  BG5S: "BG",
  HS2S: "SCALE",
  HS2: "SCALE",
  HS4S: "SCALE",
};

const deviceTypeLabels: Record<string, string> = {
  BP3L: "Blood Pressure Monitor",
  BP5: "Blood Pressure Monitor",
  BP5S: "Blood Pressure Monitor",
  BG5: "Glucose Meter (QR Required)",
  BG5S: "Glucose Meter",
  HS2S: "Smart Scale",
  HS2: "Smart Scale",
  HS4S: "Smart Scale",
};

const categoryLabels: Record<string, string> = {
  BP: "Blood Pressure Monitor",
  SCALE: "Smart Scale",
  BG: "Glucose Meter",
};

const deviceIcons: Record<string, string> = {
  BP: "favorite",
  SCALE: "monitor-weight",
  BG: "bloodtype",
};

type DiscoveredDevice = {
  mac: string;
  name: string;
  type: string; // The model: BP3L, BG5, BG5S, etc.
  rssi: number;
  source?: string; // "iHealthSDK" or "CoreBluetooth"
};

export default function AddDeviceScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const existingDevices = useSelector(
    (state: RootState) => state.devices.devices
  );

  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logScrollRef = useRef<ScrollView>(null);

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `${timestamp}: ${msg}`;
    console.log(`[AddDevice] ${msg}`);
    setDebugLogs((prev) => [...prev.slice(-100), logEntry]);
  }, []);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (showLogs && logScrollRef.current) {
      setTimeout(() => {
        logScrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [debugLogs, showLogs]);

  // Check if a device type already exists
  const hasDeviceType = useCallback(
    (type: "BP" | "SCALE" | "BG"): boolean => {
      return existingDevices.some((d) => d.type === type);
    },
    [existingDevices]
  );

  // Get existing device of type (for display in alert)
  const getExistingDeviceOfType = useCallback(
    (type: "BP" | "SCALE" | "BG") => {
      return existingDevices.find((d) => d.type === type);
    },
    [existingDevices]
  );

  // Request permissions on Android
  useEffect(() => {
    if (Platform.OS === "android") {
      const requestPermissions = async () => {
        try {
          const granted = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]);
          addLog(`Permissions: ${JSON.stringify(granted)}`);
        } catch (e) {
          addLog(`Permission error: ${e}`);
        }
      };
      requestPermissions();
    }
  }, [addLog]);

  // Listen for discovered devices
  useEffect(() => {
    if (!emitter) {
      addLog("❌ Native module not available");
      return;
    }

    addLog("📡 Setting up event listeners...");

    const sub = emitter.addListener(
      "onDeviceFound",
      (device: DiscoveredDevice) => {
        addLog(
          `✅ FOUND: ${device.name} (${device.type}) MAC=${device.mac} via ${device.source || "unknown"}`
        );

        setDevices((prev) => {
          // Avoid duplicates
          if (prev.find((d) => d.mac === device.mac)) {
            return prev;
          }
          return [...prev, device];
        });
      }
    );

    const debugSub = emitter.addListener(
      "onDebugLog",
      (data: { message: string }) => {
        addLog(`[Native] ${data.message}`);
      }
    );

    const scanStateSub = emitter.addListener(
      "onScanStateChanged",
      (data: { scanning: boolean }) => {
        addLog(`📶 Scan state: ${data.scanning ? "ACTIVE" : "STOPPED"}`);
      }
    );

    return () => {
      sub.remove();
      debugSub.remove();
      scanStateSub.remove();
    };
  }, [addLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanning && IHealthDevices?.stopScan) {
        IHealthDevices.stopScan().catch(() => {});
      }
    };
  }, [scanning]);

  const startScan = async () => {
    if (!IHealthDevices) {
      Alert.alert("Error", "Native module not available");
      return;
    }

    setDevices([]);
    setScanning(true);
    addLog("🚀 Starting scan...");

    try {
      // Authenticate first
      addLog("🔑 Authenticating SDK...");
      await IHealthDevices.authenticate("license.pem");
      addLog("✅ Authenticated");
    } catch (e: any) {
      addLog(`⚠️ Auth note: ${e.message}`);
    }

    try {
      // Scan for all supported device types
      addLog("📡 Calling startScan for: BP3L, BP5, BP5S, BG5, BG5S, HS2S, HS2, HS4S");
      await IHealthDevices.startScan([
        "BP3L",
        "BP5",
        "BP5S",
        "BG5",
        "BG5S",
        "HS2S",
        "HS2",
        "HS4S",
      ]);
      addLog("✅ Scan started - wake your devices!");

      // Auto-stop after 30 seconds
      setTimeout(() => {
        stopScan();
      }, 30000);
    } catch (e: any) {
      addLog(`❌ Scan error: ${e.message}`);
      Alert.alert("Scan Error", e.message);
      setScanning(false);
    }
  };

  const stopScan = async () => {
    addLog("🛑 Stopping scan...");
    if (IHealthDevices?.stopScan) {
      try {
        await IHealthDevices.stopScan();
        addLog("✅ Scan stopped");
      } catch (e) {
        addLog(`⚠️ Stop error: ${e}`);
      }
    }
    setScanning(false);
  };

  const selectDevice = (device: DiscoveredDevice) => {
    const category = deviceTypeMap[device.type] || "BP";
    const isBG5 = device.type === "BG5";

    // Check if device type already exists
    if (hasDeviceType(category)) {
      const existing = getExistingDeviceOfType(category);
      const categoryName = categoryLabels[category];

      Alert.alert(
        "Device Type Already Added",
        `You already have a ${categoryName} (${existing?.name || "device"}) added.\n\nTo add a different ${categoryName.toLowerCase()}, please delete the existing one first from the Devices screen.`,
        [{ text: "OK", style: "default" }]
      );
      return;
    }

    Alert.alert(
      "Add Device",
      `Add "${device.name}" (${device.type}) to your devices?${
        isBG5 ? "\n\nNote: BG5 requires scanning test strip bottle QR code." : ""
      }`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isBG5 ? "Add & Scan QR" : "Add",
          onPress: () => {
            stopScan();

            // Save device with model info
            const newDevice = {
              id: device.mac,
              name: device.name || device.type,
              type: category,
              mac: device.mac,
              model: device.type, // BP3L, BG5, BG5S, HS2S, etc.
              bottleCode: undefined,
            };

            dispatch(addDevice(newDevice));
            addLog(`✅ Device saved: ${device.name}`);

            if (isBG5) {
              // Navigate to QR scanner for BG5
              navigation.replace("ScanQR", {
                deviceId: device.mac,
                deviceName: device.name,
                returnTo: "Capture",
              });
            } else {
              // Go back to devices list
              navigation.goBack();
            }
          },
        },
      ]
    );
  };

  const handleScanQR = () => {
    navigation.navigate("ScanQR");
  };

  const clearLogs = () => {
    setDebugLogs([]);
    addLog("🗑️ Logs cleared");
  };

  const renderDevice = ({ item }: { item: DiscoveredDevice }) => {
    const category = deviceTypeMap[item.type] || "BP";
    const icon = deviceIcons[category] || "bluetooth";
    const label = deviceTypeLabels[item.type] || item.type;
    const isBG5 = item.type === "BG5";
    const alreadyHasType = hasDeviceType(category);

    return (
      <TouchableOpacity
        style={[styles.deviceCard, alreadyHasType && styles.deviceCardDisabled]}
        onPress={() => selectDevice(item)}
        activeOpacity={0.7}
      >
        <View
          style={[styles.deviceIcon, { backgroundColor: getIconBg(category) }]}
        >
          <MaterialIcons name={icon} size={24} color={getIconColor(category)} />
        </View>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name || item.type}</Text>
          <Text style={styles.deviceType}>{label}</Text>
          <Text style={styles.deviceMac}>{item.mac}</Text>
          {item.source && (
            <Text style={styles.deviceSource}>via {item.source}</Text>
          )}
          {alreadyHasType && (
            <Text style={styles.alreadyAddedText}>
              ⚠️ You already have this device type
            </Text>
          )}
        </View>
        <View style={styles.deviceAction}>
          {isBG5 && !alreadyHasType ? (
            <View style={styles.qrBadge}>
              <MaterialIcons name="qr-code" size={16} color="#666" />
            </View>
          ) : (
            <MaterialIcons name="add-circle" size={28} color="#00509f" />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Show which device types are already added
  //const existingTypes = existingDevices.map((d) => d.type);
  //const hasAnyDevices = existingDevices.length > 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcons name="arrow-back" size={24} color="#1a1a2e" />
        </TouchableOpacity>
        <Text style={styles.title}>Add Device</Text>
        <TouchableOpacity
          onPress={() => setShowLogs(true)}
          style={styles.logButton}
        >
          <MaterialIcons name="bug-report" size={24} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Existing devices notice 
      {hasAnyDevices && (
        <View style={styles.existingNotice}>
          <MaterialIcons name="info-outline" size={18} color="#666" />
          <Text style={styles.existingNoticeText}>
            You have:{" "}
            {existingTypes.map((t) => categoryLabels[t]).join(", ")}
          </Text>
        </View>
      )}

      */}

      {/* Instructions */}
      <View style={styles.instructions}>
        <MaterialIcons name="bluetooth-searching" size={48} color="#00509f" />
        <Text style={styles.instructionTitle}>
          {scanning ? "Searching for devices..." : "Find Your Device"}
        </Text>
        <Text style={styles.instructionText}>
          {scanning
            ? "Wake your device: press the button on BP monitors, step on scales, or turn on glucose meters."
            : "Make sure your iHealth device is nearby and ready to pair."}
        </Text>
      </View>

      {/* Scan Button */}
      <TouchableOpacity
        style={[styles.scanButton, scanning && styles.scanButtonActive]}
        onPress={scanning ? stopScan : startScan}
        activeOpacity={0.8}
      >
        {scanning ? (
          <>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.scanButtonText}>Stop Scanning</Text>
          </>
        ) : (
          <>
            <MaterialIcons name="bluetooth-searching" size={24} color="#fff" />
            <Text style={styles.scanButtonText}>Start Scanning</Text>
          </>
        )}
      </TouchableOpacity>

      {/* QR Scan Option */}
      <TouchableOpacity style={styles.qrButton} onPress={handleScanQR}>
        <MaterialIcons name="qr-code-scanner" size={20} color="#00509f" />
        <Text style={styles.qrButtonText}>Scan QR Code Instead</Text>
      </TouchableOpacity>

      {/* Device List */}
      {devices.length > 0 && (
        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>Found Devices ({devices.length})</Text>
          <FlatList
            data={devices}
            keyExtractor={(item) => item.mac}
            renderItem={renderDevice}
            contentContainerStyle={styles.listContent}
          />
        </View>
      )}

      {/* Empty State */}
      {scanning && devices.length === 0 && (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color="#00509f" />
          <Text style={styles.emptyText}>Looking for devices...</Text>
          <Text style={styles.emptyHint}>
            Press the button on your BP monitor, step on your scale, or turn on
            your glucose meter.
          </Text>
        </View>
      )}

      {/* Debug Log Modal */}
      <Modal
        visible={showLogs}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLogs(false)}
      >
        <View style={styles.logModal}>
          <View style={styles.logHeader}>
            <Text style={styles.logTitle}>Debug Logs ({debugLogs.length})</Text>
            <View style={styles.logActions}>
              <TouchableOpacity onPress={clearLogs} style={styles.logAction}>
                <MaterialIcons name="delete-outline" size={24} color="#666" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowLogs(false)}
                style={styles.logAction}
              >
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            ref={logScrollRef}
            style={styles.logScroll}
            contentContainerStyle={styles.logContent}
          >
            {debugLogs.length === 0 ? (
              <Text style={styles.logEmpty}>
                No logs yet. Start a scan to see debug output.
              </Text>
            ) : (
              debugLogs.map((log, i) => (
                <Text
                  key={i}
                  style={[
                    styles.logLine,
                    log.includes("❌") && styles.logError,
                    log.includes("✅") && styles.logSuccess,
                    log.includes("⚠️") && styles.logWarning,
                    log.includes("[Native]") && styles.logNative,
                  ]}
                >
                  {log}
                </Text>
              ))
            )}
          </ScrollView>

          <View style={styles.logFooter}>
            <Text style={styles.logHint}>
              💡 Look for "BG5S" in logs to see if it's being discovered
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function getIconBg(type: string): string {
  switch (type) {
    case "BP":
      return "rgba(244, 67, 54, 0.1)";
    case "SCALE":
      return "rgba(76, 175, 80, 0.1)";
    case "BG":
      return "rgba(33, 150, 243, 0.1)";
    default:
      return "rgba(0, 0, 0, 0.05)";
  }
}

function getIconColor(type: string): string {
  switch (type) {
    case "BP":
      return "#F44336";
    case "SCALE":
      return "#4CAF50";
    case "BG":
      return "#2196F3";
    default:
      return "#666";
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a2e",
  },
  logButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  existingNotice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff3cd",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  existingNoticeText: {
    fontSize: 13,
    color: "#666",
    flex: 1,
  },
  instructions: {
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
    marginBottom: 16,
  },
  instructionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a2e",
    marginTop: 12,
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00509f",
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  scanButtonActive: {
    backgroundColor: "#c62828",
  },
  scanButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  qrButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0, 80, 159, 0.1)",
    gap: 8,
  },
  qrButtonText: {
    color: "#00509f",
    fontSize: 14,
    fontWeight: "500",
  },
  listContainer: {
    flex: 1,
    marginTop: 16,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginHorizontal: 16,
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  deviceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  deviceCardDisabled: {
    backgroundColor: "#f5f5f5",
    opacity: 0.8,
  },
  deviceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a2e",
  },
  deviceType: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  deviceMac: {
    fontSize: 11,
    color: "#999",
    marginTop: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  deviceSource: {
    fontSize: 10,
    color: "#00509f",
    marginTop: 2,
    fontStyle: "italic",
  },
  alreadyAddedText: {
    fontSize: 11,
    color: "#e65100",
    marginTop: 4,
    fontWeight: "500",
  },
  deviceAction: {
    flexDirection: "row",
    alignItems: "center",
  },
  qrBadge: {
    backgroundColor: "#f0f0f0",
    padding: 6,
    borderRadius: 6,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 13,
    color: "#999",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 18,
  },
  // Debug Log Modal Styles
  logModal: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: "#252540",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  logTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  logActions: {
    flexDirection: "row",
    gap: 8,
  },
  logAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    padding: 12,
  },
  logEmpty: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    marginTop: 32,
  },
  logLine: {
    fontSize: 11,
    color: "#aaa",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 4,
    lineHeight: 16,
  },
  logError: {
    color: "#ff6b6b",
  },
  logSuccess: {
    color: "#69db7c",
  },
  logWarning: {
    color: "#ffd43b",
  },
  logNative: {
    color: "#74c0fc",
  },
  logFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#252540",
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  logHint: {
    fontSize: 12,
    color: "#888",
    textAlign: "center",
  },
});