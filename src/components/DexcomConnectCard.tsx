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
  healthSourceProblem,
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
import { fmtDateTime, useT } from "../i18n";

function when(ts: number): string {
  return fmtDateTime(ts, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DexcomConnectCard() {
  const { t } = useT();
  const source = getHealthSource();
  const [availability, setAvailability] = useState<HealthAvailability | "no_answer" | null>(null);
  const [status, setStatus] = useState<CgmStatus>(getCgmStatus());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // Never crashes the screen and never waits forever: no answer in 8 s says so.
    const timer = setTimeout(() => alive && setAvailability((a) => a ?? "no_answer"), 8000);
    source
      ?.availability()
      .then((a) => alive && setAvailability(a))
      .catch((e) => {
        console.warn("[DexcomCard] availability failed:", e?.message ?? e);
        if (alive) setAvailability("no_answer");
      });
    const off = onCgmStatus(setStatus);
    return () => {
      alive = false;
      clearTimeout(timer);
      off();
    };
  }, [source]);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await connectCgm();
      if (!ok) {
        Alert.alert(
          t("modals.dexcomNotConnectedTitle"),
          Platform.OS === "android"
            ? t("modals.dexcomNeedPermissionAndroid")
            : t("modals.dexcomCouldNotOpenIos")
        );
      }
    } finally {
      setBusy(false);
    }
  }, [t]); // text is looked up when the alert opens

  const stop = useCallback(() => {
    Alert.alert(
      t("modals.dexcomStopTitle"),
      t("modals.dexcomStopBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("modals.dexcomStop"), style: "destructive", onPress: disconnectCgm },
      ]
    );
  }, [t]); // text is looked up when the alert opens

  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return null;
  }
  const storeName = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
  // Something is in the way: show the card with the reason rather than hiding it,
  // so a tester (or the care team on the phone) can tell what is wrong.
  const problem = !source
    ? healthSourceProblem() ?? t("modals.dexcomNotAvailableInVersion", { store: storeName })
    : availability === "unsupported"
    ? Platform.OS === "ios"
      ? t("modals.dexcomNoAppleHealth")
      : t("modals.dexcomNoHealthConnect")
    : availability === "no_answer"
    ? t("modals.dexcomNoAnswer", { store: storeName })
    : null;
  if (!source || availability === null || problem) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.icon}>
            <MaterialIcons name="show-chart" size={26} color={BTN.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t("modals.dexcomTitle")}</Text>
            <Text style={styles.subtitle}>{t("modals.dexcomSubtitle")}</Text>
          </View>
        </View>
        {problem ? (
          <Text style={styles.hint}>{problem}</Text>
        ) : (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={BTN.primary} />
            <Text style={styles.statusText}>{t("modals.dexcomChecking", { store: storeName })}</Text>
          </View>
        )}
      </View>
    );
  }
  const store = source.name;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <MaterialIcons name="show-chart" size={26} color={BTN.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("modals.dexcomTitle")}</Text>
          <Text style={styles.subtitle}>
            {status.connected
              ? t("modals.dexcomConnectedThrough", { store })
              : t("modals.dexcomSubtitle")}
          </Text>
        </View>
      </View>

      {availability === "needs_install" ? (
        <>
          <Text style={styles.body}>{t("modals.dexcomNeedsInstall")}</Text>
          <TouchableOpacity
            style={styles.primary}
            onPress={() => Linking.openURL(HEALTH_CONNECT_PLAY_URL)}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryText}>{t("modals.dexcomInstallHC")}</Text>
          </TouchableOpacity>
        </>
      ) : !status.connected ? (
        <>
          <Text style={styles.body}>{t("modals.dexcomIntro")}</Text>
          <Text style={styles.step}>{t("modals.dexcomStep1", { store })}</Text>
          <Text style={styles.step}>{t("modals.dexcomStep2")}</Text>
          <TouchableOpacity
            style={[styles.primary, busy && { opacity: 0.6 }]}
            onPress={connect}
            disabled={busy}
            activeOpacity={0.8}
          >
            {busy ? (
              <ActivityIndicator color={BTN.primaryText} />
            ) : (
              <Text style={styles.primaryText}>{t("modals.dexcomConnect")}</Text>
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
                ? t("modals.dexcomSending")
                : status.lastReadingTs
                ? t("modals.dexcomLatestSent", { when: when(status.lastReadingTs) })
                : t("modals.dexcomNoneYet", { store })}
            </Text>
          </View>
          {!status.syncing && !status.lastReadingTs && (
            <Text style={styles.hint}>
              {Platform.OS === "ios"
                ? t("modals.dexcomCheckIos")
                : t("modals.dexcomCheckAndroid")}
            </Text>
          )}
          {!!status.lastError && !status.syncing && (
            <Text style={styles.error}>
              {t("modals.dexcomLastError", { error: status.lastError })}
            </Text>
          )}
          <Text style={styles.hint}>{t("modals.dexcomDelayNote")}</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.quiet, status.syncing && { opacity: 0.6 }]}
              onPress={() => syncCgm("manual")}
              disabled={status.syncing}
              activeOpacity={0.8}
            >
              <Text style={styles.quietText}>{t("modals.dexcomSendNow")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quiet} onPress={stop} activeOpacity={0.8}>
              <Text style={[styles.quietText, { color: BTN.destructive }]}>
                {t("modals.dexcomStop")}
              </Text>
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
