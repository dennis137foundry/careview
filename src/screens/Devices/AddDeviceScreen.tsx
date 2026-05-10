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
  Linking,
  Platform,
} from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from "react-native-vision-camera";

import deviceService, {
  type BluetoothStatus,
  type DiscoveredDevice,
  type DeviceCategory,
} from "../../services/deviceService";
import { addDevice, loadDevices, setDeviceEmrUnits, removeDevice as removeDeviceAction } from "../../redux/deviceSlice";
import { useToast } from "../../components/Toast";
import type { AppDispatch, RootState } from "../../redux/store";
import type { DeviceRecord, CuffSize } from "../../services/sqliteService";
import {
  registerDeviceWithEmr,
  normalizeMac,
} from "../../services/deviceRegistrationService";

// ============================================================================
// Component
// ============================================================================

const getCategoryLabel = (category: DeviceCategory | string): string => {
  if (category === "BP") return "blood pressure monitor";
  if (category === "SCALE") return "scale";
  if (category === "BG") return "glucose meter";
  return "device";
};

const BLUETOOTH_ERROR_CODES = new Set([
  "BLUETOOTH_OFF",
  "BLUETOOTH_UNAUTHORIZED",
  "BLUETOOTH_UNSUPPORTED",
  "LOCATION_DISABLED",
  "powered_off",
  "unauthorized",
  "unsupported",
  "location_disabled",
]);

function showBluetoothAlert(status?: Partial<BluetoothStatus> | null) {
  const message =
    status?.message ||
    "CareView needs Bluetooth to add devices. Turn Bluetooth on or allow Bluetooth permission, then try again.";

  Alert.alert("Bluetooth Needed", message, [
    { text: "Cancel", style: "cancel" },
    { text: "Open Settings", onPress: () => Linking.openSettings() },
  ]);
}

