/* eslint-disable react-native/no-inline-styles */
import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
  StatusBar,
  Share,
  Modal,
} from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import LinearGradient from "react-native-linear-gradient";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { useSelector, useDispatch } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { addReadingAndPersist } from "../../redux/readingSlice";
import { syncPendingReadings } from "../../services/vitalsSyncService";
import { NativeModules, NativeEventEmitter } from "react-native";
import type { RootState, AppDispatch } from "../../redux/store";
import type { DeviceRecord } from "../../services/sqliteService";

const { IHealthDevices } = NativeModules;
const emitter = IHealthDevices ? new NativeEventEmitter(IHealthDevices) : null;
const { width: SCREEN_WIDTH } = Dimensions.get("window");

const deviceImages: Record<string, any> = {
  BP: require("../../assets/bp3l.png"),
  SCALE: require("../../assets/hs5s.png"),
  BG: require("../../assets/bg5.png"),
};

const deviceThemes: Record<
  string,
  { primary: string; secondary: string; gradient: string[]; icon: string }
> = {
  BP: {
    primary: "#E53935",
    secondary: "#FF8A80",
    gradient: ["#E53935", "#C62828", "#B71C1C"],
    icon: "favorite",
  },
  SCALE: {
    primary: "#00ACC1",
    secondary: "#84FFFF",
    gradient: ["#00ACC1", "#0097A7", "#00838F"],
    icon: "fitness-center",
  },
  BG: {
    primary: "#43A047",
    secondary: "#B9F6CA",
    gradient: ["#43A047", "#388E3C", "#2E7D32"],
    icon: "water-drop",
  },
};

// ============================================================================
// Meal Timing Options for Blood Glucose
// ============================================================================
const MEAL_TIMING_OPTIONS = [
  { id: "fasting", label: "Fasting", icon: "nightlight-round" },
  { id: "pre_breakfast", label: "Before Breakfast", icon: "wb-sunny" },
  { id: "post_breakfast", label: "After Breakfast", icon: "free-breakfast" },
  { id: "pre_lunch", label: "Before Lunch", icon: "lunch-dining" },
  { id: "post_lunch", label: "After Lunch", icon: "restaurant" },
  { id: "pre_dinner", label: "Before Dinner", icon: "dinner-dining" },
  { id: "post_dinner", label: "After Dinner", icon: "tapas" },
  { id: "bedtime", label: "Bedtime", icon: "bedtime" },
];

/**
 * Auto-select the most likely meal timing based on current time
 */
function getDefaultMealTiming(): string {
  const hour = new Date().getHours();
  
  // 5am-7am: Fasting (early morning, likely before eating)
  if (hour >= 5 && hour < 7) return "fasting";
  
  // 7am-8am: Before breakfast
  if (hour >= 7 && hour < 8) return "pre_breakfast";
  
  // 8am-10am: After breakfast
  if (hour >= 8 && hour < 10) return "post_breakfast";
  
  // 10am-12pm: Before lunch
  if (hour >= 10 && hour < 12) return "pre_lunch";
  
  // 12pm-2pm: After lunch
  if (hour >= 12 && hour < 14) return "post_lunch";
  
  // 2pm-5pm: Before dinner (afternoon)
  if (hour >= 14 && hour < 17) return "pre_dinner";
  
  // 5pm-8pm: After dinner
  if (hour >= 17 && hour < 20) return "post_dinner";
  
  // 8pm-10pm: Bedtime
  if (hour >= 20 && hour < 22) return "bedtime";
  
  // 10pm-5am: Fasting (night/early morning)
  return "fasting";
}

/**
 * Get display label for meal timing
 */
function getMealTimingLabel(id: string): string {
  const option = MEAL_TIMING_OPTIONS.find(o => o.id === id);
  return option?.label || id;
}

