/**
 * DexcomConnectCard — the Devices screen's "Dexcom Glucose Sensor" card.
 *
 * Not a Bluetooth device: the Dexcom app writes the sensor's readings to Apple
 * Health / Health Connect and CareView reads them there (cgmSyncService). The
 * card walks the patient through the one-time setup and then shows that
 * readings are flowing. Hidden on a phone that cannot do it.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { BTN, BTN_SIZE } from "../constants/buttons";
import {
  getHealthSource,
  HealthAvailability,
  HEALTH_CONNECT_PLAY_URL,
} from "../services/cgm/cgmHealthSource";
import {
  CgmStatus,
  connectCgm,
  disconnectCgm,
  getCgmStatus,
  onCgmStatus,
  syncCgm,
} from "../services/cgm/cgmSyncService";

function when(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DexcomConnectCard() {
  const source = getHealthSource();
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [status, setStatus] = useState<CgmStatus>(getCgmStatus());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    source?.availability().then((a) => alive && setAvailability(a));
    const off = onCgmStatus(setStatus);
    return () => {
      alive = false;
      off();
    };
  }, [source]);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await connectCgm();
      if (!ok) {
        Alert.alert(
          "Not connected",
          Platform.OS === "android"
            ? "CareView needs permission to read Blood Glucose in Health Connect. Tap Connect again and allow it."
            : "CareView could not open Apple Health. Please try again."
        );
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(() => {
    Alert.alert(
      "Stop sending Dexcom readings?",
      "Your care team will no longer receive your glucose sensor readings from this phone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Stop", style: "destructive", onPress: disconnectCgm },
      ]
    );
  }, []);

  if (!source || availability === null || availability === "unsupported") {
    return null;
  }
  const store = source.name;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <MaterialIcons name="show-chart" size={26} color={BTN.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Dexcom Glucose Sensor</Text>
          <Text style={styles.subtitle}>
            {status.connected ? `Connected through ${store}` : "Continuous glucose monitor"}
          </Text>
        </View>
      </View>

      {availability === "needs_install" ? (
        <>
          <Text style={styles.body}>
            To send your Dexcom readings, this phone needs Google's Health Connect app. Install it,
            then come back and tap Connect.
          </Text>
          <TouchableOpacity
            style={styles.primary}
            onPress={() => Linking.openURL(HEALTH_CONNECT_PLAY_URL)}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryText}>Install Health Connect</Text>
          </TouchableOpacity>
        </>
      ) : !status.connected ? (
        <>
          <Text style={styles.body}>
            If you wear a Dexcom sensor, CareView can send its readings to your care team
            automatically.
          </Text>
          <Text style={styles.step}>
            1. In the Dexcom app, turn on sharing to {store}.
          </Text>
          <Text style={styles.step}>
            2. Tap Connect below and allow CareView to read Blood Glucose.
          </Text>
          <TouchableOpacity
            style={[styles.primary, busy && { opacity: 0.6 }]}
            onPress={connect}
            disabled={busy}
            activeOpacity={0.8}
          >
            {busy ? (
              <ActivityIndicator color={BTN.primaryText} />
            ) : (
              <Text style={styles.primaryText}>Connect</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.statusRow}>
            {status.syncing ? (
              <ActivityIndicator size="small" color={BTN.primary} />
            ) : (
              <MaterialIcons
                name={status.lastError ? "error-outline" : status.lastReadingTs ? "check-circle" : "hourglass-empty"}
                size={18}
                color={status.lastError ? BTN.destructive : status.lastReadingTs ? "#2e7d32" : "#5b6b7f"}
              />
            )}
            <Text style={styles.statusText}>
              {status.syncing
                ? "Sending readings…"
                : status.lastReadingTs
                ? `Latest reading sent: ${when(status.lastReadingTs)}`
                : `No Dexcom readings found in ${store} yet.`}
            </Text>
          </View>
          {!status.syncing && !status.lastReadingTs && (
            <Text style={styles.hint}>
              {Platform.OS === "ios"
                ? "Check that the Dexcom app shares with Apple Health, and that CareView may read Blood Glucose (Health app › Sharing › Apps › CareView)."
                : "Check that the Dexcom app shares with Health Connect."}
            </Text>
          )}
          {!!status.lastError && !status.syncing && (
            <Text style={styles.error}>Last try didn't finish: {status.lastError}</Text>
          )}
          <Text style={styles.hint}>
            Dexcom shares readings about 3 hours after the sensor takes them. CareView sends them
            whenever the app is open.
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.quiet, status.syncing && { opacity: 0.6 }]}
              onPress={() => syncCgm("manual")}
              disabled={status.syncing}
              activeOpacity={0.8}
            >
              <Text style={styles.quietText}>Send now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quiet} onPress={stop} activeOpacity={0.8}>
              <Text style={[styles.quietText, { color: BTN.destructive }]}>Stop</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#e6f2f3",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  title: { fontSize: 17, fontWeight: "700", color: "#1a1a2e" },
  subtitle: { fontSize: 13, color: "#00509f", fontWeight: "500", marginTop: 2 },
  body: { fontSize: 14, color: "#333", lineHeight: 20, marginBottom: 8 },
  step: { fontSize: 14, color: "#333", lineHeight: 20, marginBottom: 4 },
  hint: { fontSize: 12.5, color: "#5b6b7f", lineHeight: 18, marginTop: 6 },
  error: { fontSize: 12.5, color: BTN.destructive, marginTop: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { fontSize: 14, color: "#1a1a2e", fontWeight: "600", flexShrink: 1 },
  primary: {
    marginTop: 10,
    backgroundColor: BTN.primary,
    borderRadius: BTN.radius,
    paddingVertical: BTN_SIZE.medium.paddingVertical,
    alignItems: "center",
  },
  primaryText: {
    color: BTN.primaryText,
    fontSize: BTN_SIZE.medium.fontSize,
    fontWeight: BTN_SIZE.medium.fontWeight,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  quiet: {
    flex: 1,
    backgroundColor: BTN.quiet,
    borderRadius: BTN.radius,
    paddingVertical: BTN_SIZE.small.paddingVertical,
    alignItems: "center",
  },
  quietText: {
    color: BTN.quietText,
    fontSize: BTN_SIZE.small.fontSize,
    fontWeight: BTN_SIZE.small.fontWeight,
  },
});
