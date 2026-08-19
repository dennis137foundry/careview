/**
 * BleCaptureScreen.tsx
 *
 * Capture flow for GENERIC BLE devices only — currently the A&D UA-651BLE and
 * anything else speaking the standard Bluetooth Blood Pressure Profile.
 *
 * This is a deliberately separate screen from CaptureScreen.tsx, which handles
 * iHealth SDK devices. They are not variants of one flow; the two device
 * families work in opposite directions:
 *
 *   iHealth  — the app drives. Scan, connect, command a measurement, read back.
 *   Generic  — the device drives. The patient measures whenever they like; the
 *              monitor stores the result and broadcasts it afterwards.
 *
 * Because a generic monitor has no "start measuring" command, there is nothing
 * for the iHealth flow to share. Keeping them apart means iHealth capture — the
 * primary, shipping path — cannot regress from work done here.
 *
 * How the wait works: deviceService.bleArm() leaves a pending connection request
 * open at the OS level. That does NOT contact the monitor, so the cuff stays
 * asleep and its own ~1 minute power-off timer never starts early. The instant
 * the patient finishes a reading and the cuff advertises, the phone connects and
 * collects. Arming before, during, or shortly after the measurement all work.
 *
 * If the window is missed entirely, nothing is lost: the reading stays in the
 * monitor's memory and is delivered on the next connection.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  Easing,
  Image,
  ScrollView,
  StatusBar,
  Linking,
  NativeModules,
  NativeEventEmitter,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { useDispatch, useSelector } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { addReadingAndPersist } from "../../redux/readingSlice";
import { setDeviceBattery } from "../../redux/deviceSlice";
import { syncPendingReadings } from "../../services/vitalsSyncService";
import { hasDailyHealthCheckToday, readingExists } from "../../services/sqliteService";
import type { DeviceRecord } from "../../services/sqliteService";
import type { RootState, AppDispatch } from "../../redux/store";
import DailyHealthCheckModal from "../../components/DailyHealthCheckModal";
import { useToast } from "../../components/Toast";
import deviceService, { type BluetoothStatus } from "../../services/deviceService";
import {
  captureStyles as styles,
  CAPTURE_ACCENT,
  CAPTURE_ACCENT_SOFT,
  CAPTURE_GRADIENT,
} from "./captureTheme";

const { IHealthDevices } = NativeModules;
const emitter = IHealthDevices ? new NativeEventEmitter(IHealthDevices) : null;

// A generic BLE monitor is still a blood pressure cuff to the patient, so it
// gets the same portrait as the iHealth ones. Nothing about this screen should
// read as a second-class device.
const deviceImages: Record<string, any> = {
  BP: require("../../assets/bp3l.png"),
  SCALE: require("../../assets/hs5s.png"),
};

const LOW_BATTERY_THRESHOLD = 20;

// Generous on purpose. The patient has to fit the cuff, sit still, and let the
// monitor run — then the monitor has to broadcast. The iHealth screen's 90s is
// far too short for a flow the app does not control.
const ARMED_TIMEOUT_MS = 5 * 60 * 1000;

type Phase = "idle" | "armed" | "receiving" | "success";

function showBluetoothAlert(status?: Partial<BluetoothStatus> | null) {
  const message =
    status?.message ||
    "CareView needs Bluetooth to capture readings. Turn Bluetooth on or allow Bluetooth permission, then try again.";
  Alert.alert("Bluetooth Needed", message, [
    { text: "Cancel", style: "cancel" },
    { text: "Open Settings", onPress: () => Linking.openSettings() },
  ]);
}

/**
 * Deterministic id from the monitor's own measurement time.
 *
 * These devices re-send stored readings on reconnect and we never erase their
 * memory, so the same measurement can arrive more than once. Building the id
 * from the device timestamp means a repeat lands on an id we already hold and
 * is skipped — no duplicate row, no redundant EMR round-trip. Same approach the
 * BG5S path uses for its stored records.
 */
