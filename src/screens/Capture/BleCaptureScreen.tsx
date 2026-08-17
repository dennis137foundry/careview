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
  ScrollView,
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
import { BTN } from "../../constants/buttons";

const { IHealthDevices } = NativeModules;
const emitter = IHealthDevices ? new NativeEventEmitter(IHealthDevices) : null;

const ACCENT = BTN.primary;
const ACCENT_SOFT = "#7fd6de";
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
function buildBleReadingId(deviceId: string, measuredAtMs: number): string {
  const stamp = Math.floor(measuredAtMs / 1000); // second precision
  return `ble_${deviceId || "device"}_${stamp}`;
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

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const successScale = useRef(new Animated.Value(0)).current;

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
      // measuredAt is the monitor's own clock, written during pairing. It is 0
      // when the device never had its time set, in which case arrival time is
      // the best available answer.
      const measuredAt =
        typeof data?.measuredAt === "number" && data.measuredAt > 0
          ? data.measuredAt
          : Date.now();

      const readingId = buildBleReadingId(deviceDbId || "", measuredAt);
      if (readingExists(readingId)) {
        log(`Already captured (${readingId}) — skipping duplicate`);
        return;
      }

      readingReceivedRef.current = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const systolic = Number(data?.systolic);
      const diastolic = Number(data?.diastolic);
      if (!Number.isFinite(systolic) || !Number.isFinite(diastolic) || systolic <= 0) {
        log("Discarding malformed BP payload");
        return;
      }

      const high = isBPHigh(systolic, diastolic);

      try {
        await dispatch(
          addReadingAndPersist({
            id: readingId,
            ts: measuredAt,
            type: "BP",
            deviceId: deviceDbId || "",
            deviceName: device?.name || "BP Monitor",
            value: systolic,
            value2: diastolic,
            heartRate: Number(data?.pulse) || 0,
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

      setLastReading({ systolic, diastolic, pulse: Number(data?.pulse) || 0, isHigh: high });
      setPhase("success");
      setStatusText(`${systolic}/${diastolic}`);

      Animated.spring(successScale, {
        toValue: 1,
        friction: 5,
        tension: 60,
        useNativeDriver: true,
      }).start();

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
      showToast,
      successScale,
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

      return () => {
        disarm();
      };
    }, [deviceType, disarm])
  );

  // ==========================================================================
  // Render
  // ==========================================================================
  if (!device) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missingText}>Device not found.</Text>
      </View>
    );
  }

  const isWaiting = phase === "armed" || phase === "receiving";
  const label = device.friendlyName || device.name || "Blood Pressure Monitor";

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[ACCENT, ACCENT_SOFT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{label}</Text>
        <Text style={styles.headerSub}>Blood Pressure</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.body}>
        {phase === "success" && lastReading ? (
          <Animated.View style={[styles.readingCard, { transform: [{ scale: successScale }] }]}>
            <MaterialIcons name="check-circle" size={44} color={ACCENT} />
            <Text style={styles.readingValue}>
              {lastReading.systolic}/{lastReading.diastolic}
              <Text style={styles.readingUnit}> mmHg</Text>
            </Text>
            {lastReading.pulse > 0 && (
              <Text style={styles.readingPulse}>Pulse {lastReading.pulse} bpm</Text>
            )}
            {lastReading.isHigh && (
              <View style={styles.highBanner}>
                <MaterialIcons name="warning" size={18} color="#8a5300" />
                <Text style={styles.highText}>
                  This reading is above your target. Your care team will see it.
                </Text>
              </View>
            )}
            {syncStatus === "syncing" && <Text style={styles.syncText}>Syncing…</Text>}
            {syncStatus === "synced" && <Text style={styles.syncText}>Sent to your care team</Text>}
            {syncStatus === "pending" && (
              <Text style={styles.syncText}>Saved. Will send when you're back online.</Text>
            )}
          </Animated.View>
        ) : (
          <>
            <Animated.View style={[styles.iconWrap, { transform: [{ scale: pulseAnim }] }]}>
              <MaterialIcons
                name={isWaiting ? "bluetooth-searching" : "favorite"}
                size={64}
                color={ACCENT}
              />
            </Animated.View>

            {isWaiting ? (
              <>
                <Text style={styles.stepTitle}>Take your reading now</Text>
                <Text style={styles.stepBody}>
                  Press the START button on your monitor and take your blood pressure as
                  normal. CareView is listening and will pick up the reading automatically
                  when the monitor finishes.
                </Text>
                <Text style={styles.statusLine}>{statusText}</Text>
              </>
            ) : (
              <>
                <Text style={styles.stepTitle}>Ready when you are</Text>
                <Text style={styles.stepBody}>
                  Tap below, then take your blood pressure. You don't need to press anything
                  else on your phone — the reading arrives on its own.
                </Text>
              </>
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + 12 }]}>
        {phase === "success" ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        ) : isWaiting ? (
          <TouchableOpacity
            style={styles.quietBtn}
            onPress={async () => {
              await disarm();
              setPhase("idle");
              setStatusText("");
            }}
          >
            <Text style={styles.quietBtnText}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={start}>
            <Text style={styles.primaryBtnText}>Start Capture</Text>
          </TouchableOpacity>
        )}
      </View>

      <DailyHealthCheckModal
        visible={showHealthCheckModal}
        onComplete={handleHealthCheckComplete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f6f8fa" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  missingText: { fontSize: 15, color: "#5b6b7f" },

  header: { paddingHorizontal: 20, paddingBottom: 22 },
  backBtn: { marginBottom: 8, width: 32 },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  headerSub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },

  body: { padding: 24, alignItems: "center" },
  iconWrap: { marginTop: 24, marginBottom: 20 },
  stepTitle: { fontSize: 19, fontWeight: "700", color: "#0f2430", textAlign: "center" },
  stepBody: {
    fontSize: 15,
    lineHeight: 22,
    color: "#5b6b7f",
    textAlign: "center",
    marginTop: 10,
  },
  statusLine: { marginTop: 18, fontSize: 14, color: ACCENT, fontWeight: "600" },

  readingCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    width: "100%",
    marginTop: 16,
  },
  readingValue: { fontSize: 40, fontWeight: "700", color: "#0f2430", marginTop: 10 },
  readingUnit: { fontSize: 16, fontWeight: "600", color: "#5b6b7f" },
  readingPulse: { fontSize: 15, color: "#5b6b7f", marginTop: 4 },
  highBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff4e0",
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    gap: 8,
  },
  highText: { flex: 1, fontSize: 13, color: "#8a5300", lineHeight: 18 },
  syncText: { marginTop: 14, fontSize: 13, color: "#5b6b7f" },

  dock: { padding: 16, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e6ecf2" },
  primaryBtn: {
    backgroundColor: BTN.primary,
    borderRadius: BTN.radius,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: BTN.primaryText, fontSize: 16, fontWeight: "700" },
  quietBtn: {
    backgroundColor: BTN.quiet,
    borderRadius: BTN.radius,
    paddingVertical: 14,
    alignItems: "center",
  },
  quietBtnText: { color: BTN.quietText, fontSize: 16, fontWeight: "700" },
});
