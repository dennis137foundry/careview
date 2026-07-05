import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  Modal,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
  StatusBar,
  Linking,
  Platform,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { useSelector, useDispatch } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { addReadingAndPersist } from "../../redux/readingSlice";
import { setDeviceBattery } from "../../redux/deviceSlice";
import { syncPendingReadings } from "../../services/vitalsSyncService";
import { NativeModules, NativeEventEmitter } from "react-native";
import type { RootState, AppDispatch } from "../../redux/store";
import type { DeviceRecord } from "../../services/sqliteService";
import { hasDailyHealthCheckToday, readingExists } from "../../services/sqliteService";
import DailyHealthCheckModal from "../../components/DailyHealthCheckModal";
import { useToast } from "../../components/Toast";
import deviceService, { type BluetoothStatus } from "../../services/deviceService";
import { BTN } from "../../constants/buttons";

// Below this last-known battery %, warn the user to charge before a reading.
const LOW_BATTERY_THRESHOLD = 20;

const { IHealthDevices } = NativeModules;
const emitter = IHealthDevices ? new NativeEventEmitter(IHealthDevices) : null;
const { width: SCREEN_WIDTH } = Dimensions.get("window");

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
    "CareView needs Bluetooth to add devices and capture readings. Turn Bluetooth on or allow Bluetooth permission, then try again.";

  Alert.alert("Bluetooth Needed", message, [
    { text: "Cancel", style: "cancel" },
    { text: "Open Settings", onPress: () => Linking.openSettings() },
  ]);
}

const deviceImages: Record<string, any> = {
  BP: require("../../assets/bp3l.png"),
  SCALE: require("../../assets/hs5s.png"),
  BG: require("../../assets/bg5.png"),
};

// Uniform capture accent for ALL device types — the app's teal primary.
// (Per-device color themes were removed on purpose: one look everywhere.)
const CAPTURE_ACCENT = BTN.primary;
const CAPTURE_ACCENT_SOFT = "#7fd6de";

const GLUCOSE_TIMING_OPTIONS = [
  { label: "Overnight", value: "overnight" },
  { label: "Before breakfast", value: "before breakfast" },
  { label: "After breakfast", value: "after breakfast" },
  { label: "Before lunch", value: "before lunch" },
  { label: "After lunch", value: "after lunch" },
  { label: "Before dinner", value: "before dinner" },
  { label: "After dinner", value: "after dinner" },
  { label: "Bedtime", value: "bedtime" },
] as const;

type GlucoseTimingValue = (typeof GLUCOSE_TIMING_OPTIONS)[number]["value"];

function getGlucoseTimingLabel(value?: string): string {
  return (
    GLUCOSE_TIMING_OPTIONS.find((option) => option.value === value)?.label ||
    value ||
    ""
  );
}