export default function CaptureScreen({ route, navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const insets = useSafeAreaInsets();
  const { deviceId } = route.params ?? {};

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "auth" | "scan" | "connect" | "measure" | "success"
  >("idle");
  const [statusText, setStatusText] = useState<string>("");
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [lastReading, setLastReading] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<"" | "syncing" | "synced" | "pending">("");
  const scrollRef = useRef<ScrollView>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetMacRef = useRef<string>("");

  // BG Meal Timing Modal State
  const [showMealTimingModal, setShowMealTimingModal] = useState(false);
  const [selectedMealTiming, setSelectedMealTiming] = useState<string>(getDefaultMealTiming());
  const [pendingGlucoseReading, setPendingGlucoseReading] = useState<any>(null);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const devices = useSelector((state: RootState) => state.devices.devices);
  const device: DeviceRecord | undefined = useMemo(
    () => devices.find((d) => d.id === deviceId),
    [devices, deviceId]
  );

  const theme = deviceThemes[device?.type || "BP"];

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
    console.log(`[Capture] ${msg}`);
  }, []);

  // Reset all state to initial values
  const resetState = useCallback(() => {
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    // Stop any ongoing scan/connection
    IHealthDevices?.stopScan?.().catch(() => {});
    IHealthDevices?.disconnectAll?.().catch(() => {});
    
    // Reset all state
    setBusy(false);
    setPhase("idle");
    setStatusText("");
    setDebugLogs([]);
    setLastReading(null);
    setSyncStatus("");
    targetMacRef.current = "";
    
    // Reset meal timing state
    setShowMealTimingModal(false);
    setSelectedMealTiming(getDefaultMealTiming());
    setPendingGlucoseReading(null);
    
    // Reset animations
    pulseAnim.setValue(1);
    ringRotate.setValue(0);
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.8);
    waveAnim.setValue(0);
    successScale.setValue(0);
    progressAnim.setValue(0);
  }, [pulseAnim, ringRotate, fadeAnim, scaleAnim, waveAnim, successScale, progressAnim]);

  // Reset state when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      // Reset state when screen gains focus
      resetState();
      
      // Play entry animation after reset
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();

      // Cleanup when screen loses focus
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        IHealthDevices?.stopScan?.().catch(() => {});
      };
    }, [resetState, fadeAnim, scaleAnim])
  );

  // Pulse animation when busy
  useEffect(() => {
    if (busy && phase !== "success") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [busy, phase, pulseAnim]);

  // Ring rotation animation
  useEffect(() => {
    if (busy && phase !== "success") {
      const rotate = Animated.loop(
        Animated.timing(ringRotate, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      rotate.start();
      return () => rotate.stop();
    } else {
      ringRotate.setValue(0);
    }
  }, [busy, phase, ringRotate]);

  // Wave animation for measuring phase
  useEffect(() => {
    if (phase === "measure") {
      const wave = Animated.loop(
        Animated.timing(waveAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      wave.start();
      return () => wave.stop();
    }
  }, [phase, waveAnim]);

  // Progress animation
  useEffect(() => {
    if (busy) {
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 90000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    } else {
      progressAnim.setValue(0);
    }
  }, [busy, progressAnim]);

  // Success animation
  const playSuccessAnimation = useCallback(() => {
    setPhase("success");
    Animated.spring(successScale, {
      toValue: 1,
      friction: 4,
      tension: 50,
      useNativeDriver: true,
    }).start();
  }, [successScale]);

  // Listen for native debug logs
  useEffect(() => {
    if (!emitter) return;
    const sub = emitter.addListener("onDebugLog", (data: any) => {
      addLog(`[Native] ${data.message}`);
    });
    return () => sub.remove();
  }, [addLog]);

  // Listen for device discovery
  useEffect(() => {
    if (!emitter) return;
    const sub = emitter.addListener("onDeviceFound", async (data: any) => {
      addLog(`[Found] ${data.name} (${data.type}) MAC=${data.mac}`);

      const targetMac = targetMacRef.current;
      if (
        targetMac &&
        data.mac &&
        data.mac.toUpperCase() === targetMac.toUpperCase()
      ) {
        addLog(`🎯 TARGET DEVICE FOUND! Connecting...`);
        setPhase("connect");
        setStatusText("Found you! Connecting...");

        try {
          await IHealthDevices.stopScan();
          const result = await IHealthDevices.connectDevice(data.mac, data.type);
          addLog(`Connect initiated: ${result}`);
        } catch (e: any) {
          addLog(`Connect error: ${e.message}`);
        }
      }
    });
    return () => sub.remove();
  }, [addLog]);

  // Listen for connection state
  useEffect(() => {
    if (!emitter) return;
    const sub = emitter.addListener("onConnectionStateChanged", (data: any) => {
      addLog(
        `[Connection] ${data.mac} connected=${data.connected} type=${data.type}`
      );

      if (data.connected) {
        setPhase("measure");
        if (device?.type === "SCALE") {
          setStatusText("Step on the scale");
        } else if (device?.type === "BG") {
          setStatusText("Insert test strip");
        } else {
          setStatusText("Keep still, measuring...");
        }
      } else if (busy) {
        addLog("Device disconnected!");
        setStatusText("Disconnected");
      }
    });
    return () => sub.remove();
  }, [addLog, device, busy]);

  // Helper to sync after saving
  const syncToEMR = useCallback(async () => {
    addLog("📤 Syncing to EMR...");
    setSyncStatus("syncing");
    try {
      const result = await syncPendingReadings();
      if (result.synced > 0) {
        addLog(`✅ Synced to EMR`);
        setSyncStatus("synced");
      } else if (result.remaining > 0) {
        addLog(`⏳ Queued for sync (offline or error)`);
        setSyncStatus("pending");
      } else {
        setSyncStatus("synced");
      }
    } catch (e: any) {
      addLog(`⚠️ Sync error: ${e.message}`);
      setSyncStatus("pending");
    }
  }, [addLog]);

  // Save functions
  const saveBPReading = useCallback(
    (data: any) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      dispatch(
        addReadingAndPersist({
          type: "BP",
          deviceId: device?.id || "",
          deviceName: device?.name || "BP Monitor",
          value: data.systolic,
          value2: data.diastolic,
          heartRate: data.pulse,
          unit: "mmHg",
          // Note: heartRate is stored separately, vitalsSyncService maps it to measurement_condition
        })
      );
      setLastReading({
        systolic: data.systolic,
        diastolic: data.diastolic,
        pulse: data.pulse,
      });
      setStatusText(`${data.systolic}/${data.diastolic}`);
      setBusy(false);
      playSuccessAnimation();
      syncToEMR();
    },
    [device, dispatch, playSuccessAnimation, syncToEMR]
  );

  const saveWeightReading = useCallback(
    (data: any) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const kg = parseFloat(data.weight) || 0;
      const lbs = Math.round(kg * 2.20462 * 10) / 10;
      dispatch(
        addReadingAndPersist({
          type: "SCALE",
          deviceId: device?.id || "",
          deviceName: device?.name || "Scale",
          value: lbs,
          unit: "lbs",
        })
      );
      setLastReading({ weight: lbs, kg });
      setStatusText(`${lbs} lbs`);
      setBusy(false);
      playSuccessAnimation();
      syncToEMR();
    },
    [device, dispatch, playSuccessAnimation, syncToEMR]
  );

  // For BG: Show modal first, then save with selected meal timing
  const handleGlucoseReading = useCallback(
    (data: any) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      
      // Store the reading data and show the meal timing modal
      setPendingGlucoseReading(data);
      setSelectedMealTiming(getDefaultMealTiming()); // Reset to time-based default
      setShowMealTimingModal(true);
      
      // Update UI to show we got a reading
      setStatusText(`${data.value} ${data.unit || "mg/dL"}`);
      setBusy(false);
    },
    []
  );

  // Called when user confirms meal timing selection
  const confirmGlucoseReading = useCallback(() => {
    if (!pendingGlucoseReading) return;
    
    const data = pendingGlucoseReading;
    const mealTimingLabel = getMealTimingLabel(selectedMealTiming);
    
    addLog(`💉 Saving glucose reading with meal timing: ${mealTimingLabel}`);
    
    dispatch(
      addReadingAndPersist({
        type: "BG",
        deviceId: device?.id || "",
        deviceName: device?.name || "Glucose Meter",
        value: data.value,
        unit: data.unit || "mg/dL",
        measurementCondition: mealTimingLabel, // This gets sent to EMR
      })
    );
    
    setLastReading({ 
      value: data.value, 
      unit: data.unit || "mg/dL",
      mealTiming: mealTimingLabel,
    });
    
    setShowMealTimingModal(false);
    setPendingGlucoseReading(null);
    playSuccessAnimation();
    syncToEMR();
  }, [pendingGlucoseReading, selectedMealTiming, device, dispatch, addLog, playSuccessAnimation, syncToEMR]);

  // Listen for readings
  useEffect(() => {
    if (!emitter) return;

    const subs = [
      emitter.addListener("onBloodPressureReading", (data: any) => {
        addLog(`🎉 BP: ${data.systolic}/${data.diastolic} pulse=${data.pulse}`);
        saveBPReading(data);
      }),
      emitter.addListener("onWeightReading", (data: any) => {
        addLog(`🎉 Weight: ${data.weight} ${data.unit}`);
        saveWeightReading(data);
      }),
      emitter.addListener("onBloodGlucoseReading", (data: any) => {
        addLog(`🎉 Glucose: ${data.value} ${data.unit}`);
        handleGlucoseReading(data);
      }),
      emitter.addListener("onError", (data: any) => {
        addLog(`❌ Error: ${data.message || JSON.stringify(data)}`);
      }),
    ];

    return () => subs.forEach((s) => s.remove());
  }, [addLog, saveBPReading, saveWeightReading, handleGlucoseReading]);

  const start = useCallback(async () => {
    if (!device) {
      Alert.alert("Error", "Device not found");
      return;
    }
    if (!IHealthDevices || !emitter) {
      Alert.alert("Error", "Native module not available");
      return;
    }

    setDebugLogs([]);
    setBusy(true);
    setLastReading(null);
    setSyncStatus("");
    successScale.setValue(0);

    const mac = device.mac || device.id;
    targetMacRef.current = mac;
    addLog(`Starting for ${device.name}, MAC: ${mac}`);

    setPhase("auth");
    setStatusText("Initializing...");

    try {
      addLog("Authenticating SDK...");
      await IHealthDevices.authenticate("license.pem");
      addLog("✅ Authenticated");
    } catch (e: any) {
      addLog(`Auth note: ${e.message}`);
    }

    setPhase("scan");
    if (device.type === "SCALE") {
      setStatusText("Step on scale to wake it");
    } else if (device.type === "BG") {
      setStatusText("Turn on your meter");
    } else {
      setStatusText("Press start on device");
    }

    try {
      addLog("Starting scan for all device types...");
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
      addLog("✅ Scan started");
    } catch (e: any) {
      addLog(`Scan error: ${e.message}`);
      Alert.alert("Scan Error", e.message);
      setBusy(false);
      setPhase("idle");
      return;
    }

    timeoutRef.current = setTimeout(() => {
      addLog("⏰ Timeout - no reading received");
      IHealthDevices.stopScan?.().catch(() => {});
      setBusy(false);
      setPhase("idle");
      setStatusText("");
      Alert.alert(
        "Timeout",
        "No reading received. Make sure device is awake and try again."
      );
    }, 90000);
  }, [device, addLog, successScale]);

  const cancel = useCallback(async () => {
    addLog("Cancelled by user");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    targetMacRef.current = "";
    try {
      await IHealthDevices?.stopScan?.();
      await IHealthDevices?.disconnectAll?.();
    } catch (e) {}
    setBusy(false);
    setPhase("idle");
    setStatusText("");
  }, [addLog]);

  const done = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  if (!device) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={["#1a1a2e", "#16213e"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Device not found</Text>
          <TouchableOpacity
            style={styles.backButtonAlt}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const ringInterpolate = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const getPhaseMessage = () => {
    switch (phase) {
      case "auth":
        return "Initializing...";
      case "scan":
        if (device.type === "SCALE") return "👆 Step on scale to wake it";
        if (device.type === "BG") return "👆 Turn on your meter";
        return "👆 Press start on your device";
      case "connect":
        return "🔗 Connecting...";
      case "measure":
        if (device.type === "SCALE") return "🦶 Hold still...";
        if (device.type === "BG") return "🩸 Apply blood sample";
        return "💪 Keep arm relaxed...";
      case "success":
        return "✨ Reading saved!";
      default:
        return "Ready to measure";
    }
  };

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case "syncing":
        return "Syncing to EMR...";
      case "synced":
        return "✓ Synced to EMR";
      case "pending":
        return "Will sync when online";
      default:
        return "";
    }
  };

  const renderReadingDisplay = () => {
    if (phase === "success" && lastReading) {
      if (device.type === "BP") {
        return (
          <Animated.View
            style={[
              styles.readingContainer,
              { transform: [{ scale: successScale }] },
            ]}
          >
            <View style={styles.bpReading}>
              <Text style={styles.bpValue}>{lastReading.systolic}</Text>
              <Text style={styles.bpSeparator}>/</Text>
              <Text style={styles.bpValue}>{lastReading.diastolic}</Text>
            </View>
            <Text style={styles.readingUnit}>mmHg</Text>
            <View style={styles.pulseContainer}>
              <MaterialIcons name="favorite" size={18} color={theme.secondary} />
              <Text style={styles.pulseText}>{lastReading.pulse} bpm</Text>
            </View>
            {syncStatus !== "" && (
              <Text
                style={[
                  styles.syncStatusText,
                  syncStatus === "synced" && styles.syncStatusSynced,
                  syncStatus === "pending" && styles.syncStatusPending,
                ]}
              >
                {getSyncStatusText()}
              </Text>
            )}
          </Animated.View>
        );
      } else if (device.type === "SCALE") {
        return (
          <Animated.View
            style={[
              styles.readingContainer,
              { transform: [{ scale: successScale }] },
            ]}
          >
            <Text style={styles.weightValue}>{lastReading.weight}</Text>
            <Text style={styles.readingUnit}>lbs</Text>
            <Text style={styles.subReading}>{lastReading.kg} kg</Text>
            {syncStatus !== "" && (
              <Text
                style={[
                  styles.syncStatusText,
                  syncStatus === "synced" && styles.syncStatusSynced,
                  syncStatus === "pending" && styles.syncStatusPending,
                ]}
              >
                {getSyncStatusText()}
              </Text>
            )}
          </Animated.View>
        );
      } else if (device.type === "BG") {
        return (
          <Animated.View
            style={[
              styles.readingContainer,
              { transform: [{ scale: successScale }] },
            ]}
          >
            <Text style={styles.glucoseValue}>{lastReading.value}</Text>
            <Text style={styles.readingUnit}>{lastReading.unit}</Text>
            {lastReading.mealTiming && (
              <View style={styles.mealTimingBadge}>
                <MaterialIcons name="schedule" size={16} color="#43A047" />
                <Text style={styles.mealTimingText}>{lastReading.mealTiming}</Text>
              </View>
            )}
            {syncStatus !== "" && (
              <Text
                style={[
                  styles.syncStatusText,
                  syncStatus === "synced" && styles.syncStatusSynced,
                  syncStatus === "pending" && styles.syncStatusPending,
                ]}
              >
                {getSyncStatusText()}
              </Text>
            )}
          </Animated.View>
        );
      }
    }
    return null;
  };

  const bottomPadding = Math.max(insets.bottom + 100, 140);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={["#1a1a2e", "#16213e", "#0f0f23"]}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
        >
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Capture Reading</Text>
        <TouchableOpacity
          onPress={() => setShowDebug(!showDebug)}
          style={styles.headerBtn}
        >
          <MaterialIcons
            name="bug-report"
            size={22}
            color={showDebug ? theme.primary : "#666"}
          />
        </TouchableOpacity>
      </Animated.View>

      {/* Main Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomPadding },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.content,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* Device Visual */}
          <View style={styles.deviceSection}>
            <Animated.View
              style={[
                styles.deviceRing,
                {
                  borderColor: theme.primary,
                  transform: [
                    { scale: pulseAnim },
                    {
                      rotate:
                        busy && phase !== "success" ? ringInterpolate : "0deg",
                    },
                  ],
                },
              ]}
            >
              {busy && phase !== "success" && (
                <>
                  <View
                    style={[
                      styles.ringDot,
                      styles.ringDot1,
                      { backgroundColor: theme.primary },
                    ]}
                  />
                  <View
                    style={[
                      styles.ringDot,
                      styles.ringDot2,
                      { backgroundColor: theme.secondary },
                    ]}
                  />
                </>
              )}
            </Animated.View>

            <View style={styles.deviceImageContainer}>
              <Image
                source={deviceImages[device.type]}
                style={styles.deviceImage}
              />
              {phase === "success" && (
                <View
                  style={[
                    styles.successBadge,
                    { backgroundColor: theme.primary },
                  ]}
                >
                  <MaterialIcons name="check" size={24} color="#fff" />
                </View>
              )}
            </View>
          </View>

          {/* Device Info */}
          <Text style={styles.deviceName}>{device.name}</Text>
          <Text style={styles.deviceType}>
            {device.type === "BP"
              ? "Blood Pressure Monitor"
              : device.type === "SCALE"
              ? "Smart Scale"
              : "Glucose Meter"}
          </Text>

          {/* Reading Display or Status */}
          {phase === "success" && lastReading ? (
            renderReadingDisplay()
          ) : (
            <View style={styles.statusSection}>
              <Text
                style={[
                  styles.statusText,
                  { color: busy ? theme.secondary : "#888" },
                ]}
              >
                {getPhaseMessage()}
              </Text>
              {busy && statusText && (
                <Text style={styles.statusSubtext}>{statusText}</Text>
              )}
            </View>
          )}

          {/* Progress Bar */}
          {busy && phase !== "success" && (
            <View style={styles.progressContainer}>
              <Animated.View
                style={[
                  styles.progressBar,
                  {
                    backgroundColor: theme.primary,
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", "100%"],
                    }),
                  },
                ]}
              />
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            {phase === "idle" && (
              <TouchableOpacity onPress={start} activeOpacity={0.8}>
                <LinearGradient
                  colors={theme.gradient}
                  style={styles.primaryButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.primaryButtonText}>Start Capture</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {busy && phase !== "success" && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={cancel}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}

            {phase === "success" && (
              <TouchableOpacity onPress={done} activeOpacity={0.8}>
                <LinearGradient
                  colors={theme.gradient}
                  style={styles.primaryButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.primaryButtonText}>Done</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </ScrollView>

      {/* Meal Timing Modal for Blood Glucose */}
      <Modal
        visible={showMealTimingModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          // Don't allow dismissing without selection - user must pick one
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <MaterialIcons name="schedule" size={28} color="#43A047" />
              <Text style={styles.modalTitle}>When did you take this reading?</Text>
            </View>
            
            <Text style={styles.modalSubtitle}>
              Select the time period that best describes when you took this glucose reading
            </Text>

            <ScrollView style={styles.optionsContainer} showsVerticalScrollIndicator={false}>
              {MEAL_TIMING_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.optionButton,
                    selectedMealTiming === option.id && styles.optionButtonSelected,
                  ]}
                  onPress={() => setSelectedMealTiming(option.id)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={option.icon as any}
                    size={24}
                    color={selectedMealTiming === option.id ? "#fff" : "#43A047"}
                  />
                  <Text
                    style={[
                      styles.optionText,
                      selectedMealTiming === option.id && styles.optionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {selectedMealTiming === option.id && (
                    <MaterialIcons name="check-circle" size={24} color="#fff" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={confirmGlucoseReading}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmButtonText}>Confirm & Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Debug Panel */}
      {showDebug && (
        <View style={styles.debugPanel}>
          <View style={styles.debugHeader}>
            <Text style={styles.debugTitle}>Debug Log</Text>
            <TouchableOpacity onPress={() => setShowDebug(false)}>
              <MaterialIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView
            ref={scrollRef}
            style={styles.debugScroll}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd()}
          >
            {debugLogs.length === 0 ? (
              <Text style={styles.logLine}>Tap Start to begin...</Text>
            ) : (
              debugLogs.map((log, i) => (
                <Text
                  key={i}
                  style={[
                    styles.logLine,
                    log.includes("🎉") && styles.logSuccess,
                    log.includes("❌") && styles.logError,
                    log.includes("🎯") && styles.logTarget,
                    log.includes("[Native]") && styles.logNative,
                    log.includes("[Found]") && styles.logFound,
                    log.includes("📤") && styles.logSync,
                    log.includes("Synced to EMR") && styles.logSuccess,
                  ]}
                >
                  {log}
                </Text>
              ))
            )}
          </ScrollView>
          <View style={styles.debugButtons}>

          <TouchableOpacity
    style={[styles.debugBtn, styles.debugBtnYellow]}
    onPress={async () => {
      addLog("🔧 Direct connect to BG5S MAC: 004D3229FEE0");
      try {
        // Make sure BG5S controller is ready
        await IHealthDevices.authenticate("license.pem");
        addLog("✅ Authenticated");
        
        // Try direct connect without scan
        const result = await IHealthDevices.connectDevice("004D3229FEE0", "BG5S");
        addLog(`✅ Connect result: ${JSON.stringify(result)}`);
      } catch (e: any) {
        addLog(`❌ Direct connect error: ${e.message}`);
      }
    }}
  >
    <Text style={styles.debugBtnText}>BG5S Direct</Text>
  </TouchableOpacity>
            <TouchableOpacity
              style={[styles.debugBtn, styles.debugBtnBlue]}
              onPress={async () => {
                if (IHealthDevices?.sendBG5SInit) {
                  addLog("🔧 Sending BG5S init commands...");
                  try {
                    await IHealthDevices.sendBG5SInit();
                    addLog("✅ Init commands sent - watch for response");
                  } catch (e: any) {
                    addLog(`❌ Init error: ${e.message}`);
                  }
                } else {
                  addLog("❌ sendBG5SInit not available");
                }
              }}
            >
              <Text style={styles.debugBtnText}>Send Init</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.debugBtn}
              onPress={() => {
                const logText = debugLogs.join("\n");
                Clipboard.setString(logText);
                Alert.alert("Copied!", `${debugLogs.length} log lines copied to clipboard.`);
              }}
            >
              <Text style={styles.debugBtnText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.debugBtn, styles.debugBtnGreen]}
              onPress={async () => {
                const logText = debugLogs.join("\n");
                try {
                  await Share.share({
                    message: `CareView Debug Log (${new Date().toLocaleString()})\n\n${logText}`,
                    title: "Debug Log",
                  });
                } catch (e) {
                  // User cancelled
                }
              }}
            >
              <Text style={styles.debugBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  deviceSection: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  deviceRing: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderStyle: "dashed",
    opacity: 0.5,
  },
  ringDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  ringDot1: {
    top: -6,
    left: "50%",
    marginLeft: -6,
  },
  ringDot2: {
    bottom: -6,
    left: "50%",
    marginLeft: -6,
  },
  deviceImageContainer: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  deviceImage: {
    width: 75,
    height: 75,
    resizeMode: "contain",
  },
  successBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#1a1a2e",
  },
  deviceName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 2,
    textAlign: "center",
  },
  deviceType: {
    fontSize: 13,
    color: "#888",
    marginBottom: 20,
    textAlign: "center",
  },
  statusSection: {
    alignItems: "center",
    minHeight: 80,
    justifyContent: "center",
  },
  statusText: {
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 8,
  },
  statusSubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  readingContainer: {
    alignItems: "center",
    marginVertical: 20,
  },
  bpReading: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  bpValue: {
    fontSize: 64,
    fontWeight: "300",
    color: "#fff",
  },
  bpSeparator: {
    fontSize: 48,
    fontWeight: "200",
    color: "#666",
    marginHorizontal: 4,
  },
  readingUnit: {
    fontSize: 18,
    color: "#888",
    marginTop: 4,
  },
  pulseContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 20,
  },
  pulseText: {
    fontSize: 16,
    color: "#fff",
    marginLeft: 8,
  },
  weightValue: {
    fontSize: 72,
    fontWeight: "200",
    color: "#fff",
  },
  subReading: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
  },
  glucoseValue: {
    fontSize: 72,
    fontWeight: "200",
    color: "#fff",
  },
  mealTimingBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(67, 160, 71, 0.15)",
    borderRadius: 20,
    gap: 6,
  },
  mealTimingText: {
    fontSize: 14,
    color: "#B9F6CA",
    fontWeight: "500",
  },
  syncStatusText: {
    fontSize: 14,
    color: "#888",
    marginTop: 16,
  },
  syncStatusSynced: {
    color: "#4caf50",
  },
  syncStatusPending: {
    color: "#ffc107",
  },
  progressContainer: {
    width: "80%",
    height: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    marginTop: 24,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 2,
  },
  buttonContainer: {
    width: "100%",
    alignItems: "center",
    marginTop: 32,
    marginBottom: 20,
  },
  primaryButton: {
    width: SCREEN_WIDTH - 48,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  secondaryButton: {
    width: SCREEN_WIDTH - 48,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  secondaryButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
  },
  // Meal Timing Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    flex: 1,
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#888",
    marginBottom: 20,
    lineHeight: 20,
  },
  optionsContainer: {
    maxHeight: 350,
  },
  optionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(67, 160, 71, 0.1)",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: "transparent",
    gap: 12,
  },
  optionButtonSelected: {
    backgroundColor: "#43A047",
    borderColor: "#66BB6A",
  },
  optionText: {
    fontSize: 16,
    color: "#fff",
    flex: 1,
    fontWeight: "500",
  },
  optionTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  confirmButton: {
    backgroundColor: "#43A047",
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 16,
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  // Debug Panel Styles
  debugPanel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.95)",
    padding: 16,
    paddingTop: 60,
  },
  debugHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  debugTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  debugScroll: {
    flex: 1,
    marginBottom: 10,
  },
  logLine: {
    color: "#0f0",
    fontFamily: "monospace",
    fontSize: 11,
    marginBottom: 3,
  },
  logSuccess: {
    color: "#4caf50",
    fontWeight: "bold",
  },
  logError: {
    color: "#f44336",
  },
  logTarget: {
    color: "#ffeb3b",
    fontWeight: "bold",
  },
  logNative: {
    color: "#666",
  },
  logFound: {
    color: "#03a9f4",
  },
  logSync: {
    color: "#9c27b0",
  },
  debugButtons: {
    flexDirection: "row",
    gap: 8,
  },
  debugBtn: {
    backgroundColor: "#333",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    flex: 1,
  },
  debugBtnBlue: {
    backgroundColor: "#1976d2",
  },
  debugBtnGreen: {
    backgroundColor: "#388e3c",
  },
  debugBtnText: {
    color: "#fff",
    fontWeight: "600",
  },
  errorText: {
    fontSize: 18,
    color: "#ff5252",
    textAlign: "center",
    marginBottom: 20,
  },
  backButtonAlt: {
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
  },
  debugBtnYellow: {
    backgroundColor: "#f9a825",
  },
});