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
import { useSelector, useDispatch, useStore } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
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
import { markDeviceScreenActive } from "../../services/batteryRefreshService";
import { refreshProfile } from "../../services/profileRefreshService";
import { isBPHigh as bpIsHigh, isGlucoseHigh } from "../../utils/thresholdLogic";
import { BTN } from "../../constants/buttons";
import { t, useT, fmtDate, fmtTime, type TKey } from "../../i18n";
import GuideStage, { GuideLinkButton, GUIDE_SUCCESS_SIZE } from "../../guided/GuideStage";
import GuidedAnimation from "../../guided/GuidedAnimation";
import {
  captureGuideFor,
  NOT_FOUND_ANIMATION,
  TRY_AGAIN_ANIMATION,
  type GuideStep,
} from "../../guided/guides";
import type { AnimationName } from "../../guided/animations";

// Below this last-known battery %, warn the user to charge before a reading.
const LOW_BATTERY_THRESHOLD = 20;
// A battery level older than this is treated as unknown, not as current.
const BATTERY_FRESH_MS = 30 * 60 * 1000;

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
  const message = status?.message || t("capture.bluetoothNeededMsg");

  Alert.alert(t("capture.bluetoothNeededTitle"), message, [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.openSettings"), onPress: () => Linking.openSettings() },
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

// `value` is what is saved and synced to the EMR (measurement_condition) —
// never translated. Only the label shown is, through `labelKey`.
const GLUCOSE_TIMING_OPTIONS = [
  { labelKey: "capture.timingOvernight", value: "overnight" },
  { labelKey: "capture.timingBeforeBreakfast", value: "before breakfast" },
  { labelKey: "capture.timingAfterBreakfast", value: "after breakfast" },
  { labelKey: "capture.timingBeforeLunch", value: "before lunch" },
  { labelKey: "capture.timingAfterLunch", value: "after lunch" },
  { labelKey: "capture.timingBeforeDinner", value: "before dinner" },
  { labelKey: "capture.timingAfterDinner", value: "after dinner" },
  { labelKey: "capture.timingBedtime", value: "bedtime" },
] as const;

type GlucoseTimingValue = (typeof GLUCOSE_TIMING_OPTIONS)[number]["value"];

// ---------------------------------------------------------------------------
// Glucose meter time
//
// The BG5S stamps each stored reading with ITS OWN clock and flags the
// readings taken before that clock was set (`canCorrect` — iOS
// BG5SRecordModel.canCorrect, Android DATA_TIME_PROOF; both true = "the
// stamp needs correcting"). Out of the box — and again after a dead battery —
// the clock runs from 2017-01-01, so a flagged reading sits at a fixed
// offset from real time. The app measures that offset whenever it finds the
// meter's clock off (App.tsx → devices.clockOffsetMs) and dates flagged
// readings by adding it. Unflagged readings are used as stamped. Nothing is
// ever dated by import time: a reading is taken, then imported later.
// ---------------------------------------------------------------------------

// Earlier than this cannot be a real reading on any meter in service.
const EARLIEST_PLAUSIBLE_READING_MS = Date.UTC(2025, 0, 1);
// Phone/meter skew tolerated before "in the future" means "wrong".
const FUTURE_SLACK_MS = 15 * 60 * 1000;
// Longest the import waits for the meter to confirm an erase.
const ERASE_TIMEOUT_MS = 6000;

function readingTakenOnUnsetClock(record: any): boolean {
  // Both platforms emit the same flag with the same meaning: true = taken on
  // the unset clock. (Android's DATA_TIME_PROOF is true for exactly the
  // records the SDK's own adjustOfflineData re-dates — it is NOT "time is
  // proven"; reading it that way flagged every good reading as undatable.)
  return record?.canCorrect === true;
}

/**
 * The real time a stored glucose reading was taken, or null when it cannot
 * be dated (flagged, but no offset is known — the meter was set up by a
 * build that did not record one). Never a time in the future or before the
 * program existed.
 */
function datedBGTimestamp(record: any, clockOffsetMs: number | null): number | null {
  const raw = parseBGTimestamp(record);
  if (raw === null) return null;
  const flagged =
    readingTakenOnUnsetClock(record) || raw < EARLIEST_PLAUSIBLE_READING_MS;
  let ts = raw;
  if (flagged) {
    if (clockOffsetMs === null || !Number.isFinite(clockOffsetMs)) return null;
    ts = raw + clockOffsetMs;
  }
  if (ts > Date.now() + FUTURE_SLACK_MS || ts < EARLIEST_PLAUSIBLE_READING_MS) {
    return null;
  }
  return ts;
}

/**
 * The sample window a reading taken at this time most likely belongs to —
 * pre-selected in the prompt so tagging is one tap. The patient can always
 * pick another.
 */
function suggestGlucoseTiming(ts: number): GlucoseTimingValue {
  const d = new Date(ts);
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 5) return "overnight";
  if (h < 9) return "before breakfast";
  if (h < 11) return "after breakfast";
  if (h < 13) return "before lunch";
  if (h < 15) return "after lunch";
  if (h < 18) return "before dinner";
  if (h < 20.5) return "after dinner";
  return "bedtime";
}

function formatReadingTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const time = fmtTime(d, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return t("capture.todayAt", { time });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return t("capture.yesterdayAt", { time });
  const day = fmtDate(d, { weekday: "short", month: "numeric", day: "numeric" });
  return `${day} ${time}`;
}

function getGlucoseTimingLabel(value?: string): string {
  const option = GLUCOSE_TIMING_OPTIONS.find((o) => o.value === value);
  return (option ? t(option.labelKey) : "") || value || "";
}

/**
 * The meter's own stamp on a stored record (epoch ms), or null when the
 * record carries none the app can read. Never "now": a reading the app
 * cannot date is left on the meter, not charted at import time.
 */
function parseBGTimestamp(record: any): number | null {
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

  return null;
}

/**
 * Deterministic id from the meter's own record id, so the same record is
 * recognised on every connection. Falls back to the meter's stamp; never to
 * the current time, which would make every import a new reading.
 */
function buildBGReadingId(deviceId: string, data: any): string {
  const rawId = String(data?.dataID || data?.measureDate || data?.timestamp || "undated");
  const safeId = rawId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `bg_${deviceId || "device"}_${safeId}`;
}

export default function CaptureScreen({ route, navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  // Draw again when the language changes. Text is produced by t() at the
  // moment it is shown (alerts, toasts, render), so no callback caches it.
  useT();
  // Both tab stacks hold a Capture screen; only the one in front owns the
  // native events (see ownsEvent).
  const isFocused = useIsFocused();
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

  // The EMR-resolved thresholds (BP + glucose), last values the EMR sent.
  const thresholds = useSelector((state: RootState) => state.user.thresholds);

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
  // Guided measurement (src/guided)
  //
  // BP3L, HS2S and BG5S get step-by-step animations; every other model gets
  // null here and this screen behaves exactly as before. Steps never advance
  // on a timer: preparation steps wait for the patient's tap, capture steps
  // follow the phase the device events already drive (scan → connect →
  // measure → success). With a guide, a failed capture is explained in place
  // (with a Try again) instead of in an alert.
  // ==========================================================================
  const deviceModel = device?.model;
  const deviceName = device?.name;
  const deviceSource = device?.source;
  const guide = useMemo(
    () => captureGuideFor({ model: deviceModel, name: deviceName, source: deviceSource }),
    [deviceModel, deviceName, deviceSource]
  );
  // Native-event listeners and timers read the guide and phase through refs:
  // their closures outlive a render.
  const guideRef = useRef(guide);
  guideRef.current = guide;
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Preparation steps (before the capture) or the "How to test" walkthrough.
  const [walkthrough, setWalkthrough] = useState<null | {
    mode: "prep" | "tutorial";
    index: number;
  }>(null);
  // Why the last capture stopped, shown in place of an alert (guided only).
  const [failure, setFailure] = useState<null | {
    anim: AnimationName;
    titleKey: TKey;
    messageKey: TKey;
  }>(null);

  // A capture that went wrong. Guided: say so on the screen with the matching
  // picture and a Try again. Not guided: the alert this screen always showed.
  const showCaptureProblem = useCallback(
    (anim: AnimationName, titleKey: TKey, messageKey: TKey) => {
      if (guideRef.current) {
        setFailure({ anim, titleKey, messageKey });
      } else {
        Alert.alert(t(titleKey), t(messageKey));
      }
    },
    []
  );

  // ==========================================================================
  // Glucose import (see "Glucose meter time" above)
  //
  // Every connection to the meter is a full sync: native reads the meter's
  // clock, sets it, and reports both (App.tsx keeps the offset); this screen
  // then pulls EVERY stored reading, dates each one, drops what is already
  // captured, and walks the rest oldest-first through the sample-window
  // prompt — one pre-selected tap each. Once all are saved the meter's
  // memory is erased so nothing is re-delivered or re-dated later. Skipped
  // or cancelled readings stay on the meter and are offered again.
  // ==========================================================================
  const store = useStore<RootState>();

  // The EMR may have changed this patient's thresholds since launch: refresh
  // when this screen opens so the reading about to be taken is judged by
  // the current value. Fire-and-forget; the stored value stands if offline.
  useFocusEffect(
    useCallback(() => {
      refreshProfile(dispatch, store.getState);
    }, [dispatch, store])
  );
  const currentClockOffset = useCallback((): number | null => {
    const d = store.getState().devices.devices.find((x) => x.id === deviceDbId);
    return typeof d?.clockOffsetMs === "number" && Number.isFinite(d.clockOffsetMs)
      ? d.clockOffsetMs
      : null;
  }, [store, deviceDbId]);

  // The readings still to tag in this import, oldest first, each carrying
  // its dated `ts`; the prompt shows the head. Counters drive the summary
  // and decide whether the meter may be erased at the end.
  const glucoseQueueRef = useRef<any[]>([]);
  const glucoseTotalRef = useRef(0);
  const glucoseImportedRef = useRef(0);
  const glucoseLeftOnMeterRef = useRef(0);
  const glucoseMacRef = useRef<string>("");
  const lastSavedGlucoseRef = useRef<any | null>(null);
  // Android delivers stored records one event at a time, then says how
  // many it sent; they are collected here until that batch-complete event.
  const androidBGBatchRef = useRef<any[]>([]);

  // A save in flight: the prompt's buttons are ignored until it settles, so
  // a double tap cannot save the same reading twice or skip the next one.
  const glucoseSavingRef = useRef(false);

  // Stop the capture and explain. Same teardown as the other dead ends.
  // busyRef is cleared directly (not only via state) so the disconnect this
  // triggers is never read as an "unexpected disconnect".
  const endCaptureWithAlert = useCallback((title: string, message: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    busyRef.current = false;
    IHealthDevices?.stopScan?.().catch(() => {});
    IHealthDevices?.disconnectAll?.().catch(() => {});
    IHealthDevices?.allowSleep?.();
    targetMacRef.current = "";
    setBusy(false);
    setPhase("idle");
    setStatusText("");
    Alert.alert(title, message);
  }, []);


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

  // High = at or above the EMR-resolved threshold. No local fallback: the
  // store always holds the last values the EMR sent (utils/thresholdLogic).
  const isBPHigh = useCallback(
    (systolic: number, diastolic: number) => bpIsHigh(systolic, diastolic, thresholds),
    [thresholds]
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
    setWalkthrough(null);
    setFailure(null);

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

  // While this screen is in front the iHealth SDK is ours: no startup /
  // foreground battery refresh may scan or connect (it would collide with
  // the capture, or read a battery-only connect as an unexpected disconnect).
  useFocusEffect(
    useCallback(() => {
      markDeviceScreenActive(true);
      return () => markDeviceScreenActive(false);
    }, [])
  );

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
        // The screen is blurred (isFocused is false by the time the event
        // lands), but clear busy too so the teardown's DISCONNECTED event
        // can never be mistaken for a failed capture.
        busyRef.current = false;
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
        setStatusText(t("capture.statusDeviceFound"));

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

        // Only the capture screen in front, mid-capture, for its own device.
        // A connect from the background battery refresh or the other tab's
        // capture is not ours to act on (and a "disconnect" from it must not
        // be reported as this capture failing).
        if (!isFocused || !busyRef.current) return;
        if (
          targetMacRef.current &&
          data.mac &&
          String(data.mac).toUpperCase() !== targetMacRef.current.toUpperCase()
        ) {
          return;
        }

        if (data.connected) {
          if (device?.type === "BG") {
            // iOS: the BG5S effect below sets the clock and pulls the records.
            // Android: native does both on connect and delivers the records
            // through onBloodGlucoseReading, then onGlucoseMeterEvent
            // "offline_synced" once the batch is complete.
            androidBGBatchRef.current = [];
            glucoseMacRef.current = String(data.mac || "");
            setPhase("measure");
            setStatusText(t("capture.checkingStoredReadings"));
            return;
          }

          setPhase("measure");
          if (device?.type === "SCALE") {
            setStatusText(t("capture.stepOnScale"));
          } else {
            setStatusText(t("capture.bpMeasurementStarted"));
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
          showCaptureProblem(
            TRY_AGAIN_ANIMATION,
            "capture.disconnectedTitle",
            "capture.disconnectedMsg"
          );
        }
        // If readingReceivedRef.current is true, this is an expected
        // disconnect after a successful save — ignore it.
      }
    );
    return () => sub.remove();
  }, [addLog, device, isFocused, showCaptureProblem]);

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
          `BP reading is HIGH (threshold: ${thresholds.systolicHigh}/${thresholds.diastolicHigh})`
        );
      }

      try {
        await dispatch(
          addReadingAndPersist({
            type: "BP",
            deviceId: device?.id || "",
            // Prefer the patient's label. History resolves this live from the
            // device record, so this stored copy only surfaces once the device
            // has been deleted — it should still read sensibly then.
            deviceName: device?.friendlyName || device?.name || "BP Monitor",
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
          message: t("capture.saveFailed"),
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
      thresholds,
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
            deviceName: device?.friendlyName || device?.name || "Scale",
            value: lbs,
            unit: "lbs",
          })
        ).unwrap();
      } catch (err) {
        console.error("[Capture] Failed to save weight reading:", err);
        setBusy(false);
        setStatusText("");
        showToast({
          message: t("capture.saveFailed"),
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

  // Shared teardown once an import is over (all tagged, cancelled, or
  // nothing to import). `lastSaved` drives the success view.
  const endGlucoseImport = useCallback(
    async (lastSaved: any | null) => {
      const imported = glucoseImportedRef.current;
      const leftOnMeter = glucoseLeftOnMeterRef.current;
      const mac = glucoseMacRef.current;

      setShowGlucoseTimingModal(false);
      setPendingGlucoseReading(null);
      glucoseQueueRef.current = [];
      setStatusText(imported > 0 ? t("capture.finishingImport") : "");

      // Erase the meter only when everything it held is now safely in the
      // app. If anything was skipped or cancelled, leave the memory alone —
      // deterministic reading ids keep the saved ones from re-importing, and
      // the rest are offered again next time. Bounded: a meter that has gone
      // to sleep mid-prompt must not leave this screen waiting forever.
      if (imported > 0 && leftOnMeter === 0 && mac) {
        const erased = await Promise.race([
          deviceService.deleteDeviceRecords(mac, "BG5S"),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ERASE_TIMEOUT_MS)),
        ]);
        addLog(
          erased
            ? "Meter memory erased after import"
            : "Meter memory not erased (meter asleep?) — ids will dedup next time"
        );
      }

      busyRef.current = false;
      IHealthDevices?.stopScan?.().catch(() => {});
      IHealthDevices?.disconnectAll?.().catch(() => {});
      IHealthDevices?.allowSleep?.();
      targetMacRef.current = "";

      if (lastSaved) {
        setLastReading({
          glucose: lastSaved.value,
          // Same test the EMR applies, against the threshold it resolved.
          isHigh: isGlucoseHigh(Number(lastSaved.value), thresholds),
          unit: lastSaved.unit,
          timing: lastSaved.timing,
          timingLabel: getGlucoseTimingLabel(lastSaved.timing),
          takenAt: lastSaved.ts,
          importedCount: imported,
        });
        setStatusText(`${lastSaved.value} ${lastSaved.unit}`);
        setBusy(false);
        playSuccessAnimation();
        if (imported > 1) {
          showToast({
            message: t("capture.readingsImported", { count: imported }),
            type: "success",
            duration: 3000,
          });
        }
        syncToEMR();
      } else {
        readingReceivedRef.current = false;
        setBusy(false);
        setPhase("idle");
        setStatusText("");
      }
    },
    [addLog, playSuccessAnimation, showToast, syncToEMR, thresholds]
  );

  // Show the prompt for the head of the queue.
  const promptNextGlucoseReading = useCallback(() => {
    const next = glucoseQueueRef.current[0];
    if (!next) return;
    setPendingGlucoseReading(next);
    setBusy(false);
    setStatusText(t("capture.selectSampleWindow"));
    setShowGlucoseTimingModal(true);
  }, []);

  /**
   * Entry point for every stored-record batch the meter hands over (iOS:
   * the pull below; Android: the buffered onBloodGlucoseReading events).
   * Dates, dedups, orders, then starts the prompt loop.
   */
  const beginGlucoseImport = useCallback(
    (records: any[], mac: string) => {
      if (readingReceivedRef.current) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      glucoseMacRef.current = mac || glucoseMacRef.current;

      const offset = currentClockOffset();
      const deviceIdForReading = deviceDbId || "";
      const usable: any[] = [];
      let undatable = 0;
      let alreadyCaptured = 0;

      for (const rec of records) {
        const value = Number(rec?.value);
        if (!Number.isFinite(value) || value <= 0) continue;
        const ts = datedBGTimestamp(rec, offset);
        if (ts === null) {
          undatable += 1;
          addLog(
            `BG5S record ${rec?.dataID || "?"} could not be dated (flagged, offset ${offset ?? "unknown"}) — left on meter`
          );
          continue;
        }
        // Deterministic id from the meter's own record id: an id hit means
        // this exact record was already captured — don't re-prompt, don't
        // re-save (a re-save would reset the synced flag).
        const id = buildBGReadingId(deviceIdForReading, { ...rec, timestamp: ts });
        if (readingExists(id)) {
          alreadyCaptured += 1;
          continue;
        }
        usable.push({ ...rec, ts, id, value, unit: rec?.unit || "mg/dL" });
      }

      usable.sort((a, b) => a.ts - b.ts);
      addLog(
        `BG5S import: ${records.length} on meter, ${usable.length} new, ${alreadyCaptured} already captured, ${undatable} undatable`
      );

      if (usable.length === 0) {
        // Nothing to tag. Say why, then stand down.
        readingReceivedRef.current = false;
        glucoseImportedRef.current = 0;
        glucoseLeftOnMeterRef.current = undatable;
        if (undatable > 0) {
          endCaptureWithAlert(
            t("capture.meterClockUnknownTitle"),
            t("capture.meterClockUnknownMsg")
          );
        } else if (alreadyCaptured > 0) {
          endCaptureWithAlert(t("capture.noNewReadingsTitle"), t("capture.noNewReadingsMsg"));
        } else {
          endCaptureWithAlert(
            t("capture.noGlucoseReadingTitle"),
            t("capture.noGlucoseReadingMsg")
          );
        }
        return;
      }

      readingReceivedRef.current = true;
      glucoseQueueRef.current = usable;
      glucoseTotalRef.current = usable.length;
      glucoseImportedRef.current = 0;
      glucoseLeftOnMeterRef.current = undatable;
      lastSavedGlucoseRef.current = null;
      // Keep the link up: the meter is erased once everything is tagged.
      IHealthDevices?.stopScan?.().catch(() => {});
      promptNextGlucoseReading();
    },
    [addLog, currentClockOffset, deviceDbId, endCaptureWithAlert, promptNextGlucoseReading]
  );

  // Save the reading being shown with the chosen window, then move on.
  const saveGlucoseReading = useCallback(
    async (timing: GlucoseTimingValue) => {
      const data = pendingGlucoseReading;
      if (!data || glucoseSavingRef.current) return;
      glucoseSavingRef.current = true;

      try {
        await dispatch(
          addReadingAndPersist({
            id: data.id,
            ts: data.ts,
            type: "BG",
            deviceId: deviceDbId || "",
            deviceName: device?.friendlyName || device?.name || "Glucose Meter",
            value: data.value,
            unit: data.unit,
            measurementCondition: timing,
          })
        ).unwrap();
      } catch (err) {
        console.error("[Capture] Failed to save glucose reading:", err);
        glucoseSavingRef.current = false;
        showToast({
          message: t("capture.saveGlucoseFailed"),
          type: "error",
          duration: 4000,
        });
        return; // Prompt stays up; the patient can retry the tap.
      }

      glucoseImportedRef.current += 1;
      lastSavedGlucoseRef.current = { ...data, timing };
      glucoseQueueRef.current = glucoseQueueRef.current.slice(1);
      glucoseSavingRef.current = false;
      if (glucoseQueueRef.current.length > 0) {
        promptNextGlucoseReading();
        return;
      }
      await endGlucoseImport(lastSavedGlucoseRef.current);
    },
    [
      device,
      deviceDbId,
      dispatch,
      endGlucoseImport,
      pendingGlucoseReading,
      promptNextGlucoseReading,
      showToast,
    ]
  );

  // Leave this reading on the meter and move on.
  const skipGlucoseReading = useCallback(async () => {
    if (!pendingGlucoseReading || glucoseSavingRef.current) return;
    glucoseLeftOnMeterRef.current += 1;
    glucoseQueueRef.current = glucoseQueueRef.current.slice(1);
    if (glucoseQueueRef.current.length > 0) {
      promptNextGlucoseReading();
      return;
    }
    // Nothing else to tag. Success view only if something was saved.
    await endGlucoseImport(
      glucoseImportedRef.current > 0 ? lastSavedGlucoseRef.current : null
    );
  }, [endGlucoseImport, pendingGlucoseReading, promptNextGlucoseReading]);

  // BG5S capture uses the working debug path: connect, pull stored records,
  // then ask for the sample window before saving and syncing.
  //
  // iOS only: this pull path calls debugBG5SGetOfflineData, which doesn't exist on
  // Android. On Android the native module auto-pulls stored records on connect and
  // delivers them via onBloodGlucoseReading (handled by the reading listener below),
  // so running this here would just throw "offline data API not available".
  useEffect(() => {
    if (!emitter || deviceType !== "BG") return;
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
      if (!isFocused || !data.connected || !busyRef.current || readingReceivedRef.current) return;
      const targetMac = targetMacRef.current;
      if (
        targetMac &&
        data.mac &&
        data.mac.toUpperCase() !== targetMac.toUpperCase()
      ) {
        return;
      }

      setPhase("measure");
      setStatusText(t("capture.checkingStoredReadings"));
      addLog("BG5S connected; reading its clock, setting it, then pulling stored records");

      try {
        // Every visit: read the meter's clock, set it. Native reports both
        // (onDeviceClockSet) and App.tsx keeps the offset when the clock was
        // found off — out of the box, or reset by a dead battery — which is
        // what dates the readings the meter flags as taken on the unset clock.
        // Must complete BEFORE the pull so the offset is in the store.
        const clockOk = await deviceService.setDeviceClock(data.mac, "BG5S", false);
        if (!clockOk) {
          addLog("BG5S clock could not be set this visit; importing with the last known offset");
        }

        const payload = await readStoredBG5SData(data.mac);
        const records: any[] = Array.isArray(payload?.records) ? payload.records : [];
        beginGlucoseImport(
          records.map((r) => ({ ...r, mac: data.mac, type: "BG5S", source: "iHealthSDK" })),
          data.mac
        );
      } catch (e: any) {
        addLog(`BG5S stored read error: ${e?.message || String(e)}`);
        IHealthDevices?.stopScan?.().catch(() => {});
        IHealthDevices?.disconnectAll?.().catch(() => {});
        IHealthDevices?.allowSleep?.();
        targetMacRef.current = "";
        setBusy(false);
        setPhase("idle");
        setStatusText("");
        Alert.alert(t("capture.glucoseReadErrorTitle"), t("capture.glucoseReadErrorMsg"));
      }
    });

    return () => sub.remove();
  }, [addLog, deviceType, beginGlucoseImport, isFocused]);

  // Native events are broadcast to every mounted listener. A reading (or a
  // glucose record, or an error) belongs to THIS screen only when this
  // screen is in front, is in the middle of a capture, and the event comes
  // from the device it is capturing. Anything else — a reading for the
  // other capture screen, a battery-only connect from the background
  // refresh, a stray emission after the capture ended — is ignored, never
  // saved under this screen's device, and never allowed to tear down
  // someone else's connection.
  const ownsEvent = useCallback(
    (mac: unknown): boolean => {
      if (!isFocused || !busyRef.current || readingReceivedRef.current) return false;
      const target = targetMacRef.current;
      if (!target) return false;
      if (typeof mac !== "string" || !mac) return true; // event without an address
      return mac.toUpperCase() === target.toUpperCase();
    },
    [isFocused]
  );

  // Listen for readings
  useEffect(() => {
    if (!emitter) return;

    const subs = [
      emitter.addListener("onBloodPressureReading", (data: any) => {
        if (!ownsEvent(data?.mac)) return;
        addLog(`BP: ${data.systolic}/${data.diastolic} pulse=${data.pulse}`);
        saveBPReading(data);
      }),
      emitter.addListener("onWeightReading", (data: any) => {
        if (!ownsEvent(data?.mac)) return;
        addLog(`Weight: ${data.weight} ${data.unit}`);
        saveWeightReading(data);
      }),
      emitter.addListener("onBloodGlucoseReading", (data: any) => {
        if (device?.type !== "BG" || !ownsEvent(data?.mac)) return;
        if (Platform.OS !== "android") return; // iOS pulls the batch itself
        // Android delivers the meter's stored records one event at a time,
        // each with the meter's timestamp and its time-proof flag. Collect
        // them; the import starts on the batch-complete event below.
        androidBGBatchRef.current.push(data);
        addLog(`BG: buffered ${data.value} ${data.unit || "mg/dL"} (canCorrect=${String(data.canCorrect)})`);
      }),
      emitter.addListener("onGlucoseMeterEvent", (data: any) => {
        if (device?.type !== "BG") return;
        if (Platform.OS !== "android") return;
        if (data?.stage !== "offline_synced" || !ownsEvent(data?.mac)) return;
        const batch = androidBGBatchRef.current;
        androidBGBatchRef.current = [];
        beginGlucoseImport(batch, String(data.mac || glucoseMacRef.current));
      }),
      emitter.addListener("onBatteryLevel", (data: any) => {
        if (typeof data?.level === "number" && data?.mac) {
          addLog(`Battery: ${data.level}% (${data.type || "?"})`);
          dispatch(setDeviceBattery({ mac: data.mac, battery: data.level }));
          // Live level from the device we just connected to. This is the
          // reading the pre-scan warning defers to when its own level is
          // stale: say so now, without interrupting the measurement.
          if (ownsEvent(data.mac) && data.level < LOW_BATTERY_THRESHOLD) {
            showToast({
              message: t("capture.batteryLowToast", {
                level: data.level,
                device: device?.friendlyName || device?.name || t("capture.deviceFallback"),
              }),
              type: "info",
              duration: 5000,
            });
          }
        }
      }),
      emitter.addListener("onError", (data: any) => {
        const msg = data.message || JSON.stringify(data);
        addLog(`Error: ${msg}`);
        const code = String(data.code || data.state || "");

        // If THIS screen is actively trying to capture, reset and tell the user.
        // A blurred capture screen must not tear down another screen's link.
        if (isFocused && busyRef.current && !readingReceivedRef.current) {
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
            showCaptureProblem(
              TRY_AGAIN_ANIMATION,
              "capture.deviceErrorTitle",
              "capture.deviceErrorMsg"
            );
          }
        }
      }),
    ];

    return () => subs.forEach((s) => s.remove());
  }, [addLog, device, saveBPReading, saveWeightReading, beginGlucoseImport, dispatch, showToast, ownsEvent, isFocused, showCaptureProblem]);

  // ============================================================================
  // START CAPTURE
  // ============================================================================
  const startCapture = useCallback(async () => {
    if (!device) {
      Alert.alert(t("common.error"), t("capture.deviceNotFound"));
      return;
    }
    if (!IHealthDevices || !emitter) {
      Alert.alert(t("common.error"), t("capture.nativeModuleMissing"));
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

    setFailure(null);
    setBusy(true);
    setLastReading(null);
    setSyncStatus("");
    successScale.setValue(0);
    readingReceivedRef.current = false;

    const mac = device.mac || device.id;
    targetMacRef.current = mac;
    addLog(`Starting for ${device.name}, MAC: ${mac}, Model: ${device.model}`);

    setPhase("auth");
    setStatusText(t("capture.initializing"));

    try {
      await IHealthDevices.authenticate("license.pem");
      addLog("Authenticated");
    } catch (e: any) {
      addLog(`Auth note: ${e.message}`);
    }

    setPhase("scan");
    if (device.type === "SCALE") {
      setStatusText(t("capture.findScale"));
    } else if (device.type === "BG") {
      setStatusText(t("capture.findGlucoseMeter"));
    } else {
      setStatusText(t("capture.findBPMonitor"));
    }

    try {
      addLog("Starting scan...");
      if (device.type === "BG") {
        await deviceService.startBG5SScan();
      } else {
        // Android's iHealth SDK reports one model at a time, so the scan takes
        // turns. A scale stepped on during the cuffs' turns was reported 9 s
        // late (2026-10-28 phone log), after the weigh-in was over. Capturing
        // a known device, Android listens for its model only. iOS listens
        // for every model at once.
        const models = ["BP3L", "BP5", "BP5S", "HS2S", "HS2", "HS4S"];
        const own = Platform.OS === "android" && device.model && models.includes(device.model)
          ? [device.model]
          : models;
        await IHealthDevices.startScan(own);
      }
      addLog("Scan started");
    } catch (e: any) {
      addLog(`Scan error: ${e.message}`);
      Alert.alert(t("capture.scanErrorTitle"), e.message);
      IHealthDevices?.allowSleep?.();
      setBusy(false);
      setPhase("idle");
      return;
    }

    timeoutRef.current = setTimeout(() => {
      addLog("Timeout - no reading received");
      // Never found (still scanning) is a different problem from found but no
      // reading; the guided screen shows the matching help picture.
      const neverFound = phaseRef.current === "auth" || phaseRef.current === "scan";
      IHealthDevices.stopScan?.().catch(() => {});
      IHealthDevices?.allowSleep?.();
      setBusy(false);
      setPhase("idle");
      setStatusText("");
      if (guideRef.current) {
        setFailure(
          neverFound
            ? {
                anim: NOT_FOUND_ANIMATION,
                titleKey: "guide.notFoundTitle",
                messageKey: "capture.timeoutMsg",
              }
            : {
                anim: TRY_AGAIN_ANIMATION,
                titleKey: "guide.noReadingTitle",
                messageKey: "capture.timeoutMsg",
              }
        );
      } else {
        Alert.alert(t("capture.timeoutTitle"), t("capture.timeoutMsg"));
      }
    }, 90000);
  }, [device, addLog, successScale]);

  // After the health check (BP) and battery warning: a guided device first
  // shows its preparation steps; the last one starts the capture. Otherwise
  // the capture starts straight away, as it always has.
  const beginMeasurement = useCallback(() => {
    if (guideRef.current && guideRef.current.prep.length > 0) {
      setFailure(null);
      setWalkthrough({ mode: "prep", index: 0 });
      return;
    }
    startCapture();
  }, [startCapture]);

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
        message: t("capture.healthCheckSaved"),
        type: "success",
        duration: 2500,
      });

      if (data.hasHeadaches || data.hasVisualDisturbances) {
        addLog("Symptoms reported - care team will be notified");
      }

      // Auto-start capture after health check (preparation steps first, when
      // the device has a guide)
      setTimeout(() => {
        beginMeasurement();
      }, 400);
    },
    [addLog, beginMeasurement, showToast]
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
      beginMeasurement();
    };

    // Warn before scanning only when the last-known battery is low AND
    // recent. A level read last night says nothing about a monitor that was
    // charged overnight — that stale warning made a patient "Try Anyway" on
    // a full device. An old reading is treated as unknown: the capture
    // proceeds, the connect reads the battery live, and the listener below
    // warns then if it really is low. The startup/foreground battery
    // refresh keeps this fresh for devices that are awake.
    const batt = device?.lastBattery;
    const battAt = device?.lastBatteryAt;
    const battFresh =
      typeof battAt === "number" && Date.now() - battAt < BATTERY_FRESH_MS;
    if (
      battFresh &&
      typeof batt === "number" &&
      batt >= 0 &&
      batt < LOW_BATTERY_THRESHOLD
    ) {
      const label = device?.friendlyName || device?.name || t("capture.deviceFallback");
      addLog(`Low battery (${batt}%) — prompting to charge`);
      Alert.alert(
        t("capture.chargeTitle"),
        t("capture.chargeMsg", { device: label, level: batt }),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("capture.tryAnyway"), onPress: proceed },
        ]
      );
      return;
    }

    proceed();
  }, [device, healthCheckCompleted, addLog, beginMeasurement]);

  const cancel = useCallback(async () => {
    addLog("Cancelled by user");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    targetMacRef.current = "";
    // Cleared directly, before the disconnect below: its DISCONNECTED event
    // would otherwise be read as the capture failing (busyRef only follows
    // state after the next render, but the event can arrive first now that
    // Android disconnects for real).
    busyRef.current = false;
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

  // ==========================================================================
  // Guided steps: Next / Skip / Try again
  //
  // The handlers read and clear refs before state so a quick double tap can
  // never start two captures (state only catches up on the next render).
  // ==========================================================================
  const walkthroughRef = useRef(walkthrough);
  walkthroughRef.current = walkthrough;
  const failureRef = useRef(failure);
  failureRef.current = failure;

  // Leave the walkthrough: preparation → the capture; "How to test" → the
  // usual import, through start() so Bluetooth and battery are checked.
  const finishWalkthrough = useCallback(() => {
    const w = walkthroughRef.current;
    if (!w) return;
    walkthroughRef.current = null;
    setWalkthrough(null);
    if (w.mode === "prep") startCapture();
    else start();
  }, [startCapture, start]);

  const nextWalkStep = useCallback(() => {
    const w = walkthroughRef.current;
    const g = guideRef.current;
    if (!w || !g) return;
    const steps = w.mode === "prep" ? g.prep : g.tutorial;
    if (w.index >= steps.length - 1) {
      finishWalkthrough();
      return;
    }
    const next = { ...w, index: w.index + 1 };
    walkthroughRef.current = next;
    setWalkthrough(next);
  }, [finishWalkthrough]);

  const closeWalkthrough = useCallback(() => {
    walkthroughRef.current = null;
    setWalkthrough(null);
  }, []);

  const openTutorial = useCallback(() => {
    if (!guideRef.current?.tutorial.length) return;
    setFailure(null);
    setWalkthrough({ mode: "tutorial", index: 0 });
  }, []);

  // Straight back to the capture: preparation is already done.
  const retryCapture = useCallback(() => {
    if (!failureRef.current) return;
    failureRef.current = null;
    setFailure(null);
    startCapture();
  }, [startCapture]);

  const dismissFailure = useCallback(() => {
    failureRef.current = null;
    setFailure(null);
  }, []);

  // Stop the import. Untagged readings stay on the meter (memory is not
  // erased) and are offered again next time; anything already tagged is
  // kept and synced.
  const cancelGlucoseTiming = useCallback(() => {
    if (glucoseSavingRef.current) return;
    glucoseLeftOnMeterRef.current += glucoseQueueRef.current.length;
    endGlucoseImport(
      glucoseImportedRef.current > 0 ? lastSavedGlucoseRef.current : null
    );
  }, [endGlucoseImport]);

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
          <Text style={styles.errorText}>{t("capture.deviceNotFound")}</Text>
          <TouchableOpacity
            style={styles.backButtonAlt}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>{t("capture.goBack")}</Text>
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
        return t("capture.initializing");
      case "scan":
        if (device.type === "SCALE") return t("capture.findScale");
        if (device.type === "BG") return t("capture.findGlucoseMeter");
        return t("capture.findMonitor");
      case "connect":
        return t("capture.connecting");
      case "measure":
        if (device.type === "SCALE") return t("capture.standStill");
        if (device.type === "BG") return t("capture.checkingStoredReadings");
        return t("capture.keepArmRelaxed");
      case "success":
        return t("capture.readingSaved");
      default:
        return t("capture.readyToMeasure");
    }
  };

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case "syncing":
        return t("capture.syncing");
      case "synced":
        return t("capture.synced");
      case "pending":
        return t("capture.pending");
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
                  {t("capture.aboveThresholdBP", {
                    systolic: thresholds.systolicHigh,
                    diastolic: thresholds.diastolicHigh,
                  })}
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
            <Text
              style={[
                styles.weightValue,
                isSuccess && styles.weightValueSuccess,
                lastReading.isHigh && styles.bpValueHigh,
              ]}
            >
              {lastReading.glucose}
            </Text>
            <Text style={[styles.readingUnit, isSuccess && styles.readingUnitSuccess]}>{lastReading.unit || "mg/dL"}</Text>
            {lastReading.isHigh && (
              <View style={[styles.highBPBadge, isSuccess && styles.highBPBadgeSuccess]}>
                <MaterialIcons name="warning" size={18} color="#FF5252" />
                <Text style={[styles.highBPText, isSuccess && styles.highBPTextSuccess]}>
                  {t("capture.aboveThresholdGlucose", { high: thresholds.glucoseHigh })}
                </Text>
              </View>
            )}
            {lastReading.timingLabel ? (
              <Text style={[styles.subReading, isSuccess && styles.subReadingSuccess]}>
                {getGlucoseTimingLabel(lastReading.timing)}
                {typeof lastReading.takenAt === "number"
                  ? ` · ${formatReadingTime(lastReading.takenAt)}`
                  : ""}
              </Text>
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
      ? t("capture.typeBPMonitor")
      : device.type === "SCALE"
        ? t("capture.typeSmartScale")
        : t("capture.typeGlucoseMeter");

  // ---- Guided view (src/guided). All null for a device without a guide. ----
  const walkSteps: GuideStep[] =
    walkthrough && guide ? (walkthrough.mode === "prep" ? guide.prep : guide.tutorial) : [];
  const walkStep = walkthrough ? walkSteps[walkthrough.index] : undefined;
  const walkIsLast = walkthrough ? walkthrough.index >= walkSteps.length - 1 : false;
  // The capture's own phases pick the picture; the device events drive them.
  const phaseStep: GuideStep | null =
    guide && phase !== "idle" && phase !== "success"
      ? phase === "measure"
        ? guide.measure
        : phase === "connect"
          ? guide.connect
          : guide.scan
      : null;
  const failureShown = guide && phase === "idle" && !walkStep ? failure : null;

  const progressBar =
    busy && phase !== "success" ? (
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
    ) : null;

  const cancelButton =
    busy && phase !== "success" ? (
      <TouchableOpacity style={styles.cancelButton} onPress={cancel} activeOpacity={0.8}>
        <Text style={styles.cancelButtonText}>{t("common.cancel")}</Text>
      </TouchableOpacity>
    ) : null;

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
        <Text style={styles.headerTitle}>{t("capture.captureReading")}</Text>
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
          {walkStep && walkthrough ? (
            // Preparation steps, or the "How to test" walkthrough: the patient
            // moves on with the buttons.
            <>
              <GuideStage
                anim={walkStep.anim}
                title={t(walkStep.title)}
                body={t(walkStep.body)}
                stepLabel={t("guide.stepOf", {
                  n: walkthrough.index + 1,
                  total: walkSteps.length,
                })}
              />
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  onPress={nextWalkStep}
                  activeOpacity={0.8}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>
                    {!walkIsLast
                      ? t("common.next")
                      : walkthrough.mode === "prep"
                        ? t("guide.startMeasuring")
                        : t("guide.importReading")}
                  </Text>
                </TouchableOpacity>
                {walkthrough.mode === "prep" ? (
                  !walkIsLast ? (
                    <GuideLinkButton label={t("guide.skipToMeasure")} onPress={finishWalkthrough} />
                  ) : null
                ) : (
                  <GuideLinkButton label={t("common.close")} onPress={closeWalkthrough} />
                )}
              </View>
            </>
          ) : failureShown ? (
            // The capture stopped: why, with the matching help picture.
            <>
              <GuideStage
                anim={failureShown.anim}
                title={t(failureShown.titleKey)}
                body={t(failureShown.messageKey)}
              />
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  onPress={retryCapture}
                  activeOpacity={0.8}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>{t("common.retry")}</Text>
                </TouchableOpacity>
                <GuideLinkButton label={t("common.cancel")} onPress={dismissFailure} />
              </View>
            </>
          ) : phaseStep ? (
            // Capturing: the picture for the phase the device is in.
            <>
              <GuideStage anim={phaseStep.anim} title={t(phaseStep.title)} body={t(phaseStep.body)} />
              {progressBar}
              <View style={styles.buttonContainer}>{cancelButton}</View>
            </>
          ) : (
          <>
          {/* Device Visual — a guided device shows its finishing animation
              above the saved reading instead */}
          {phase === "success" && guide ? (
            <GuidedAnimation
              name={guide.success}
              size={GUIDE_SUCCESS_SIZE}
              style={styles.guideSuccessCard}
            />
          ) : (
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
          )}

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
          {progressBar}

          {/* Action Buttons */}
          <View style={[styles.buttonContainer, isSuccess && styles.buttonContainerSuccess]}>
            {phase === "idle" && (
              <TouchableOpacity
                onPress={start}
                activeOpacity={0.8}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>{t("capture.captureReading")}</Text>
              </TouchableOpacity>
            )}

            {/* Glucose meter: the optional step-by-step "How to test" */}
            {phase === "idle" && guide && guide.tutorial.length > 0 ? (
              <GuideLinkButton label={t("guide.howToTest")} onPress={openTutorial} />
            ) : null}

            {cancelButton}

            {phase === "success" && (
              <Animated.View style={{ transform: [{ translateY: buttonSlide }], opacity: readingFade }}>
                <TouchableOpacity
                  onPress={done}
                  activeOpacity={0.8}
                  style={[styles.primaryButton, isSuccess && styles.primaryButtonSuccess]}
                >
                  <Text style={styles.primaryButtonText}>{t("common.done")}</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </View>
          </>
          )}
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
            <Text style={styles.glucoseTimingTitle}>
              {glucoseTotalRef.current > 1
                ? t("capture.glucoseWhenNofM", {
                    n: glucoseTotalRef.current - glucoseQueueRef.current.length + 1,
                    total: glucoseTotalRef.current,
                  })
                : t("capture.glucoseWhenOne")}
            </Text>
            <Text style={styles.glucoseTimingValue}>
              {pendingGlucoseReading?.value} {pendingGlucoseReading?.unit || "mg/dL"}
            </Text>
            {typeof pendingGlucoseReading?.ts === "number" && (
              <Text style={styles.glucoseTimingWhen}>
                {formatReadingTime(pendingGlucoseReading.ts)}
              </Text>
            )}
            <View style={styles.glucoseTimingGrid}>
              {GLUCOSE_TIMING_OPTIONS.map((option) => {
                // The likely window for the time the meter recorded is
                // highlighted so tagging is one tap; any other is a tap too.
                const suggested =
                  typeof pendingGlucoseReading?.ts === "number" &&
                  suggestGlucoseTiming(pendingGlucoseReading.ts) === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.glucoseTimingOption,
                      suggested && styles.glucoseTimingOptionSuggested,
                    ]}
                    onPress={() => saveGlucoseReading(option.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.glucoseTimingOptionText}>
                      {t(option.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.glucoseTimingFooter}>
              <TouchableOpacity
                style={styles.glucoseTimingCancel}
                onPress={skipGlucoseReading}
                activeOpacity={0.8}
              >
                <Text style={styles.glucoseTimingCancelText}>{t("capture.skipThisOne")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.glucoseTimingCancel}
                onPress={cancelGlucoseTiming}
                activeOpacity={0.8}
              >
                <Text style={styles.glucoseTimingCancelText}>{t("capture.stop")}</Text>
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
  // Guided devices: the finishing animation above the saved reading.
  guideSuccessCard: {
    marginBottom: 10,
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
    marginBottom: 4,
  },
  glucoseTimingWhen: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 14,
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
  glucoseTimingOptionSuggested: {
    backgroundColor: "rgba(67,160,71,0.55)",
    borderColor: "#A5D6A7",
    borderWidth: 2,
  },
  glucoseTimingFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 8,
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