function parseBGTimestamp(record: any): number {
  if (typeof record?.timestamp === "number" && Number.isFinite(record.timestamp)) {
    return record.timestamp;
  }

  if (record?.measureDate) {
    const measureDate = String(record.measureDate).trim();
    const isoMeasureDate = measureDate.replace(
      /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}):?(\d{2})$/,
      "$1T$2$3:$4"
    );
    const parsed = Date.parse(isoMeasureDate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function getLatestBGRecord(payload: any): any | null {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  if (records.length === 0) return null;

  return [...records].sort(
    (a, b) => parseBGTimestamp(b) - parseBGTimestamp(a)
  )[0];
}

function buildBGReadingId(deviceId: string, data: any): string {
  const rawId = String(data?.dataID || data?.measureDate || data?.timestamp || Date.now());
  const safeId = rawId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `bg_${deviceId || "device"}_${safeId}`;
}

export default function CaptureScreen({ route, navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { deviceId } = route.params ?? {};

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "auth" | "scan" | "connect" | "measure" | "success"
  >("idle");
  const [statusText, setStatusText] = useState<string>("");
  const [lastReading, setLastReading] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<
    "" | "syncing" | "synced" | "pending"
  >("");
  const [pendingGlucoseReading, setPendingGlucoseReading] = useState<any>(null);
  const [showGlucoseTimingModal, setShowGlucoseTimingModal] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetMacRef = useRef<string>("");
  const readingReceivedRef = useRef<boolean>(false);
  const busyRef = useRef<boolean>(false);

  // ============================================================================
  // Daily Health Check Modal State (for BP devices)
  // ============================================================================
  const [showHealthCheckModal, setShowHealthCheckModal] = useState(false);
  const [healthCheckCompleted, setHealthCheckCompleted] = useState(false);

  // BP Thresholds from Redux
  const bpThresholds = useSelector(
    (state: RootState) => state.user.bpThresholds
  );

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const successRingScale = useRef(new Animated.Value(0.8)).current;
  const successRingOpacity = useRef(new Animated.Value(0)).current;
  const readingFade = useRef(new Animated.Value(0)).current;
  const buttonSlide = useRef(new Animated.Value(40)).current;

  const devices = useSelector((state: RootState) => state.devices.devices);
  const device: DeviceRecord | undefined = useMemo(
    () => devices.find((d) => d.id === deviceId),
    [devices, deviceId]
  );
  // Stable primitive for effect dependencies. The `device` OBJECT gets a
  // new identity on every Redux devices update (battery events,
  // loadDevices refreshes). Effects keyed on the object re-ran on those
  // updates — and the focus effect's re-run executes its CLEANUP first
  // (stopScan + disconnectAll), killing an in-flight measurement and
  // replaying the entry fade ("fades in over itself"). Key effects on
  // this instead; it never changes for a given deviceId.
  const deviceType = device?.type;
  const deviceDbId = device?.id;


  // ==========================================================================
  // Dev-only logging (no UI, just console in __DEV__)
  // ==========================================================================
  const addLog = useCallback((msg: string) => {
    if (__DEV__) {
      console.log(`[Capture] ${msg}`);
    }
  }, []);

  // Keep busyRef in sync so event listeners always have current value
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Check if BP reading is high based on thresholds
  const isBPHigh = useCallback(
    (systolic: number, diastolic: number) => {
      const sysHigh = bpThresholds?.systolicHigh || 140;
      const diaHigh = bpThresholds?.diastolicHigh || 90;
      return systolic >= sysHigh || diastolic >= diaHigh;
    },
    [bpThresholds]
  );

  // ============================================================================
  // Reset JS-only state (NO BLE operations — that caused the reconnect bug)
  // ============================================================================
  const resetState = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // NOTE: We intentionally do NOT call stopScan/disconnectAll here.
    // The old version that worked repeatedly never did BLE cleanup on
    // state reset — the device disconnects itself after sending data.
    // Calling disconnectAll on screen entry was corrupting the iHealth
    // SDK's internal BLE state and preventing subsequent connections.

    setBusy(false);
    setPhase("idle");
    setStatusText("");
    setLastReading(null);
    setSyncStatus("");
    setPendingGlucoseReading(null);
    setShowGlucoseTimingModal(false);
    targetMacRef.current = "";

    setShowHealthCheckModal(false);

    pulseAnim.setValue(1);
    ringRotate.setValue(0);
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.8);
    waveAnim.setValue(0);
    successScale.setValue(0);
    progressAnim.setValue(0);
    successRingScale.setValue(0.8);
    successRingOpacity.setValue(0);
    readingFade.setValue(0);
    buttonSlide.setValue(40);
  }, [
    pulseAnim,
    ringRotate,
    fadeAnim,
    scaleAnim,
    waveAnim,
    successScale,
    progressAnim,
    successRingScale,
    successRingOpacity,
    readingFade,
    buttonSlide,
  ]);

  // Check if daily health check is needed for BP devices
  useEffect(() => {
    if (deviceType === "BP") {
      const hasCompletedToday = hasDailyHealthCheckToday();
      addLog(`Daily health check completed today: ${hasCompletedToday}`);
      setHealthCheckCompleted(hasCompletedToday);
    } else {
      setHealthCheckCompleted(true);
    }
  }, [deviceType, addLog]);

  // ============================================================================
  // Focus effect — reset JS state on entry, BLE cleanup on EXIT only
  // ============================================================================
  useFocusEffect(
    // Deps MUST stay identity-stable while the screen is focused: when the
    // callback identity changes, useFocusEffect re-runs — cleanup FIRST —
    // which tears down BLE (stopScan/disconnectAll) mid-measurement and
    // replays the entry animation. Keying on the `device` object did
    // exactly that on every battery/devices Redux update.
    useCallback(() => {
      resetState();

      if (deviceType === "BP") {
        setHealthCheckCompleted(hasDailyHealthCheckToday());
      }

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

      // Cleanup when LEAVING the screen — this is the safe place for BLE teardown
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        IHealthDevices?.stopScan?.().catch(() => {});
        IHealthDevices?.disconnectAll?.().catch(() => {});
        // Allow screen to sleep when leaving capture
        IHealthDevices?.allowSleep?.();
      };
    }, [resetState, fadeAnim, scaleAnim, deviceType])
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
    // Reset animation values
    successRingScale.setValue(0.8);
    successRingOpacity.setValue(0.8);
    readingFade.setValue(0);
    buttonSlide.setValue(40);

    // Staggered animation sequence
    Animated.sequence([
      // 1. Checkmark badge springs in
      Animated.spring(successScale, {
        toValue: 1,
        friction: 5,
        tension: 60,
        useNativeDriver: true,
      }),
      // 2. Ring ripple expands outward + reading fades in + button slides up
      Animated.parallel([
        Animated.timing(successRingScale, {
          toValue: 2.2,
          duration: 700,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(successRingOpacity, {
          toValue: 0,
          duration: 700,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(readingFade, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.spring(buttonSlide, {
          toValue: 0,
          friction: 8,
          tension: 50,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [successScale, successRingScale, successRingOpacity, readingFade, buttonSlide]);

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
        addLog("Target device found! Connecting...");
        setPhase("connect");
        setStatusText("Device found. Connecting...");

        try {
          await IHealthDevices.stopScan();
          const result = await IHealthDevices.connectDevice(
            data.mac,
            data.type
          );
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
    const sub = emitter.addListener(
      "onConnectionStateChanged",
      async (data: any) => {
        addLog(
          `[Connection] ${data.mac} connected=${data.connected} type=${data.type}`
        );

        if (data.connected) {
          if (device?.type === "BG") {
            setPhase("measure");
            setStatusText("Checking stored readings...");
            return;
          }

          setPhase("measure");
          if (device?.type === "SCALE") {
            setStatusText("Step on the scale and stand still");
          } else {
            setStatusText("Measurement started. Keep your arm relaxed");
          }

          // iOS starts measurement automatically in the native layer when
          // the device connects. On Android the native module exposes a
          // no-op stub for this method on iOS, so calling it on both
          // platforms is safe — it only does real work on Android.
          try {
            await IHealthDevices.startMeasurement(data.mac);
            addLog(`startMeasurement called for ${data.mac}`);
          } catch (e: any) {
            addLog(`startMeasurement error: ${e.message}`);
          }
        } else if (busyRef.current && !readingReceivedRef.current) {
          // Unexpected disconnect — device was turned off, cuff error,
          // moved out of range, etc. Clean up and let the user know.
          addLog("Unexpected disconnect - no reading received");
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          IHealthDevices?.stopScan?.().catch(() => {});
          IHealthDevices?.allowSleep?.();
          targetMacRef.current = "";
          setBusy(false);
          setPhase("idle");
          setStatusText("");
          Alert.alert(
            "Device Disconnected",
            "The connection was lost before a reading was received. Make sure your device is nearby and try again."
          );
        }
        // If readingReceivedRef.current is true, this is an expected
        // disconnect after a successful save — ignore it.
      }
    );
    return () => sub.remove();
  }, [addLog, device]);

  // Helper to sync after saving
  const syncToEMR = useCallback(async () => {
    addLog("Syncing to EMR...");
    setSyncStatus("syncing");
    try {
      const result = await syncPendingReadings();
      if (result.synced > 0) {
        addLog("Synced to EMR");
        setSyncStatus("synced");
      } else if (result.remaining > 0) {
        addLog("Queued for sync (offline or error)");
        setSyncStatus("pending");
      } else {
        setSyncStatus("synced");
      }
    } catch (e: any) {
      addLog(`Sync error: ${e.message}`);
      setSyncStatus("pending");
    }
  }, [addLog]);

  // Save functions
  const saveBPReading = useCallback(
    async (data: any) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      // Stop scan and disconnect — data is already received.
      // This releases the GATT connection so the device turns off
      // its green BLE light and is ready for the next reading.
      readingReceivedRef.current = true;
      IHealthDevices?.stopScan?.().catch(() => {});
      IHealthDevices?.disconnectAll?.().catch(() => {});
      // Allow screen to sleep now that reading is complete
      IHealthDevices?.allowSleep?.();

      const isHigh = isBPHigh(data.systolic, data.diastolic);
      if (isHigh) {
        addLog(
          `BP reading is HIGH (threshold: ${bpThresholds?.systolicHigh}/${bpThresholds?.diastolicHigh})`
        );
      }

      try {
        await dispatch(
          addReadingAndPersist({
            type: "BP",
            deviceId: device?.id || "",
            deviceName: device?.name || "BP Monitor",
            value: data.systolic,
            value2: data.diastolic,
            heartRate: data.pulse,
            unit: "mmHg",
          })
        ).unwrap();
      } catch (err) {
        console.error("[Capture] Failed to save BP reading:", err);
        setBusy(false);
        setStatusText("");
        showToast({
          message: "Couldn't save your reading. Please try again.",
          type: "error",
          duration: 4000,
        });
        return;
      }

      setLastReading({
        systolic: data.systolic,
        diastolic: data.diastolic,
        pulse: data.pulse,
        isHigh,
      });
      setStatusText(`${data.systolic}/${data.diastolic}`);
      setBusy(false);
      playSuccessAnimation();
      syncToEMR();
    },
    [
      device,
      dispatch,
      playSuccessAnimation,
      syncToEMR,
      isBPHigh,
      bpThresholds,
      addLog,
      showToast,
    ]
  );

  const saveWeightReading = useCallback(
    async (data: any) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      // Stop scan and disconnect — data is already received.
      // Release the connection after the reading is saved.
      // cleanly and is ready for the next reading.
      readingReceivedRef.current = true;
      IHealthDevices?.stopScan?.().catch(() => {});
      IHealthDevices?.disconnectAll?.().catch(() => {});
      // Allow screen to sleep now that reading is complete
      IHealthDevices?.allowSleep?.();

      const kg = parseFloat(data.weight) || 0;
      const lbs = Math.floor(kg * 2.20462 * 10) / 10;

      try {
        await dispatch(
          addReadingAndPersist({
            type: "SCALE",
            deviceId: device?.id || "",
            deviceName: device?.name || "Scale",
            value: lbs,
            unit: "lbs",
          })
        ).unwrap();
      } catch (err) {
        console.error("[Capture] Failed to save weight reading:", err);
        setBusy(false);
        setStatusText("");
        showToast({
          message: "Couldn't save your reading. Please try again.",
          type: "error",
          duration: 4000,
        });
        return;
      }

      setLastReading({ weight: lbs, kg });
      setStatusText(`${lbs} lbs`);
      setBusy(false);
      playSuccessAnimation();
      syncToEMR();
    },
    [device, dispatch, playSuccessAnimation, syncToEMR, showToast]
  );

  const promptForGlucoseTiming = useCallback(
    async (data: any) => {
      if (readingReceivedRef.current) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      const value = Number(data?.value);
      if (!Number.isFinite(value) || value <= 0) {
        addLog("BG5S returned no usable glucose value");
        IHealthDevices?.stopScan?.().catch(() => {});
        IHealthDevices?.disconnectAll?.().catch(() => {});
        IHealthDevices?.allowSleep?.();
        targetMacRef.current = "";
        setBusy(false);
        setPhase("idle");
        setStatusText("");
        Alert.alert(
          "No Glucose Reading",
          "The meter connected, but no stored glucose reading was found. Take a reading on the meter, then try capture again."
        );
        return;
      }

      // The meter re-delivers its stored records on every connection (we
      // never erase its memory). Reading ids are deterministic — built
      // from the meter's own record id — so an id hit means this exact
      // record was already captured: don't re-prompt for the sample
      // window, don't re-save (a re-save resets the synced flag and
      // triggers a redundant EMR round-trip the server would just dedup).
      const candidateId = buildBGReadingId(deviceDbId || "", {
        ...data,
        timestamp: parseBGTimestamp(data),
      });
      if (readingExists(candidateId)) {
        addLog(`BG5S record already captured (${candidateId}) — skipping`);
        IHealthDevices?.stopScan?.().catch(() => {});
        IHealthDevices?.disconnectAll?.().catch(() => {});
        IHealthDevices?.allowSleep?.();
        targetMacRef.current = "";
        setBusy(false);
        setPhase("idle");
        setStatusText("");
        Alert.alert(
          "No New Readings",
          "The reading stored on your meter has already been captured. Take a new reading on the meter, then capture again."
        );
        return;
      }

      readingReceivedRef.current = true;
      IHealthDevices?.stopScan?.().catch(() => {});
      IHealthDevices?.disconnectAll?.().catch(() => {});
      IHealthDevices?.allowSleep?.();

      setPendingGlucoseReading(data);
      setBusy(false);
      setStatusText("Select sample window");
      setShowGlucoseTimingModal(true);
    },
    [addLog, deviceDbId]
  );

  const saveGlucoseReading = useCallback(
    async (timing: GlucoseTimingValue) => {
      const data = pendingGlucoseReading;
      if (!data) return;

      const value = Number(data?.value);
      const ts = parseBGTimestamp(data);
      // Same source as the already-captured check in promptForGlucoseTiming
      // — the two MUST build identical ids.
      const deviceIdForReading = deviceDbId || "";
      const unit = data?.unit || "mg/dL";

      try {
        await dispatch(
          addReadingAndPersist({
            id: buildBGReadingId(deviceIdForReading, { ...data, timestamp: ts }),
            ts,
            type: "BG",
            deviceId: deviceIdForReading,
            deviceName: device?.name || "Glucose Meter",
            value,
            unit,
            measurementCondition: timing,
          })
        ).unwrap();
      } catch (err) {
        console.error("[Capture] Failed to save glucose reading:", err);
        readingReceivedRef.current = false;
        setBusy(false);
        setStatusText("");
        showToast({
          message: "Couldn't save your glucose reading. Please try again.",
          type: "error",
          duration: 4000,
        });
        return;
      }

      setShowGlucoseTimingModal(false);
      setPendingGlucoseReading(null);
      setLastReading({
        glucose: value,
        unit,
        timing,
        timingLabel: getGlucoseTimingLabel(timing),
      });
      setStatusText(`${value} ${unit}`);
      setBusy(false);
      playSuccessAnimation();
      syncToEMR();
    },
    [
      device,
      dispatch,
      pendingGlucoseReading,
      playSuccessAnimation,
      showToast,
      syncToEMR,
    ]
  );

  // BG5S capture uses the working debug path: connect, pull stored records,
  // then ask for the sample window before saving and syncing.
  //
  // iOS only: this pull path calls debugBG5SGetOfflineData, which doesn't exist on
  // Android. On Android the native module auto-pulls stored records on connect and
  // delivers them via onBloodGlucoseReading (handled by the reading listener below),
  // so running this here would just throw "offline data API not available".
  useEffect(() => {
    if (!emitter || device?.type !== "BG") return;
    if (Platform.OS !== "ios") return;

    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(() => resolve(), ms));

    const readStoredBG5SData = async (mac: string) => {
      let lastError: any;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          if (!IHealthDevices?.debugBG5SGetOfflineData) {
            throw new Error("BG5S offline data API is not available in this build");
          }
          return await IHealthDevices.debugBG5SGetOfflineData(mac);
        } catch (error) {
          lastError = error;
          await wait(600);
        }
      }
      throw lastError;
    };

    const sub = emitter.addListener("onConnectionStateChanged", async (data: any) => {
      if (!data.connected || !busyRef.current || readingReceivedRef.current) return;
      const targetMac = targetMacRef.current;
      if (
        targetMac &&
        data.mac &&
        data.mac.toUpperCase() !== targetMac.toUpperCase()
      ) {
        return;
      }

      setPhase("measure");
      setStatusText("Checking stored readings...");
      addLog("BG5S connected; reading stored records");

      try {
        const payload = await readStoredBG5SData(data.mac);
        const latest = getLatestBGRecord(payload);
        await promptForGlucoseTiming({
          ...(latest || {}),
          mac: data.mac,
          type: "BG5S",
          source: "iHealthSDK",
        });
      } catch (e: any) {
        addLog(`BG5S stored read error: ${e?.message || String(e)}`);
        IHealthDevices?.stopScan?.().catch(() => {});
        IHealthDevices?.disconnectAll?.().catch(() => {});
        IHealthDevices?.allowSleep?.();
        targetMacRef.current = "";
        setBusy(false);
        setPhase("idle");
        setStatusText("");
        Alert.alert(
          "Glucose Read Error",
          "The meter connected, but the app could not read its stored glucose data. Keep the meter nearby and try again."
        );
      }
    });

    return () => sub.remove();
  }, [addLog, device, promptForGlucoseTiming]);

  // Listen for readings
  useEffect(() => {
    if (!emitter) return;

    const subs = [
      emitter.addListener("onBloodPressureReading", (data: any) => {
        addLog(`BP: ${data.systolic}/${data.diastolic} pulse=${data.pulse}`);
        saveBPReading(data);
      }),
      emitter.addListener("onWeightReading", (data: any) => {
        addLog(`Weight: ${data.weight} ${data.unit}`);
        saveWeightReading(data);
      }),
      emitter.addListener("onBloodGlucoseReading", (data: any) => {
        if (device?.type !== "BG") return;
        addLog(`BG: ${data.value} ${data.unit || "mg/dL"}`);
        promptForGlucoseTiming(data);
      }),
      emitter.addListener("onBatteryLevel", (data: any) => {
        if (typeof data?.level === "number" && data?.mac) {
          addLog(`Battery: ${data.level}% (${data.type || "?"})`);
          dispatch(setDeviceBattery({ mac: data.mac, battery: data.level }));
        }
      }),
      emitter.addListener("onError", (data: any) => {
        const msg = data.message || JSON.stringify(data);
        addLog(`Error: ${msg}`);
        const code = String(data.code || data.state || "");

        // If we're actively trying to capture, reset and tell the user
        if (busyRef.current && !readingReceivedRef.current) {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          IHealthDevices?.stopScan?.().catch(() => {});
          IHealthDevices?.disconnectAll?.().catch(() => {});
          IHealthDevices?.allowSleep?.();
          targetMacRef.current = "";
          setBusy(false);
          setPhase("idle");
          setStatusText("");
          if (BLUETOOTH_ERROR_CODES.has(code)) {
            showBluetoothAlert(data);
          } else {
            Alert.alert(
              "Device Error",
              "Something went wrong during the reading. Please try again."
            );
          }
        }
      }),
    ];

    return () => subs.forEach((s) => s.remove());
  }, [addLog, device, saveBPReading, saveWeightReading, promptForGlucoseTiming, dispatch]);

  // ============================================================================
  // START CAPTURE
  // ============================================================================
  const startCapture = useCallback(async () => {
    if (!device) {
      Alert.alert("Error", "Device not found");
      return;
    }
    if (!IHealthDevices || !emitter) {
      Alert.alert("Error", "Native module not available");
      return;
    }

    try {
      await deviceService.ensureBluetoothReady();
    } catch (error: any) {
      addLog(`Bluetooth not ready: ${error?.message || String(error)}`);
      showBluetoothAlert(error?.status);
      setBusy(false);
      setPhase("idle");
      setStatusText("");
      return;
    }

    // Prevent screen from sleeping during capture
    IHealthDevices.keepAwake?.();

    setBusy(true);
    setLastReading(null);
    setSyncStatus("");
    successScale.setValue(0);
    readingReceivedRef.current = false;

    const mac = device.mac || device.id;
    targetMacRef.current = mac;
    addLog(`Starting for ${device.name}, MAC: ${mac}, Model: ${device.model}`);

    setPhase("auth");
    setStatusText("Initializing...");

    try {
      await IHealthDevices.authenticate("license.pem");
      addLog("Authenticated");
    } catch (e: any) {
      addLog(`Auth note: ${e.message}`);
    }

    setPhase("scan");
    if (device.type === "SCALE") {
      setStatusText("Finding your scale...");
    } else if (device.type === "BG") {
      setStatusText("Finding your glucose meter...");
    } else {
      setStatusText("Finding your blood pressure monitor...");
    }

    try {
      addLog("Starting scan...");
      if (device.type === "BG") {
        await deviceService.startBG5SScan();
      } else {
        await IHealthDevices.startScan([
          "BP3L",
          "BP5",
          "BP5S",
          "HS2S",
          "HS2",
          "HS4S",
        ]);
      }
      addLog("Scan started");
    } catch (e: any) {
      addLog(`Scan error: ${e.message}`);
      Alert.alert("Scan Error", e.message);
      IHealthDevices?.allowSleep?.();
      setBusy(false);
      setPhase("idle");
      return;
    }

    timeoutRef.current = setTimeout(() => {
      addLog("Timeout - no reading received");
      IHealthDevices.stopScan?.().catch(() => {});
      IHealthDevices?.allowSleep?.();
      setBusy(false);
      setPhase("idle");
      setStatusText("");
      Alert.alert(
        "Timeout",
        "No reading was received. Keep the device nearby, make sure it has battery, and try again."
      );
    }, 90000);
  }, [device, addLog, successScale]);

  // Handle daily health check completion — auto-start capture
  const handleHealthCheckComplete = useCallback(
    (data: any) => {
      addLog(
        `Health check completed: headaches=${data.hasHeadaches}, visual=${data.hasVisualDisturbances}`
      );
      setShowHealthCheckModal(false);
      setHealthCheckCompleted(true);

      // Uniform confirmation: same toast pattern as every other data
      // entry in the app.
      showToast({
        message: "Daily health check saved",
        type: "success",
        duration: 2500,
      });

      if (data.hasHeadaches || data.hasVisualDisturbances) {
        addLog("Symptoms reported - care team will be notified");
      }

      // Auto-start capture after health check
      setTimeout(() => {
        startCapture();
      }, 400);
    },
    [addLog, startCapture, showToast]
  );

  // ============================================================================
  // START - Entry point that checks for health check first
  // ============================================================================
  const start = useCallback(async () => {
    try {
      await deviceService.ensureBluetoothReady();
    } catch (error: any) {
      addLog(`Bluetooth not ready: ${error?.message || String(error)}`);
      showBluetoothAlert(error?.status);
      return;
    }

    // Continuation shared by the normal path and the low-battery "Try Anyway".
    const proceed = () => {
      if (device?.type === "BP" && !healthCheckCompleted) {
        addLog("Daily health check required before BP measurement");
        setShowHealthCheckModal(true);
        return;
      }
      startCapture();
    };

    // Warn if the last-known battery (read on the previous connection) is low.
    // Non-blocking: the patient can still try, since a reading may succeed.
    const batt = device?.lastBattery;
    if (typeof batt === "number" && batt >= 0 && batt < LOW_BATTERY_THRESHOLD) {
      const label = device?.friendlyName || device?.name || "device";
      addLog(`Low battery (${batt}%) — prompting to charge`);
      Alert.alert(
        "Charge Your Device",
        `Your ${label} battery is low (${batt}%). Charge it soon for reliable readings. You can still try now.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Try Anyway", onPress: proceed },
        ]
      );
      return;
    }

    proceed();
  }, [device, healthCheckCompleted, addLog, startCapture]);

  const cancel = useCallback(async () => {
    addLog("Cancelled by user");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    targetMacRef.current = "";
    try {
      await IHealthDevices?.stopScan?.();
      await IHealthDevices?.disconnectAll?.();
    } catch (_e) {}
    IHealthDevices?.allowSleep?.();
    setBusy(false);
    setPhase("idle");
    setStatusText("");
  }, [addLog]);

  const done = useCallback(() => {
    IHealthDevices?.allowSleep?.();
    navigation.goBack();
  }, [navigation]);

  const cancelGlucoseTiming = useCallback(() => {
    setShowGlucoseTimingModal(false);
    setPendingGlucoseReading(null);
    readingReceivedRef.current = false;
    setPhase("idle");
    setStatusText("");
  }, []);

  // ==========================================================================
  // Render helpers
  // ==========================================================================

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
        if (device.type === "SCALE") return "Finding your scale...";
        if (device.type === "BG") return "Finding your glucose meter...";
        return "Finding your monitor...";
      case "connect":
        return "Connecting...";
      case "measure":
        if (device.type === "SCALE") return "Stand still...";
        if (device.type === "BG") return "Checking stored readings...";
        return "Keep your arm relaxed...";
      case "success":
        return "Reading saved!";
      default:
        return "Ready to measure";
    }
  };

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case "syncing":
        return "Syncing to care team...";
      case "synced":
        return "✓ Sent to care team";
      case "pending":
        return "Will send when online";
      default:
        return "";
    }
  };

  const isSuccess = phase === "success" && Boolean(lastReading);

  const renderReadingDisplay = () => {
    if (phase === "success" && lastReading) {
      if (device.type === "BP") {
        return (
          <Animated.View
            style={[
              styles.readingContainer,
              isSuccess && styles.readingContainerSuccess,
              { transform: [{ scale: successScale }] },
            ]}
          >
            <View style={styles.bpReading}>
              <Text
                style={[
                  styles.bpValue,
                  isSuccess && styles.bpValueSuccess,
                  lastReading.isHigh && styles.bpValueHigh,
                ]}
              >
                {lastReading.systolic}
              </Text>
              <Text style={[styles.bpSeparator, isSuccess && styles.bpSeparatorSuccess]}>/</Text>
              <Text
                style={[
                  styles.bpValue,
                  isSuccess && styles.bpValueSuccess,
                  lastReading.isHigh && styles.bpValueHigh,
                ]}
              >
                {lastReading.diastolic}
              </Text>
            </View>
            <Text style={[styles.readingUnit, isSuccess && styles.readingUnitSuccess]}>mmHg</Text>
            {lastReading.isHigh && (
              <View style={[styles.highBPBadge, isSuccess && styles.highBPBadgeSuccess]}>
                <MaterialIcons name="warning" size={18} color="#FF5252" />
                <Text style={[styles.highBPText, isSuccess && styles.highBPTextSuccess]}>
                  Above threshold ({bpThresholds?.systolicHigh}/
                  {bpThresholds?.diastolicHigh})
                </Text>
              </View>
            )}
            <View style={[styles.pulseContainer, isSuccess && styles.pulseContainerSuccess]}>
              <MaterialIcons
                name="favorite"
                size={isSuccess ? 16 : 18}
                color={CAPTURE_ACCENT_SOFT}
              />
              <Text style={[styles.pulseText, isSuccess && styles.pulseTextSuccess]}>{lastReading.pulse} bpm</Text>
            </View>
            {syncStatus !== "" && (
              <Text
                style={[
                  styles.syncStatusText,
                  isSuccess && styles.syncStatusTextSuccess,
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
              isSuccess && styles.readingContainerSuccess,
              { transform: [{ scale: successScale }] },
            ]}
          >
            <Text style={[styles.weightValue, isSuccess && styles.weightValueSuccess]}>{lastReading.weight}</Text>
            <Text style={[styles.readingUnit, isSuccess && styles.readingUnitSuccess]}>lbs</Text>
            <Text style={[styles.subReading, isSuccess && styles.subReadingSuccess]}>{lastReading.kg} kg</Text>
            {syncStatus !== "" && (
              <Text
                style={[
                  styles.syncStatusText,
                  isSuccess && styles.syncStatusTextSuccess,
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
              isSuccess && styles.readingContainerSuccess,
              { transform: [{ scale: successScale }] },
            ]}
          >
            <Text style={[styles.weightValue, isSuccess && styles.weightValueSuccess]}>{lastReading.glucose}</Text>
            <Text style={[styles.readingUnit, isSuccess && styles.readingUnitSuccess]}>{lastReading.unit || "mg/dL"}</Text>
            {lastReading.timingLabel ? (
              <Text style={[styles.subReading, isSuccess && styles.subReadingSuccess]}>{lastReading.timingLabel}</Text>
            ) : null}
            {syncStatus !== "" && (
              <Text
                style={[
                  styles.syncStatusText,
                  isSuccess && styles.syncStatusTextSuccess,
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

  const bottomPadding = isSuccess
    ? Math.max(insets.bottom + 12, 22)
    : Math.max(insets.bottom + 72, 96);
  const deviceTypeLabel =
    device.type === "BP"
      ? "Blood Pressure Monitor"
      : device.type === "SCALE"
        ? "Smart Scale"
        : "Glucose Meter";

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={["#1a1a2e", "#16213e", "#0f0f23"]}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <Animated.View
        style={[
          styles.header,
          { opacity: fadeAnim, paddingTop: Math.max(insets.top + 6, 30) },
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
        >
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Capture Reading</Text>
        <View style={styles.headerBtnSpacer} />
      </Animated.View>

      {/* Main Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          isSuccess && styles.scrollContentSuccess,
          { paddingBottom: bottomPadding },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.content,
            isSuccess && styles.contentSuccess,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* Device Visual */}
          <View style={[styles.deviceSection, isSuccess && styles.deviceSectionSuccess]}>
            <Animated.View
              style={[
                styles.deviceRing,
                isSuccess && styles.deviceRingSuccess,
                {
                  borderColor: CAPTURE_ACCENT,
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
                      { backgroundColor: CAPTURE_ACCENT },
                    ]}
                  />
                  <View
                    style={[
                      styles.ringDot,
                      styles.ringDot2,
                      { backgroundColor: CAPTURE_ACCENT_SOFT },
                    ]}
                  />
                </>
              )}
            </Animated.View>

            <View style={[styles.deviceImageContainer, isSuccess && styles.deviceImageContainerSuccess]}>
              <Image
                source={deviceImages[device.type] || deviceImages.BP}
                style={[styles.deviceImage, isSuccess && styles.deviceImageSuccess]}
              />
              {phase === "success" && (
                <>
                  {/* Expanding ring ripple */}
                  <Animated.View
                    style={[
                      styles.successRing,
                      isSuccess && styles.successRingSuccess,
                      {
                        borderColor: CAPTURE_ACCENT,
                        transform: [{ scale: successRingScale }],
                        opacity: successRingOpacity,
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.successBadge,
                      isSuccess && styles.successBadgeSuccess,
                      { backgroundColor: CAPTURE_ACCENT, transform: [{ scale: successScale }] },
                    ]}
                  >
                    <MaterialIcons name="check" size={isSuccess ? 20 : 24} color="#fff" />
                  </Animated.View>
                </>
              )}
            </View>
          </View>

          {/* Device Info */}
          <Text style={[styles.deviceName, isSuccess && styles.deviceNameSuccess]}>{device.name}</Text>
          <Text style={[styles.deviceType, isSuccess && styles.deviceTypeSuccess]}>{deviceTypeLabel}</Text>

          {/* Reading Display or Status */}
          {phase === "success" && lastReading ? (
            <Animated.View style={{ opacity: readingFade }}>
              {renderReadingDisplay()}
            </Animated.View>
          ) : (
            <View style={styles.statusSection}>
              <Text
                style={[
                  styles.statusText,
                  busy ? { color: CAPTURE_ACCENT_SOFT } : styles.statusTextIdle,
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
                    backgroundColor: CAPTURE_ACCENT,
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
          <View style={[styles.buttonContainer, isSuccess && styles.buttonContainerSuccess]}>
            {phase === "idle" && (
              <TouchableOpacity
                onPress={start}
                activeOpacity={0.8}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Capture Reading</Text>
              </TouchableOpacity>
            )}

            {busy && phase !== "success" && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={cancel}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}

            {phase === "success" && (
              <Animated.View style={{ transform: [{ translateY: buttonSlide }], opacity: readingFade }}>
                <TouchableOpacity
                  onPress={done}
                  activeOpacity={0.8}
                  style={[styles.primaryButton, isSuccess && styles.primaryButtonSuccess]}
                >
                  <Text style={styles.primaryButtonText}>Done</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </View>
        </Animated.View>
      </ScrollView>

      {/* Daily Health Check Modal (for BP devices) */}
      <DailyHealthCheckModal
        visible={showHealthCheckModal}
        onComplete={handleHealthCheckComplete}
      />

      <Modal
        visible={showGlucoseTimingModal}
        transparent
        animationType="fade"
        onRequestClose={cancelGlucoseTiming}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.glucoseTimingModal}>
            <Text style={styles.glucoseTimingTitle}>Glucose sample window</Text>
            <Text style={styles.glucoseTimingValue}>
              {pendingGlucoseReading?.value} {pendingGlucoseReading?.unit || "mg/dL"}
            </Text>
            <View style={styles.glucoseTimingGrid}>
              {GLUCOSE_TIMING_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.glucoseTimingOption}
                  onPress={() => saveGlucoseReading(option.value)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.glucoseTimingOptionText}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.glucoseTimingCancel}
              onPress={cancelGlucoseTiming}
              activeOpacity={0.8}
            >
              <Text style={styles.glucoseTimingCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  headerBtnSpacer: {
    width: 44,
    height: 44,
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
  scrollContentSuccess: {
    justifyContent: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  contentSuccess: {
    paddingHorizontal: 20,
    paddingTop: 0,
  },
  deviceSection: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  deviceSectionSuccess: {
    width: 124,
    height: 124,
    marginBottom: 6,
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
  deviceRingSuccess: {
    width: 124,
    height: 124,
    borderRadius: 62,
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
  deviceImageContainerSuccess: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  deviceImage: {
    width: 75,
    height: 75,
    resizeMode: "contain",
  },
  deviceImageSuccess: {
    width: 58,
    height: 58,
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
  successBadgeSuccess: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
  },
  successRing: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
  },
  successRingSuccess: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  deviceName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 2,
    textAlign: "center",
  },
  deviceNameSuccess: {
    fontSize: 18,
  },
  deviceType: {
    fontSize: 13,
    color: "#888",
    marginBottom: 20,
    textAlign: "center",
  },
  deviceTypeSuccess: {
    marginBottom: 8,
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
  statusTextIdle: {
    color: "#888",
  },
  statusSubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  readingContainer: {
    alignItems: "center",
    marginVertical: 10,
  },
  readingContainerSuccess: {
    marginVertical: 0,
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
  bpValueSuccess: {
    fontSize: 52,
  },
  bpValueHigh: {
    color: "#FF5252",
  },
  bpSeparator: {
    fontSize: 48,
    fontWeight: "200",
    color: "#666",
    marginHorizontal: 4,
  },
  bpSeparatorSuccess: {
    fontSize: 38,
  },
  readingUnit: {
    fontSize: 18,
    color: "#888",
    marginTop: 4,
  },
  readingUnitSuccess: {
    fontSize: 15,
    marginTop: 0,
  },
  highBPBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(255, 82, 82, 0.15)",
    borderRadius: 20,
    gap: 6,
  },
  highBPBadgeSuccess: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  highBPText: {
    fontSize: 14,
    color: "#FF8A80",
    fontWeight: "500",
  },
  highBPTextSuccess: {
    fontSize: 12,
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
  pulseContainerSuccess: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pulseText: {
    fontSize: 16,
    color: "#fff",
    marginLeft: 8,
  },
  pulseTextSuccess: {
    fontSize: 14,
  },
  weightValue: {
    fontSize: 72,
    fontWeight: "200",
    color: "#fff",
  },
  weightValueSuccess: {
    fontSize: 56,
  },
  subReading: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
  },
  subReadingSuccess: {
    fontSize: 14,
    marginTop: 4,
  },
  syncStatusText: {
    fontSize: 14,
    color: "#888",
    marginTop: 16,
  },
  syncStatusTextSuccess: {
    fontSize: 13,
    marginTop: 8,
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
    marginTop: 20,
    marginBottom: 10,
  },
  buttonContainerSuccess: {
    marginTop: 10,
    marginBottom: 0,
  },
  primaryButton: {
    width: SCREEN_WIDTH - 48,
    height: 56,
    borderRadius: BTN.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CAPTURE_ACCENT,
  },
  primaryButtonSuccess: {
    height: 50,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  // Red while the capture process is active — clear stop affordance.
  cancelButton: {
    width: SCREEN_WIDTH - 48,
    height: 56,
    borderRadius: BTN.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BTN.destructive,
  },
  cancelButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  glucoseTimingModal: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#152238",
    borderRadius: 8,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  glucoseTimingTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  glucoseTimingValue: {
    color: "#A5D6A7",
    fontSize: 28,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 18,
  },
  glucoseTimingGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  glucoseTimingOption: {
    width: "48%",
    minHeight: 48,
    borderRadius: BTN.radius,
    backgroundColor: "rgba(67,160,71,0.18)",
    borderWidth: 1,
    borderColor: "rgba(165,214,167,0.35)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  glucoseTimingOptionText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  glucoseTimingCancel: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  glucoseTimingCancelText: {
    color: "#b0bec5",
    fontSize: 15,
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
});