export default function AddDeviceScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const navigation = useNavigation<any>();
  const { showToast } = useToast();
  const existingDevices = useSelector((state: RootState) => state.devices.devices);

  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);

  const patientId = useSelector((state: RootState) => state.user.patientId);

  // Cuff-size picker modal (BP devices only — scales skip this step)
  const [showCuffModal, setShowCuffModal] = useState(false);
  const [pendingCuffSize, setPendingCuffSize] = useState<CuffSize | null>(null);

  // Friendly name modal
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingDevice, setPendingDevice] = useState<DiscoveredDevice | null>(null);
  const [friendlyName, setFriendlyName] = useState("");

  const subscriptionsRef = useRef<any[]>([]);
  const cameraDevice = useCameraDevice("back");
  const scanRunRef = useRef(0);

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
      // Device name can include advertised identifier; dev only.
      if (__DEV__) {
        console.log("[AddDevice] Device found:", device.name, device.type, device.source);
      }
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
      // Native BLE debug events — dev console only, no UI surface in production.
      if (__DEV__) {
        console.log("[AddDevice] Debug:", event.message);
      }
    });

    const errorSub = deviceService.onError((error: any) => {
      const code = String(error.code || error.state || "");
      if (!BLUETOOTH_ERROR_CODES.has(code)) return;
      setScanning(false);
      showBluetoothAlert(error);
    });

    subscriptionsRef.current = [deviceFoundSub, scanStateSub, debugSub, errorSub];

    return () => {
      subscriptionsRef.current.forEach((sub) => sub?.remove?.());
      deviceService.stopScan();
    };
  }, []);

  const startScan = async () => {
    try {
      await deviceService.ensureBluetoothReady();
    } catch (error: any) {
      console.error("[AddDevice] Bluetooth not ready:", error);
      showBluetoothAlert(error?.status);
      return;
    }

    setDevices([]);
    setScanning(true);
    scanRunRef.current += 1;
    const scanRun = scanRunRef.current;

    try {
      await deviceService.authenticate();
      await deviceService.startScan(["BP3L", "BP5", "BP5S", "HS2", "HS2S", "HS4S"]);

      setTimeout(() => {
        if (scanRunRef.current !== scanRun) return;
        deviceService.startBG5SScan().catch((error) => {
          console.warn("[AddDevice] BG5S scan phase failed:", error);
        });
      }, 5000);

      // Auto-stop after 30 seconds
      setTimeout(() => {
        if (scanRunRef.current === scanRun) {
          stopScan();
        }
      }, 30000);
    } catch (error: any) {
      console.error("[AddDevice] Scan error:", error);
      Alert.alert("Scan Error", error.message || "Failed to start scanning");
      setScanning(false);
    }
  };

  const stopScan = async () => {
    scanRunRef.current += 1;
    await deviceService.stopScan();
    setScanning(false);
  };

  // Check if device type already exists
  const hasDeviceOfType = (category: DeviceCategory): boolean => {
    return existingDevices.some((d) => d.type === category);
  };

  // Handle device selection — BP devices get a cuff-size picker first,
  // scales skip straight to the friendly-name modal.
  const handleSelectDevice = (device: DiscoveredDevice) => {
    const category = device.category || deviceService.getCategory(device.type);

    // Check for existing device of same type
    if (hasDeviceOfType(category)) {
      Alert.alert(
        "Device Type Exists",
        `You already have a ${getCategoryLabel(category)} registered. Remove it first to add a new one.`,
        [{ text: "OK" }]
      );
      return;
    }

    setPendingDevice(device);
    setFriendlyName(device.name || deviceService.getFriendlyTypeName(device.type));

    if (category === "BP") {
      // Ask the nurse which cuff is on this monitor. The BLE hardware
      // can't self-report this — it's a physical accessory.
      setPendingCuffSize(null);
      setShowCuffModal(true);
    } else {
      // No cuff size, go straight to naming.
      setPendingCuffSize(null);
      setShowNameModal(true);
    }
  };

  // Nurse picks a cuff size → dismiss cuff modal, open name modal.
  const handleCuffSizeSelected = (size: CuffSize) => {
    setPendingCuffSize(size);
    setShowCuffModal(false);
    setShowNameModal(true);
  };

  // Confirm device addition: save locally, then register with the EMR
  // inventory. Registration failures are handled per error tier:
  //   409 conflict    → roll back local pairing, show server's message
  //   5xx / network   → keep paired locally, background sweep retries
  //   401 / 422       → keep paired locally but log; won't succeed
  //   200             → store unit IDs, continue
  const confirmAddDevice = async () => {
    if (!pendingDevice) return;

    setShowNameModal(false);
    setConnecting(pendingDevice.mac);

    const category = pendingDevice.category || deviceService.getCategory(pendingDevice.type);
    const normalizedMac = normalizeMac(pendingDevice.mac);
    const localId = `device_${normalizedMac}`;
    const finalFriendlyName = friendlyName.trim() || pendingDevice.name || pendingDevice.type;

    const deviceRecord: DeviceRecord = {
      id: localId,
      name: pendingDevice.name || pendingDevice.type,
      type: category,
      mac: pendingDevice.mac,
      model: pendingDevice.type,
      friendlyName: finalFriendlyName,
      source: pendingDevice.source,
      cuffSize: category === "BP" ? (pendingCuffSize ?? "STANDARD") : null,
      emrUnitId: null,
      emrAccessoryUnitId: null,
    };

    try {
      await stopScan();

      // 1. Save locally first — offline-safe. Registration can retry later.
      dispatch(addDevice(deviceRecord));

      // 2. Register with EMR inventory. BG5S stays local until the EMR
      // glucose device contract is ready.
      if (category === "BG") {
        console.log("[AddDevice] BG5S saved locally; skipping EMR device registration");
      } else if (!patientId) {
        // No logged-in patient — shouldn't reach this screen without one,
        // but handle defensively. Leave the device paired locally; the
        // background sweep will register it once a patient is available.
        console.warn("[AddDevice] No patientId — skipping EMR registration");
      } else {
        const result = await registerDeviceWithEmr({
          patient_id: parseInt(patientId, 10),
          mac: normalizedMac,
          category,
          cuff_size:
            category === "BP" ? (pendingCuffSize ?? "STANDARD") : undefined,
          model: pendingDevice.type,
          name: deviceRecord.name,
          friendly_name: finalFriendlyName,
          source: pendingDevice.source ?? "iHealthSDK",
        });

        if (result.kind === "success") {
          const monitor = result.data.units.find((u) => u.role !== "accessory");
          const accessory = result.data.units.find((u) => u.role === "accessory");
          if (monitor) {
            dispatch(
              setDeviceEmrUnits({
                deviceId: localId,
                emrUnitId: monitor.unit_id,
                emrAccessoryUnitId: accessory?.unit_id ?? null,
              })
            );
          }
        } else if (result.kind === "conflict") {
          // Roll back local save. Device isn't available for this patient.
          dispatch(removeDeviceAction(localId));
          Alert.alert("Device Not Available", result.message);
          return;
        } else if (result.kind === "fatal") {
          // Bad payload or bad auth. Leave paired locally but log.
          // Readings from this device will still sync to EMR with
          // unit_id=NULL until an admin sorts it out.
          console.error("[AddDevice] fatal register error:", result.message);
        }
        // retry kind: intentionally silent — background sweep will retry.
      }

      dispatch(loadDevices());

      showToast({
        message: `${finalFriendlyName} added successfully`,
        type: "success",
        duration: 2500,
      });

      setTimeout(() => {
        navigation.goBack();
      }, 300);
    } catch (error: any) {
      console.error("[AddDevice] Add error:", error);
      // Roll back the local save on unexpected errors in the local path.
      dispatch(removeDeviceAction(localId));
      Alert.alert("Error", "Failed to add device. Please try again.");
    } finally {
      setConnecting(null);
      setPendingDevice(null);
      setPendingCuffSize(null);
      setFriendlyName("");
    }
  };

  // Handle QR code scan
  const handleQRCode = (code: string) => {
    setShowQRScanner(false);
    // QR code contains device serial — dev only.
    if (__DEV__) {
      console.log("[AddDevice] QR Code scanned:", code);
    }

    // Expected format: "TYPE:MAC" e.g., "BP3L:A4C1386B2E90"
    const parts = code.split(":");
    if (parts.length !== 2) {
      Alert.alert("Invalid QR Code", "The QR code format is not recognized.");
      return;
    }

    const [type, mac] = parts;
    const upperType = type.toUpperCase();

    // Determine category
    let category: DeviceCategory;
    if (upperType.includes("BP")) {
      category = "BP";
    } else if (upperType.includes("BG") || upperType.includes("GLUCOSE")) {
      category = "BG";
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
        `You already have a ${getCategoryLabel(category)} registered.`
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
    if (upperType.includes("BG") || upperType.includes("GLUCOSE")) {
      return "opacity";
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
    if (upperType.includes("BG") || upperType.includes("GLUCOSE")) return "#43a047";
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
          <Text style={styles.deviceMac}>Serial: {item.mac}</Text>
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
              <Text style={styles.scanButtonText}>Scan for Devices</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.scanHint}>
          {scanning
            ? "Keep your device nearby. The app will find supported iHealth devices automatically."
            : "Scan for nearby blood pressure monitors, scales, and glucose meters"}
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
                  Scan with your supported iHealth device nearby
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

      {/* Cuff Size Modal — BP devices only */}
      <Modal visible={showCuffModal} transparent animationType="fade">
        <View style={styles.nameModalOverlay}>
          <View style={styles.nameModalContainer}>
            <Text style={styles.nameModalTitle}>Select Cuff Size</Text>
            <Text style={styles.nameModalSubtitle}>
              Which cuff is attached to this blood-pressure monitor?
            </Text>

            <TouchableOpacity
              style={styles.cuffOption}
              onPress={() => handleCuffSizeSelected("STANDARD")}
              activeOpacity={0.7}
            >
              <MaterialIcons name="radio-button-unchecked" size={22} color="#00509f" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cuffOptionTitle}>Standard cuff</Text>
                <Text style={styles.cuffOptionSub}>Fits most adults</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#999" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cuffOption}
              onPress={() => handleCuffSizeSelected("LARGE")}
              activeOpacity={0.7}
            >
              <MaterialIcons name="radio-button-unchecked" size={22} color="#00509f" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cuffOptionTitle}>Large cuff</Text>
                <Text style={styles.cuffOptionSub}>For larger upper arms</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#999" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cuffOption}
              onPress={() => handleCuffSizeSelected("XXL")}
              activeOpacity={0.7}
            >
              <MaterialIcons name="radio-button-unchecked" size={22} color="#00509f" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cuffOptionTitle}>XXL cuff (accessory)</Text>
                <Text style={styles.cuffOptionSub}>Oversized cuff on a Standard monitor</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#999" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.nameModalCancel, { marginTop: 16 }]}
              onPress={() => {
                setShowCuffModal(false);
                setPendingDevice(null);
                setPendingCuffSize(null);
              }}
            >
              <Text style={styles.nameModalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
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
                  <Text style={styles.previewMac}>Serial: {pendingDevice.mac}</Text>
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
  cuffOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
    marginBottom: 10,
  },
  cuffOptionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  cuffOptionSub: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
});