function buildBleReadingId(
  deviceId: string,
  measuredAtMs: number | null,
  values: { systolic: number; diastolic: number; pulse: number }
): string {
  const device = deviceId || "device";

  if (measuredAtMs) {
    const stamp = Math.floor(measuredAtMs / 1000); // second precision
    return `ble_${device}_${stamp}`;
  }

  // No device clock. Arrival time must NOT be used here: it differs on every
  // delivery, so a monitor re-sending the same stored record would insert a new
  // row each session — and did, four times, from one batch of factory records.
  // Keying on the values instead makes a repeat collapse onto the id we already
  // hold.
  //
  // Tradeoff accepted: two genuinely identical readings from an unclocked
  // monitor collapse into one. Losing a duplicate-valued data point is a far
  // smaller harm than accumulating phantom readings in a chart, and the case is
  // rare — pairing writes the clock, so only records predating it land here.
  return `ble_${device}_nots_${values.systolic}_${values.diastolic}_${values.pulse}`;
}

/**
 * Physiological sanity gate. Mirrors the native check on both platforms; kept
 * here as well so a JS update can protect a device still running older native
 * code. Wide on purpose — it rejects the impossible, not the merely unusual.
 */
function isPlausibleBP(systolic: number, diastolic: number, pulse: number): boolean {
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return false;
  if (systolic < 30 || systolic > 300) return false;
  if (diastolic < 10 || diastolic > 250) return false;
  if (systolic <= diastolic) return false;
  if (pulse !== 0 && (pulse < 20 || pulse > 250)) return false;
  return true;
}

