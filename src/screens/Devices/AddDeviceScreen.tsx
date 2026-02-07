/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Platform,
  PermissionsAndroid,
} from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from "react-native-vision-camera";

import deviceService, { DiscoveredDevice } from "../../services/deviceService";
import { addDevice, loadDevices } from "../../redux/deviceSlice";
import { useToast } from "../../components/Toast";
import type { AppDispatch, RootState } from "../../redux/store";
import type { DeviceRecord } from "../../services/sqliteService";

// ============================================================================
// Component
// ============================================================================

export default function AddDeviceScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const navigation = useNavigation<any>();
  const { showToast } = useToast();
  const existingDevices = useSelector((state: RootState) => state.devices.devices);

  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Friendly name modal
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingDevice, setPendingDevice] = useState<DiscoveredDevice | null>(null);
  const [friendlyName, setFriendlyName] = useState("");

  const subscriptionsRef = useRef<any[]>([]);
  const cameraDevice = useCameraDevice("back");

  // QR Code Scanner
  const codeScanner = useCodeScanner({
    codeTypes: ["qr"],
    onCodeScanned: (codes) => {
      if (codes.length > 0 && codes[0].value) {
        handleQRCode(codes[0].value);
      }
    },
  });

  useEffect(() => {
    // Setup event listeners
    const deviceFoundSub = deviceService.onDeviceFound((device) => {
      console.log("[AddDevice] Device found:", device.name, device.type, device.source);
      setDevices((prev) => {
        // Avoid duplicates by MAC
        if (prev.find((d) => d.mac === device.mac)) {
          return prev;
        }
        return [...prev, device];
      });
    });

    const scanStateSub = deviceService.onScanStateChanged((event) => {
      console.log("[AddDevice] Scan state:", event.scanning);
    });

    const debugSub = deviceService.onDebugLog((event) => {
      console.log("[AddDevice] Debug:", event.message);
    });

    subscriptionsRef.current = [deviceFoundSub, scanStateSub, debugSub];

    return () => {
      subscriptionsRef.current.forEach((sub) => sub?.remove?.());
      deviceService.stopScan();
    };
  }, []);

  const startScan = async () => {
    // Android requires runtime permission requests for BLE scanning.
    // This block only runs on Android — iOS is not affected.
    if (Platform.OS === "android") {
      try {
        const permissions: string[] = [
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];

        // Android 12+ (API 31+) needs BLUETOOTH_SCAN and BLUETOOTH_CONNECT
        if (Platform.Version >= 31) {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
          );
        }

        const granted = await PermissionsAndroid.requestMultiple(permissions as any);
        console.log("[AddDevice] Android permissions:", granted);

        // Check if any critical permission was denied
        const locationGranted =
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
          PermissionsAndroid.RESULTS.GRANTED;

        if (!locationGranted) {
          Alert.alert(
            "Permission Required",
            "Location permission is needed to scan for Bluetooth devices. Please grant it in Settings."
          );
          return;
        }

        if (Platform.Version >= 31) {
          const btGranted =
            granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
              PermissionsAndroid.RESULTS.GRANTED &&
            granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
              PermissionsAndroid.RESULTS.GRANTED;

          if (!btGranted) {
            Alert.alert(
              "Permission Required",
              "Bluetooth permission is needed to scan for devices. Please grant it in Settings."
            );
            return;
          }
        }
      } catch (e: any) {
        console.error("[AddDevice] Permission request error:", e);
      }
    }

    setDevices([]);
    setScanning(true);

    try {
      await deviceService.authenticate();
      // Scan for BP and Scale devices (no BG)
      await deviceService.startScan(["BP3L", "BP5", "BP5S", "HS2", "HS2S", "HS4S"]);

      // Auto-stop after 30 seconds
      setTimeout(() => {
        stopScan();
      }, 30000);
    } catch (error: any) {
      console.error("[AddDevice] Scan error:", error);
      Alert.alert("Scan Error", error.message || "Failed to start scanning");
      setScanning(false);
    }
  };

  const stopScan = async () => {
    await deviceService.stopScan();
    setScanning(false);
  };

  // Check if device type already exists
  const hasDeviceOfType = (category: string): boolean => {
    return existingDevices.some((d) => d.type === category);
  };

  // Handle device selection - show name modal
  const handleSelectDevice = (device: DiscoveredDevice) => {
    const category = device.category || deviceService.getCategory(device.type);

    // Check for existing device of same type
    if (hasDeviceOfType(category)) {
      Alert.alert(
        "Device Type Exists",
        `You already have a ${category === "BP" ? "blood pressure monitor" : "scale"} registered. Remove it first to add a new one.`,
        [{ text: "OK" }]
      );
      return;
    }

    // Show friendly name modal
    setPendingDevice(device);
    setFriendlyName(device.name || deviceService.getFriendlyTypeName(device.type));
    setShowNameModal(true);
  };

  // Confirm device addition with friendly name
  const confirmAddDevice = async () => {
    if (!pendingDevice) return;

    setShowNameModal(false);
    setConnecting(pendingDevice.mac);

    try {
      await stopScan();

      const category = pendingDevice.category || deviceService.getCategory(pendingDevice.type);

      const deviceRecord: DeviceRecord = {
        id: `device_${pendingDevice.mac.replace(/[:-]/g, "")}`,
        name: pendingDevice.name || pendingDevice.type,
        type: category,
        mac: pendingDevice.mac,
        model: pendingDevice.type,
        friendlyName: friendlyName.trim() || undefined,
        source: pendingDevice.source,
      };

      dispatch(addDevice(deviceRecord));
      dispatch(loadDevices());

      showToast({
        message: `${friendlyName || pendingDevice.name} added successfully`,
        type: "success",
        duration: 2500,
      });

      setTimeout(() => {
        navigation.goBack();
      }, 300);
    } catch (error: any) {
      console.error("[AddDevice] Add error:", error);
      Alert.alert("Error", "Failed to add device. Please try again.");
    } finally {
      setConnecting(null);
      setPendingDevice(null);
      setFriendlyName("");
    }
  };

  // Handle QR code scan
  const handleQRCode = (code: string) => {
    setShowQRScanner(false);
    console.log("[AddDevice] QR Code scanned:", code);

    // Expected format: "TYPE:MAC" e.g., "BP3L:A4C1386B2E90"
    const parts = code.split(":");
    if (parts.length !== 2) {
      Alert.alert("Invalid QR Code", "The QR code format is not recognized.");
      return;
    }

    const [type, mac] = parts;
    const upperType = type.toUpperCase();

    // Determine category (removed BG support)
    let category: "BP" | "SCALE";
    if (upperType.includes("BP")) {
      category = "BP";
    } else if (upperType.includes("HS")) {
      category = "SCALE";
    } else {
      Alert.alert("Unknown Device", `Device type "${type}" is not supported.`);
      return;
    }

    // Check for existing device
    if (hasDeviceOfType(category)) {
      Alert.alert(
        "Device Type Exists",
        `You already have a ${category === "BP" ? "blood pressure monitor" : "scale"} registered.`
      );
      return;
    }

    // Create device from QR code
    const device: DiscoveredDevice = {
      mac: mac.toUpperCase(),
      name: `${upperType} ${mac.slice(-4)}`,
      type: upperType,
      category,
      source: "iHealthSDK",
    };

    // Show name modal for QR-scanned device
    setPendingDevice(device);
    setFriendlyName(device.name);
    setShowNameModal(true);
  };

  // Get icon for device type
  const getDeviceIcon = (type: string): string => {
    const upperType = type.toUpperCase();
    if (upperType.includes("BP") || upperType.includes("BLOOD")) {
      return "favorite";
    }
    if (upperType.includes("HS") || upperType.includes("SCALE") || upperType.includes("WEIGHT")) {
      return "fitness-center";
    }
    return "devices-other";
  };

  // Get color for device type
  const getDeviceColor = (type: string): string => {
    const upperType = type.toUpperCase();
    if (upperType.includes("BP")) return "#e53935";
    if (upperType.includes("HS") || upperType.includes("SCALE")) return "#00acc1";
    return "#757575";
  };

  // Render device item
  const renderDevice = ({ item }: { item: DiscoveredDevice }) => {
    const isConnecting = connecting === item.mac;
    const category = item.category || deviceService.getCategory(item.type);
    const alreadyExists = hasDeviceOfType(category);
    const isGATT = item.source === "BLE_GATT";

    return (
      <TouchableOpacity
        style={[styles.deviceItem, alreadyExists && styles.deviceItemDisabled]}
        onPress={() => handleSelectDevice(item)}
        disabled={isConnecting || alreadyExists}
        activeOpacity={0.7}
      >
        <View style={[styles.deviceIcon, { backgroundColor: `${getDeviceColor(item.type)}20` }]}>
          <MaterialIcons
            name={getDeviceIcon(item.type)}
            size={24}
            color={getDeviceColor(item.type)}
          />
        </View>

        <View style={styles.deviceInfo}>
          <View style={styles.deviceNameRow}>
            <Text style={styles.deviceName} numberOfLines={1}>
              {item.name || item.type}
            </Text>
            {isGATT && (
              <View style={styles.sourceBadge}>
                <Text style={styles.sourceBadgeText}>BLE</Text>
              </View>
            )}
          </View>
          <Text style={styles.deviceMac}>{item.mac}</Text>
          <Text style={styles.deviceType}>
            {deviceService.getFriendlyTypeName(item.type)}
          </Text>
        </View>

        {isConnecting ? (
          <ActivityIndicator color="#00509f" />
        ) : alreadyExists ? (
          <View style={styles.existsBadge}>
            <Text style={styles.existsBadgeText}>Added</Text>
          </View>
        ) : (
          <MaterialIcons name="add-circle" size={28} color="#00509f" />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcons name="arrow-back" size={24} color="#002040" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Device</Text>
        <TouchableOpacity
          onPress={() => setShowQRScanner(true)}
          style={styles.qrButton}
        >
          <MaterialIcons name="qr-code-scanner" size={24} color="#00509f" />
        </TouchableOpacity>
      </View>

      {/* Scan Controls */}
      <View style={styles.scanControls}>
        <TouchableOpacity
          style={[
            styles.scanButton,
            scanning && styles.scanButtonActive,
          ]}
          onPress={scanning ? stopScan : startScan}
          activeOpacity={0.8}
        >
          {scanning ? (
            <>
              <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.scanButtonText}>Scanning...</Text>
            </>
          ) : (
            <>
              <MaterialIcons name="bluetooth-searching" size={20} color="#fff" />
              <Text style={styles.scanButtonText}>Start Scan</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.scanHint}>
          {scanning
            ? "Turn on your device and put it in pairing mode"
            : "Tap to scan for nearby BP monitors and scales"}
        </Text>
      </View>

      {/* Device List */}
      <FlatList
        data={devices}
        renderItem={renderDevice}
        keyExtractor={(item) => item.mac}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            {scanning ? (
              <>
                <ActivityIndicator size="large" color="#00509f" />
                <Text style={styles.emptyText}>Searching for devices...</Text>
              </>
            ) : (
              <>
                <MaterialIcons name="bluetooth-searching" size={48} color="#ccc" />
                <Text style={styles.emptyText}>No devices found</Text>
                <Text style={styles.emptyHint}>
                  Start scanning and make sure your device is powered on
                </Text>
              </>
            )}
          </View>
        }
      />

      {/* QR Scanner Modal */}
      <Modal visible={showQRScanner} animationType="slide">
        <View style={styles.qrContainer}>
          <View style={styles.qrHeader}>
            <TouchableOpacity
              onPress={() => setShowQRScanner(false)}
              style={styles.qrCloseButton}
            >
              <MaterialIcons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.qrTitle}>Scan Device QR Code</Text>
          </View>

          {cameraDevice ? (
            <Camera
              style={styles.camera}
              device={cameraDevice}
              isActive={showQRScanner}
              codeScanner={codeScanner}
            />
          ) : (
            <View style={styles.noCameraContainer}>
              <MaterialIcons name="no-photography" size={64} color="#ccc" />
              <Text style={styles.noCameraText}>Camera not available</Text>
            </View>
          )}

          <View style={styles.qrOverlay}>
            <View style={styles.qrFrame} />
          </View>

          <Text style={styles.qrHint}>
            Point at the QR code on your device packaging
          </Text>
        </View>
      </Modal>

      {/* Friendly Name Modal */}
      <Modal visible={showNameModal} transparent animationType="fade">
        <View style={styles.nameModalOverlay}>
          <View style={styles.nameModalContainer}>
            <Text style={styles.nameModalTitle}>Name Your Device</Text>
            <Text style={styles.nameModalSubtitle}>
              Give this device a friendly name to help identify it
            </Text>

            <TextInput
              style={styles.nameInput}
              value={friendlyName}
              onChangeText={setFriendlyName}
              placeholder="e.g., Living Room Scale"
              placeholderTextColor="#999"
              maxLength={30}
              autoFocus
            />

            {pendingDevice && (
              <View style={styles.devicePreview}>
                <View style={[styles.previewIcon, { backgroundColor: `${getDeviceColor(pendingDevice.type)}20` }]}>
                  <MaterialIcons
                    name={getDeviceIcon(pendingDevice.type)}
                    size={20}
                    color={getDeviceColor(pendingDevice.type)}
                  />
                </View>
                <View style={styles.previewInfo}>
                  <Text style={styles.previewType}>
                    {deviceService.getFriendlyTypeName(pendingDevice.type)}
                  </Text>
                  <Text style={styles.previewMac}>{pendingDevice.mac}</Text>
                </View>
                {pendingDevice.source === "BLE_GATT" && (
                  <View style={styles.sourceBadge}>
                    <Text style={styles.sourceBadgeText}>BLE</Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.nameModalButtons}>
              <TouchableOpacity
                style={styles.nameModalCancel}
                onPress={() => {
                  setShowNameModal(false);
                  setPendingDevice(null);
                  setFriendlyName("");
                }}
              >
                <Text style={styles.nameModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.nameModalConfirm}
                onPress={confirmAddDevice}
              >
                <Text style={styles.nameModalConfirmText}>Add Device</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#002040",
  },
  qrButton: {
    padding: 8,
  },
  // Scan Controls
  scanControls: {
    padding: 20,
    alignItems: "center",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00509f",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 30,
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
  scanHint: {
    marginTop: 12,
    fontSize: 13,
    color: "#888",
    textAlign: "center",
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  deviceItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  deviceItemDisabled: {
    opacity: 0.6,
  },
  deviceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    flex: 1,
  },
  sourceBadge: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sourceBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  deviceMac: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  deviceType: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  existsBadge: {
    backgroundColor: "#e8f5e9",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  existsBadgeText: {
    color: "#4CAF50",
    fontSize: 12,
    fontWeight: "600",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 13,
    color: "#bbb",
    marginTop: 8,
    textAlign: "center",
    paddingHorizontal: 40,
  },
  // QR Scanner styles
  qrContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  qrHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  qrCloseButton: {
    padding: 8,
  },
  qrTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
    marginRight: 40,
  },
  camera: {
    flex: 1,
  },
  noCameraContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  noCameraText: {
    color: "#999",
    fontSize: 16,
    marginTop: 16,
  },
  qrOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  qrFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: "#00509f",
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  qrHint: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
    padding: 20,
    paddingBottom: 40,
  },
  // Friendly Name Modal styles
  nameModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  nameModalContainer: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 340,
  },
  nameModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#002040",
    textAlign: "center",
    marginBottom: 8,
  },
  nameModalSubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 20,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#fafafa",
    marginBottom: 16,
  },
  devicePreview: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 12,
    borderRadius: 10,
    marginBottom: 20,
  },
  previewIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  previewInfo: {
    flex: 1,
  },
  previewType: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  previewMac: {
    fontSize: 11,
    color: "#999",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  nameModalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  nameModalCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 30,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
  },
  nameModalCancelText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#666",
  },
  nameModalConfirm: {
    flex: 1,
    padding: 14,
    borderRadius: 30,
    backgroundColor: "#00509f",
    alignItems: "center",
  },
  nameModalConfirmText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});