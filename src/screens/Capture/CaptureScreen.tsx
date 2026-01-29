/* eslint-disable react-native/no-inline-styles */
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useSelector, useDispatch } from "react-redux";
import { useNavigation, useRoute } from "@react-navigation/native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import KeepAwake from "react-native-keep-awake";

import deviceService from "../../services/deviceService";
import {
  saveReading,
  getDevice,
  hasDailyHealthCheckToday,
} from "../../services/sqliteService";
import { syncReading } from "../../services/vitalsSyncService";
import { loadReadings } from "../../redux/readingSlice";
import { isBPHigh } from "../../redux/userSlice";
import type { RootState, AppDispatch } from "../../redux/store";
import DailyHealthCheckModal from "../../components/DailyHealthCheckModal";

type CaptureStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "measuring"
  | "complete"
  | "error";

export default function CaptureScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch<AppDispatch>();

  const { deviceId } = route.params || {};

  const bpThresholds = useSelector((state: RootState) => state.user.bpThresholds);

  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Preparing...");
  const [currentReading, setCurrentReading] = useState<any>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);

  // Daily Health Check Modal state
  const [showHealthCheckModal, setShowHealthCheckModal] = useState(false);
  const [healthCheckCompleted, setHealthCheckCompleted] = useState(false);

  const subscriptionsRef = useRef<any[]>([]);
  const hasReceivedReadingRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[Capture] ${msg}`);
    setDebugLog((prev) => [`[${timestamp}] ${msg}`, ...prev.slice(0, 49)]);
  }, []);

  // Load device info
  useEffect(() => {
    if (deviceId) {
      const device = getDevice(deviceId);
      if (device) {
        setDeviceInfo(device);
        addLog(`Device loaded: ${device.name} (${device.type})`);
      } else {
        addLog(`Device not found: ${deviceId}`);
        Alert.alert("Error", "Device not found");
        navigation.goBack();
      }
    }
  }, [deviceId, addLog, navigation]);

  // Check if daily health check is needed for BP devices
  useEffect(() => {
    if (deviceInfo?.type === "BP") {
      const hasCompletedToday = hasDailyHealthCheckToday();
      addLog(`Daily health check completed today: ${hasCompletedToday}`);
      
      if (!hasCompletedToday) {
        // Show modal - blocks capture until completed
        setShowHealthCheckModal(true);
        setHealthCheckCompleted(false);
      } else {
        setHealthCheckCompleted(true);
      }
    } else {
      // Non-BP devices don't need health check
      setHealthCheckCompleted(true);
    }
  }, [deviceInfo, addLog]);

  // Handle daily health check completion
  const handleHealthCheckComplete = (data: any) => {
    addLog(`Health check completed: headaches=${data.hasHeadaches}, visual=${data.hasVisualDisturbances}`);
    setShowHealthCheckModal(false);
    setHealthCheckCompleted(true);

    // If symptoms reported, log it (EMR sync happens in modal)
    if (data.hasHeadaches || data.hasVisualDisturbances) {
      addLog("⚠️ Symptoms reported - care team will be notified");
    }
  };

  // Setup event listeners
  useEffect(() => {
    const setupListeners = () => {
      // Debug log listener
      const debugSub = deviceService.onDebugLog((event: any) => {
        addLog(event.message);
      });

      // Connection state listener
      const connSub = deviceService.onConnectionStateChanged((event: any) => {
        addLog(`Connection: ${event.connected ? "CONNECTED" : "DISCONNECTED"} (${event.type})`);
        if (event.connected) {
          setStatus("connected");
          setStatusMessage("Connected! Starting measurement...");
        } else if (status !== "complete") {
          setStatus("error");
          setStatusMessage("Device disconnected");
        }
      });

      // Blood pressure reading listener
      const bpSub = deviceService.onBloodPressureReading((event: any) => {
        addLog(`BP Reading: ${event.systolic}/${event.diastolic} pulse=${event.pulse}`);
        
        if (hasReceivedReadingRef.current) {
          addLog("Ignoring duplicate BP reading");
          return;
        }
        hasReceivedReadingRef.current = true;

        const reading = {
          deviceId: deviceId,
          deviceName: deviceInfo?.friendlyName || deviceInfo?.name || "Blood Pressure",
          type: "BP" as const,
          value: event.systolic,
          value2: event.diastolic,
          heartRate: event.pulse,
          unit: "mmHg",
          measurementCondition: event.pulse ? `${event.pulse} bpm` : undefined,
        };

        setCurrentReading(reading);
        setStatus("complete");
        
        // Check if reading is high
        const isHigh = isBPHigh(event.systolic, event.diastolic, bpThresholds);
        if (isHigh) {
          setStatusMessage("⚠️ Reading is HIGH - Contact your care team");
        } else {
          setStatusMessage("Reading captured successfully!");
        }
      });

      // Weight reading listener
      const weightSub = deviceService.onWeightReading((event: any) => {
        addLog(`Weight Reading: ${event.weight} ${event.unit}`);
        
        if (hasReceivedReadingRef.current) {
          addLog("Ignoring duplicate weight reading");
          return;
        }
        hasReceivedReadingRef.current = true;

        const reading = {
          deviceId: deviceId,
          deviceName: deviceInfo?.friendlyName || deviceInfo?.name || "Scale",
          type: "SCALE" as const,
          value: event.weight,
          unit: event.unit || "kg",
        };

        setCurrentReading(reading);
        setStatus("complete");
        setStatusMessage("Reading captured successfully!");
      });

      // Error listener
      const errorSub = deviceService.onError((event: any) => {
        addLog(`ERROR: ${event.message || event.error}`);
        setStatus("error");
        setStatusMessage(event.message || "An error occurred");
      });

      subscriptionsRef.current = [debugSub, connSub, bpSub, weightSub, errorSub];
    };

    setupListeners();

    return () => {
      subscriptionsRef.current.forEach((sub) => sub?.remove?.());
      subscriptionsRef.current = [];
    };
  }, [deviceId, deviceInfo, addLog, bpThresholds, status]);

  // Start capture process
  const startCapture = async () => {
    if (!deviceInfo) {
      Alert.alert("Error", "No device information available");
      return;
    }

    // Check if health check is needed for BP
    if (deviceInfo.type === "BP" && !healthCheckCompleted) {
      setShowHealthCheckModal(true);
      return;
    }

    hasReceivedReadingRef.current = false;
    setCurrentReading(null);
    setStatus("connecting");
    setStatusMessage("Connecting to device...");

    try {
      // Authenticate SDK if needed
      addLog("Authenticating SDK...");
      await deviceService.authenticate();

      // Get device type for connection
      const deviceType = deviceInfo.model || deviceInfo.type;
      addLog(`Connecting to ${deviceInfo.mac} (${deviceType})...`);

      // Connect to device
      const connected = await deviceService.connect(deviceInfo.mac, deviceType);
      
      if (!connected) {
        addLog("Connection returned false - device may need to be in pairing mode");
        setStatusMessage("Turn on your device and try again...");
        // Don't set error status - keep trying
      }
    } catch (error: any) {
      addLog(`Error: ${error.message}`);
      setStatus("error");
      setStatusMessage(error.message || "Failed to connect");
    }
  };

  // Save reading
  const handleSaveReading = async () => {
    if (!currentReading) return;

    try {
      addLog("Saving reading...");
      
      // Save to local DB
      saveReading(currentReading);
      
      // Attempt EMR sync
      const savedReading = {
        ...currentReading,
        id: `reading_${Date.now()}`,
        ts: Date.now(),
        synced: false,
      };
      
      syncReading(savedReading).then((synced) => {
        addLog(`EMR sync: ${synced ? "SUCCESS" : "QUEUED"}`);
      });

      // Reload readings
      dispatch(loadReadings());

      // Disconnect device
      await deviceService.disconnect(deviceInfo.mac);

      // Navigate to result
      navigation.replace("Result", { reading: savedReading });
    } catch (error: any) {
      addLog(`Save error: ${error.message}`);
      Alert.alert("Error", "Failed to save reading");
    }
  };

  // Cancel and go back
  const handleCancel = async () => {
    try {
      if (deviceInfo?.mac) {
        await deviceService.disconnect(deviceInfo.mac);
      }
    } catch (e) {
      // Ignore disconnect errors
    }
    navigation.goBack();
  };

  // Retry connection
  const handleRetry = () => {
    setStatus("idle");
    setStatusMessage("Preparing...");
    setCurrentReading(null);
    hasReceivedReadingRef.current = false;
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (status) {
      case "connecting":
        return <ActivityIndicator size="large" color="#00509f" />;
      case "connected":
      case "measuring":
        return <MaterialIcons name="bluetooth-connected" size={48} color="#4CAF50" />;
      case "complete":
        return <MaterialIcons name="check-circle" size={64} color="#4CAF50" />;
      case "error":
        return <MaterialIcons name="error" size={64} color="#f44336" />;
      default:
        return <MaterialIcons name="bluetooth-searching" size={48} color="#00509f" />;
    }
  };

  // Check if BP reading is high
  const isCurrentBPHigh = () => {
    if (!currentReading || currentReading.type !== "BP") return false;
    return isBPHigh(currentReading.value, currentReading.value2, bpThresholds);
  };

  return (
    <View style={styles.container}>
      <KeepAwake />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleCancel} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#002040" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {deviceInfo?.friendlyName || deviceInfo?.name || "Capture Reading"}
        </Text>
        <TouchableOpacity
          onPress={() => setShowDebug(!showDebug)}
          style={styles.debugButton}
        >
          <MaterialIcons
            name="bug-report"
            size={24}
            color={showDebug ? "#00509f" : "#ccc"}
          />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Status Display */}
        <View style={styles.statusContainer}>
          {getStatusIcon()}
          <Text style={[
            styles.statusText,
            status === "error" && styles.statusTextError,
            isCurrentBPHigh() && styles.statusTextHigh,
          ]}>
            {statusMessage}
          </Text>
        </View>

        {/* Reading Display */}
        {currentReading && (
          <View style={[
            styles.readingCard,
            isCurrentBPHigh() && styles.readingCardHigh,
          ]}>
            {currentReading.type === "BP" ? (
              <>
                <Text style={[
                  styles.readingValue,
                  isCurrentBPHigh() && styles.readingValueHigh,
                ]}>
                  {currentReading.value}/{currentReading.value2}
                </Text>
                <Text style={styles.readingUnit}>{currentReading.unit}</Text>
                {currentReading.heartRate && (
                  <Text style={styles.readingSecondary}>
                    Pulse: {currentReading.heartRate} bpm
                  </Text>
                )}
                {isCurrentBPHigh() && (
                  <View style={styles.highAlert}>
                    <MaterialIcons name="warning" size={20} color="#c62828" />
                    <Text style={styles.highAlertText}>
                      Above threshold ({bpThresholds.systolicHigh}/{bpThresholds.diastolicHigh})
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.readingValue}>{currentReading.value}</Text>
                <Text style={styles.readingUnit}>{currentReading.unit}</Text>
              </>
            )}
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          {status === "idle" && (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={startCapture}
            >
              <MaterialIcons name="play-arrow" size={24} color="#fff" />
              <Text style={styles.primaryButtonText}>Start Capture</Text>
            </TouchableOpacity>
          )}

          {status === "complete" && (
            <>
              <TouchableOpacity
                style={[styles.primaryButton, styles.saveButton]}
                onPress={handleSaveReading}
              >
                <MaterialIcons name="save" size={24} color="#fff" />
                <Text style={styles.primaryButtonText}>Save Reading</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleRetry}
              >
                <MaterialIcons name="refresh" size={20} color="#00509f" />
                <Text style={styles.secondaryButtonText}>Take Another</Text>
              </TouchableOpacity>
            </>
          )}

          {status === "error" && (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleRetry}
            >
              <MaterialIcons name="refresh" size={24} color="#fff" />
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </TouchableOpacity>
          )}

          {(status === "connecting" || status === "connected" || status === "measuring") && (
            <View style={styles.instructionCard}>
              <MaterialIcons name="info-outline" size={24} color="#1976D2" />
              <Text style={styles.instructionText}>
                {deviceInfo?.type === "BP"
                  ? "Place the cuff on your arm and press START on the device"
                  : "Step on the scale and remain still"}
              </Text>
            </View>
          )}
        </View>

        {/* Debug Log */}
        {showDebug && (
          <View style={styles.debugContainer}>
            <Text style={styles.debugTitle}>Debug Log</Text>
            <ScrollView style={styles.debugScroll} nestedScrollEnabled>
              {debugLog.map((log, i) => (
                <Text key={i} style={styles.debugLine}>
                  {log}
                </Text>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* Daily Health Check Modal */}
      <DailyHealthCheckModal
        visible={showHealthCheckModal}
        onComplete={handleHealthCheckComplete}
      />
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
    flex: 1,
    textAlign: "center",
  },
  debugButton: {
    padding: 8,
  },
  content: {
    padding: 24,
    alignItems: "center",
  },
  statusContainer: {
    alignItems: "center",
    marginBottom: 32,
    marginTop: 24,
  },
  statusText: {
    fontSize: 18,
    color: "#333",
    marginTop: 16,
    textAlign: "center",
  },
  statusTextError: {
    color: "#f44336",
  },
  statusTextHigh: {
    color: "#c62828",
    fontWeight: "600",
  },
  readingCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    width: "100%",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  readingCardHigh: {
    borderWidth: 2,
    borderColor: "#ef5350",
    backgroundColor: "#fff5f5",
  },
  readingValue: {
    fontSize: 48,
    fontWeight: "700",
    color: "#002040",
  },
  readingValueHigh: {
    color: "#c62828",
  },
  readingUnit: {
    fontSize: 18,
    color: "#666",
    marginTop: 4,
  },
  readingSecondary: {
    fontSize: 16,
    color: "#888",
    marginTop: 12,
  },
  highAlert: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffebee",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
    gap: 8,
  },
  highAlertText: {
    color: "#c62828",
    fontSize: 14,
    fontWeight: "500",
  },
  buttonContainer: {
    width: "100%",
    alignItems: "center",
    gap: 12,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00509f",
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
    width: "100%",
    gap: 8,
  },
  saveButton: {
    backgroundColor: "#4CAF50",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0f0f0",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    gap: 8,
  },
  secondaryButtonText: {
    color: "#00509f",
    fontSize: 16,
    fontWeight: "500",
  },
  instructionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E3F2FD",
    padding: 16,
    borderRadius: 12,
    width: "100%",
    gap: 12,
  },
  instructionText: {
    flex: 1,
    fontSize: 15,
    color: "#1565C0",
    lineHeight: 22,
  },
  debugContainer: {
    width: "100%",
    marginTop: 24,
    backgroundColor: "#1e1e1e",
    borderRadius: 12,
    padding: 12,
    maxHeight: 200,
  },
  debugTitle: {
    color: "#4CAF50",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  debugScroll: {
    maxHeight: 160,
  },
  debugLine: {
    color: "#aaa",
    fontSize: 11,
    fontFamily: "monospace",
    marginBottom: 2,
  },
});