export default function BleCaptureScreen({ route, navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { deviceId } = route.params ?? {};

  const devices = useSelector((state: RootState) => state.devices.devices);
  const bpThresholds = useSelector((state: RootState) => state.user.bpThresholds);
  const device: DeviceRecord | undefined = useMemo(
    () => devices.find((d) => d.id === deviceId),
    [devices, deviceId]
  );

  // Primitives only in effect deps. The device OBJECT gets a fresh identity on
  // every Redux devices update (battery events, loadDevices), and an effect
  // keyed on it would re-run — cleanup first — disarming mid-measurement.
  const deviceDbId = device?.id;
  const deviceMac = device?.mac;
  const deviceType = device?.type;

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("");
  const [lastReading, setLastReading] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<"" | "syncing" | "synced" | "pending">("");
  const [healthCheckCompleted, setHealthCheckCompleted] = useState(true);
  const [showHealthCheckModal, setShowHealthCheckModal] = useState(false);

  const armedRef = useRef(false);
  const readingReceivedRef = useRef(false);
  const timeoutRef = useRef<any>(null);

  // Same animation set as the iHealth capture screen, so the two look and move
  // identically. Only the phases driving them differ.
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const successRingScale = useRef(new Animated.Value(0.8)).current;
  const successRingOpacity = useRef(new Animated.Value(0)).current;
  const readingFade = useRef(new Animated.Value(0)).current;
  const buttonSlide = useRef(new Animated.Value(40)).current;

  const playSuccessAnimation = useCallback(() => {
    successRingScale.setValue(0.8);
    successRingOpacity.setValue(0.8);
    readingFade.setValue(0);
    buttonSlide.setValue(40);

    Animated.sequence([
      Animated.spring(successScale, {
        toValue: 1,
        friction: 5,
        tension: 60,
        useNativeDriver: true,
      }),
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

  const log = useCallback((msg: string) => {
    if (__DEV__) {
      console.log(`[BleCapture] ${msg}`);
    }
  }, []);

  const isBPHigh = useCallback(
    (systolic: number, diastolic: number) => {
      const sysHigh = bpThresholds?.systolicHigh || 140;
      const diaHigh = bpThresholds?.diastolicHigh || 90;
      return systolic >= sysHigh || diastolic >= diaHigh;
    },
    [bpThresholds]
  );

  // ==========================================================================
  // Arm / disarm
  // ==========================================================================
  const disarm = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!armedRef.current || !deviceMac) return;
    armedRef.current = false;
    log("Disarming");
    await deviceService.bleDisarm(deviceMac);
    IHealthDevices?.allowSleep?.();
  }, [deviceMac, log]);

  const arm = useCallback(async () => {
    if (!deviceMac) {
      Alert.alert("Error", "Device not found");
      return;
    }

    try {
      await deviceService.ensureBluetoothReady();
    } catch (error: any) {
      log(`Bluetooth not ready: ${error?.message || String(error)}`);
      showBluetoothAlert(error?.status);
      return;
    }

    readingReceivedRef.current = false;
    setLastReading(null);
    setSyncStatus("");
    successScale.setValue(0);

    IHealthDevices?.keepAwake?.();

    const resolved = await deviceService.bleArm(deviceMac);
    armedRef.current = true;
    setPhase("armed");
    setStatusText(
      resolved
        ? "Waiting for your monitor…"
        : "Searching for your monitor…"
    );
    log(`Armed (peripheral resolved: ${resolved})`);

    timeoutRef.current = setTimeout(() => {
      log("Armed window expired");
      disarm();
      setPhase("idle");
      setStatusText("");
      Alert.alert(
        "No Reading Received",
        "CareView didn't hear from your monitor. Your reading is still saved on the device — start capture again and it will be picked up."
      );
    }, ARMED_TIMEOUT_MS);
  }, [deviceMac, disarm, log, successScale]);

  // ==========================================================================
  // Entry point — daily health check gate, then arm
  // ==========================================================================
  const start = useCallback(async () => {
    // Preeclampsia screening must precede a BP reading. Same clinical rule the
    // iHealth flow enforces; it is not optional just because the transport differs.
    const proceed = () => {
      if (deviceType === "BP" && !healthCheckCompleted) {
        log("Daily health check required before BP measurement");
        setShowHealthCheckModal(true);
        return;
      }
      arm();
    };

    const batt = device?.lastBattery;
    if (typeof batt === "number" && batt >= 0 && batt < LOW_BATTERY_THRESHOLD) {
      const label = device?.friendlyName || device?.name || "device";
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
  }, [device, deviceType, healthCheckCompleted, arm, log]);

  const handleHealthCheckComplete = useCallback(
    (data: any) => {
      setShowHealthCheckModal(false);
      setHealthCheckCompleted(true);
      showToast({ message: "Daily health check saved", type: "success", duration: 2500 });
      if (data.hasHeadaches || data.hasVisualDisturbances) {
        log("Symptoms reported - care team will be notified");
      }
      setTimeout(() => arm(), 400);
    },
    [arm, log, showToast]
  );

  // ==========================================================================
  // Saving
  // ==========================================================================
  const syncToEMR = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      const result = await syncPendingReadings();
      if (result.synced > 0) {
        setSyncStatus("synced");
      } else if (result.remaining > 0) {
        setSyncStatus("pending");
      } else {
        setSyncStatus("synced");
      }
    } catch (e: any) {
      log(`Sync error: ${e.message}`);
      setSyncStatus("pending");
    }
  }, [log]);

  const saveReading = useCallback(
    async (data: any) => {
      const systolic = Number(data?.systolic);
      const diastolic = Number(data?.diastolic);
      const pulse = Number(data?.pulse) || 0;

      // Validated BEFORE anything is written or the timeout is cleared. Native
      // rejects implausible values too; this repeats the check because a
      // JS-only update can ship ahead of a native binary, and because a wrong
      // number in a patient's chart is not recoverable by us.
      if (!isPlausibleBP(systolic, diastolic, pulse)) {
        log(
          `Discarded implausible BP ${data?.systolic}/${data?.diastolic} pulse=${data?.pulse}`
        );
        return;
      }

      // measuredAt is the monitor's own clock, set during pairing. It is 0 on a
      // monitor whose clock was never written — including factory-test records
      // that predate pairing.
      const hasDeviceTime =
        typeof data?.measuredAt === "number" && data.measuredAt > 0;
      const measuredAt = hasDeviceTime ? data.measuredAt : Date.now();

      const readingId = buildBleReadingId(
        deviceDbId || "",
        hasDeviceTime ? data.measuredAt : null,
        { systolic, diastolic, pulse }
      );
      if (readingExists(readingId)) {
        log(`Already captured (${readingId}) — skipping duplicate`);
        return;
      }

      readingReceivedRef.current = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const high = isBPHigh(systolic, diastolic);

      try {
        await dispatch(
          addReadingAndPersist({
            id: readingId,
            ts: measuredAt,
            type: "BP",
            deviceId: deviceDbId || "",
            // Prefer the patient's label over the raw advertised name
            // ("A&D_UA-651BLE_A89A0C"). History resolves this live from the
            // device record anyway, so this value only surfaces if the device is
            // later deleted — but it should still be the friendly one.
            deviceName: device?.friendlyName || device?.name || "BP Monitor",
            value: systolic,
            value2: diastolic,
            heartRate: pulse,
            unit: "mmHg",
          })
        ).unwrap();
      } catch (err) {
        console.error("[BleCapture] Failed to save reading:", err);
        showToast({
          message: "Couldn't save your reading. Please try again.",
          type: "error",
          duration: 4000,
        });
        return;
      }

      setLastReading({ systolic, diastolic, pulse, isHigh: high });
      setPhase("success");
      setStatusText(`${systolic}/${diastolic}`);
      playSuccessAnimation();

      // Stay armed briefly. These monitors hand over their whole stored batch in
      // one session, and disarming on the first reading would truncate it. The
      // dedup above makes extra deliveries harmless.
      setTimeout(() => {
        disarm();
      }, 8000);

      syncToEMR();
    },
    [
      deviceDbId,
      device,
      dispatch,
      disarm,
      isBPHigh,
      log,
      playSuccessAnimation,
      showToast,
      syncToEMR,
    ]
  );

  // ==========================================================================
  // Native events
  // ==========================================================================
  useEffect(() => {
    if (!emitter) return;

    const subs = [
      emitter.addListener("onBloodPressureReading", (data: any) => {
        // Only generic BLE readings belong to this screen. An iHealth reading
        // arriving here would mean another flow is active; ignore it rather
        // than cross-contaminate.
        if (data?.source !== "BLE_GATT") return;
        log(`BP received: ${data.systolic}/${data.diastolic} pulse=${data.pulse}`);
        setPhase("receiving");
        saveReading(data);
      }),
      emitter.addListener("onConnectionStateChanged", (data: any) => {
        if (data?.connected && armedRef.current) {
          setPhase("receiving");
          setStatusText("Monitor found. Collecting your reading…");
        }
      }),
      emitter.addListener("onBatteryLevel", (data: any) => {
        if (data?.source === "BLE_GATT" && typeof data?.level === "number" && data?.mac) {
          dispatch(setDeviceBattery({ mac: data.mac, battery: data.level }));
        }
      }),
      emitter.addListener("onDebugLog", (data: any) => log(`[Native] ${data.message}`)),
    ];

    return () => subs.forEach((s) => s.remove());
  }, [dispatch, log, saveReading]);

  // Pulse animation while waiting
  useEffect(() => {
    if (phase !== "armed") {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulseAnim]);

  // Orbiting ring while waiting — the same motion the iHealth screen uses during
  // scan/connect/measure.
  useEffect(() => {
    if (phase === "armed" || phase === "receiving") {
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
    }
    ringRotate.setValue(0);
    return undefined;
  }, [phase, ringRotate]);

  // Reset on entry; always disarm on exit so a pending connect never outlives
  // the screen.
  useFocusEffect(
    useCallback(() => {
      setPhase("idle");
      setStatusText("");
      setLastReading(null);
      setSyncStatus("");
      readingReceivedRef.current = false;

      if (deviceType === "BP") {
        setHealthCheckCompleted(hasDailyHealthCheckToday());
      }

      // Same entry animation as the iHealth screen.
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

      return () => {
        disarm();
      };
    }, [deviceType, disarm, fadeAnim, scaleAnim])
  );


  // ==========================================================================
  // Render
  //
  // Structurally identical to CaptureScreen so a generic BLE monitor looks and
  // moves exactly like an iHealth one. Only the copy and the phase names differ,
  // because this flow waits on the patient rather than driving the device.
  // ==========================================================================
  if (!device) {
    return (
      <View style={[styles.container, styles.errorContainer]}>
        <Text style={styles.errorText}>Device not found</Text>
        <TouchableOpacity
          style={styles.backButtonAlt}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const ringInterpolate = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const isWaiting = phase === "armed" || phase === "receiving";
  const isSuccess = phase === "success" && Boolean(lastReading);

  const getPhaseMessage = () => {
    switch (phase) {
      case "armed":
        return "Take your reading now";
      case "receiving":
        return "Getting your reading...";
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

  const bottomPadding = isSuccess
    ? Math.max(insets.bottom + 12, 20)
    : Math.max(insets.bottom + 24, 40);

  const deviceTypeLabel = deviceService.getFriendlyTypeName(
    device.model || "GATT_BP"
  );

  const renderReadingDisplay = () => {
    if (!lastReading) return null;
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
        {lastReading.pulse > 0 && (
          <View style={[styles.pulseContainer, isSuccess && styles.pulseContainerSuccess]}>
            <MaterialIcons
              name="favorite"
              size={isSuccess ? 16 : 18}
              color={CAPTURE_ACCENT_SOFT}
            />
            <Text style={[styles.pulseText, isSuccess && styles.pulseTextSuccess]}>
              {lastReading.pulse} bpm
            </Text>
          </View>
        )}
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
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={CAPTURE_GRADIENT} style={StyleSheet.absoluteFill} />

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
                    { rotate: isWaiting ? ringInterpolate : "0deg" },
                  ],
                },
              ]}
            >
              {isWaiting && (
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
          <Text style={[styles.deviceName, isSuccess && styles.deviceNameSuccess]}>
            {device.friendlyName || device.name}
          </Text>
          <Text style={[styles.deviceType, isSuccess && styles.deviceTypeSuccess]}>
            {deviceTypeLabel}
          </Text>

          {/* Reading Display or Status */}
          {isSuccess ? (
            <Animated.View style={{ opacity: readingFade }}>
              {renderReadingDisplay()}
            </Animated.View>
          ) : (
            <View style={styles.statusSection}>
              <Text
                style={[
                  styles.statusText,
                  isWaiting ? { color: CAPTURE_ACCENT_SOFT } : styles.statusTextIdle,
                ]}
              >
                {getPhaseMessage()}
              </Text>
              <Text style={styles.statusSubtext}>
                {isWaiting
                  ? "Press START on your monitor and take your blood pressure as normal. The reading arrives on its own."
                  : "Tap below, then take your blood pressure. You do not need to touch your phone again."}
              </Text>
              {isWaiting && statusText !== "" && (
                <Text style={styles.statusSubtext}>{statusText}</Text>
              )}
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

            {isWaiting && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={async () => {
                  await disarm();
                  setPhase("idle");
                  setStatusText("");
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}

            {phase === "success" && (
              <Animated.View style={{ transform: [{ translateY: buttonSlide }], opacity: readingFade }}>
                <TouchableOpacity
                  onPress={() => navigation.goBack()}
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

      {/* Daily Health Check Modal — same preeclampsia gate as the iHealth flow */}
      <DailyHealthCheckModal
        visible={showHealthCheckModal}
        onComplete={handleHealthCheckComplete}
      />
    </View>
  );
}
