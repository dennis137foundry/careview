import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeEventEmitter,
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

const { IHealthDevices } = NativeModules;
const emitter = IHealthDevices ? new NativeEventEmitter(IHealthDevices) : null;

type FoundDevice = {
  mac: string;
  name?: string;
  type?: string;
  source?: string;
};

type BusyAction =
  | "scan"
  | "connect"
  | "query"
  | "info"
  | "prepare"
  | "start"
  | "code"
  | null;

function formatPayload(payload: any): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export default function BG5SDebugScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [selectedMac, setSelectedMac] = useState("");
  const [manualMac, setManualMac] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const scrollRef = useRef<ScrollView>(null);

  const activeMac = useMemo(
    () => (manualMac.trim() || selectedMac).trim(),
    [manualMac, selectedMac]
  );

  const addLog = useCallback((message: string, payload?: any) => {
    const now = new Date();
    const time = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const suffix = payload !== undefined ? ` ${formatPayload(payload)}` : "";
    setLogs((prev) => [`${time}  ${message}${suffix}`, ...prev].slice(0, 300));
  }, []);

  useEffect(() => {
    if (!emitter) return;

    const subs = [
      emitter.addListener("onDeviceFound", (device: FoundDevice) => {
        if (device?.type !== "BG5S") return;
        addLog("FOUND BG5S", device);
        setDevices((prev) => {
          if (prev.some((d) => d.mac === device.mac)) return prev;
          return [...prev, device];
        });
        setSelectedMac((current) => current || device.mac);
      }),
      emitter.addListener("onConnectionStateChanged", (event: any) => {
        if (event?.type !== "BG5S") return;
        addLog(event.connected ? "CONNECTED" : "DISCONNECTED", event);
      }),
      emitter.addListener("onGlucoseMeterEvent", (event: any) => {
        addLog(`BG5S ${event.stage || "event"}: ${event.message || ""}`, event);
      }),
      emitter.addListener("onBloodGlucoseReading", (reading: any) => {
        addLog("GLUCOSE RESULT", reading);
      }),
      emitter.addListener("onError", (event: any) => {
        if (event?.type && event.type !== "BG5S") return;
        addLog("ERROR", event);
      }),
      emitter.addListener("onDebugLog", (event: any) => {
        const msg = event?.message || "";
        if (msg.includes("BG5S")) addLog("NATIVE", event);
      }),
    ];

    addLog("BG5S debug screen opened");

    return () => {
      subs.forEach((sub) => sub.remove());
      IHealthDevices?.debugBG5SStopScan?.().catch(() => {});
    };
  }, [addLog]);

  const run = useCallback(
    async (action: BusyAction, label: string, fn: () => Promise<any>) => {
      if (Platform.OS !== "ios") {
        addLog("BG5S diagnostic hooks are iOS/TestFlight only in this build");
        return;
      }
      try {
        setBusy(action);
        addLog(`${label}...`);
        const result = await fn();
        addLog(`${label} OK`, result);
      } catch (error: any) {
        addLog(`${label} FAILED`, {
          message: error?.message,
          code: error?.code,
          nativeStackIOS: error?.nativeStackIOS,
        });
      } finally {
        setBusy(null);
      }
    },
    [addLog]
  );

  const requireMac = useCallback(() => {
    if (!activeMac) {
      addLog("Choose a discovered BG5S or enter the serial/MAC first");
      return null;
    }
    return activeMac;
  }, [activeMac, addLog]);

  const startScan = () =>
    run("scan", "Start SDK-only BG5S scan", async () => {
      setDevices([]);
      setSelectedMac("");
      setScanning(true);
      await IHealthDevices.authenticate("com_trinitycareview_app_ios.pem");
      if (IHealthDevices.debugBG5SStartScan) {
        return IHealthDevices.debugBG5SStartScan();
      }
      return IHealthDevices.startScan(["BG5S"]);
    });

  const stopScan = () =>
    run("scan", "Stop BG5S scan", async () => {
      setScanning(false);
      if (IHealthDevices.debugBG5SStopScan) {
        return IHealthDevices.debugBG5SStopScan();
      }
      return IHealthDevices.stopScan();
    });

  const connect = () =>
    run("connect", "Connect BG5S", async () => {
      const mac = requireMac();
      if (!mac) return;
      setScanning(false);
      await IHealthDevices.debugBG5SStopScan?.();
      return IHealthDevices.connectDevice(mac, "BG5S");
    });

  const queryState = () =>
    run("query", "Query BG5S state", async () => {
      const mac = requireMac();
      if (!mac) return;
      return IHealthDevices.debugBG5SQueryState(mac);
    });

  const readDeviceInfo = () =>
    run("info", "Read BG5S device info", async () => {
      const mac = requireMac();
      if (!mac) return;
      return IHealthDevices.debugBG5SReadDeviceInfo(mac);
    });

  const prepareAndStart = () =>
    run("prepare", "Prepare and start blood measurement", async () => {
      const mac = requireMac();
      if (!mac) return;
      return IHealthDevices.debugBG5SPrepareAndStart(mac);
    });

  const startOnly = () =>
    run("start", "Start measurement only", async () => {
      const mac = requireMac();
      if (!mac) return;
      return IHealthDevices.startMeasurement(mac);
    });

  const setCodeAndStart = () =>
    run("code", "Set code then start", async () => {
      const mac = requireMac();
      if (!mac) return;
      return IHealthDevices.debugBG5SSetCodeAndStart(mac);
    });

  const disconnectAll = () =>
    run(null, "Disconnect all", async () => IHealthDevices.disconnectAll());

  const clearLogs = () => setLogs([]);

  const renderBusy = (action: BusyAction) =>
    busy === action ? <ActivityIndicator size="small" color="#fff" /> : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <MaterialIcons name="arrow-back" size={22} color="#122033" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>BG5S Debug</Text>
          <Text style={styles.subtitle}>SDK-only TestFlight diagnostic</Text>
        </View>
      </View>

      {Platform.OS !== "ios" && (
        <View style={styles.warning}>
          <MaterialIcons name="info-outline" size={18} color="#8a5b00" />
          <Text style={styles.warningText}>This diagnostic build targets iOS TestFlight.</Text>
        </View>
      )}

      <View style={styles.panel}>
        <Text style={styles.label}>Discovered BG5S devices</Text>
        {devices.length === 0 ? (
          <Text style={styles.empty}>No BG5S found yet.</Text>
        ) : (
          devices.map((device) => {
            const selected = selectedMac === device.mac && !manualMac.trim();
            return (
              <TouchableOpacity
                key={device.mac}
                style={[styles.deviceRow, selected && styles.deviceRowSelected]}
                onPress={() => {
                  setManualMac("");
                  setSelectedMac(device.mac);
                  addLog("Selected BG5S", device);
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="monitor-heart" size={20} color="#00509f" />
                <View style={styles.deviceText}>
                  <Text style={styles.deviceName}>{device.name || "BG5S"}</Text>
                  <Text style={styles.deviceMac}>{device.mac}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <Text style={styles.label}>Manual serial/MAC</Text>
        <TextInput
          value={manualMac}
          onChangeText={setManualMac}
          placeholder="Optional: enter BG5S serial/MAC"
          placeholderTextColor="#9aa4b2"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.activeMac}>Active: {activeMac || "none"}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.primaryButton} onPress={startScan} activeOpacity={0.85}>
          {renderBusy("scan")}
          <MaterialIcons name="bluetooth-searching" size={18} color="#fff" />
          <Text style={styles.primaryText}>{scanning ? "Scanning" : "Scan"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={stopScan} activeOpacity={0.85}>
          <Text style={styles.secondaryText}>Stop</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={connect} activeOpacity={0.85}>
          {renderBusy("connect")}
          <MaterialIcons name="link" size={18} color="#fff" />
          <Text style={styles.primaryText}>Connect</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        <DebugButton label="Query State" busy={busy === "query"} onPress={queryState} />
        <DebugButton label="Device Info" busy={busy === "info"} onPress={readDeviceInfo} />
        <DebugButton label="Prep + Start" busy={busy === "prepare"} onPress={prepareAndStart} />
        <DebugButton label="Start Only" busy={busy === "start"} onPress={startOnly} />
        <DebugButton label="Code + Start" busy={busy === "code"} onPress={setCodeAndStart} />
        <DebugButton label="Disconnect" busy={false} onPress={disconnectAll} />
      </View>

      <View style={styles.logHeader}>
        <Text style={styles.logTitle}>Live Log</Text>
        <TouchableOpacity onPress={clearLogs} activeOpacity={0.8}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.logBox}
        contentContainerStyle={styles.logContent}
        showsVerticalScrollIndicator
      >
        {logs.length === 0 ? (
          <Text style={styles.logEmpty}>Logs will appear here.</Text>
        ) : (
          logs.map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.logLine} selectable>
              {line}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function DebugButton({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.debugButton} onPress={onPress} activeOpacity={0.85}>
      {busy ? <ActivityIndicator size="small" color="#00509f" /> : null}
      <Text style={styles.debugButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f6fa",
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#122033",
  },
  subtitle: {
    color: "#5f6f82",
    marginTop: 2,
    fontSize: 13,
  },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  warningText: {
    color: "#6f4b00",
    marginLeft: 8,
    flex: 1,
  },
  panel: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  label: {
    color: "#122033",
    fontWeight: "700",
    marginBottom: 8,
  },
  empty: {
    color: "#7c8795",
    marginBottom: 12,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d9e1ea",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  deviceRowSelected: {
    borderColor: "#00509f",
    backgroundColor: "#eef6ff",
  },
  deviceText: {
    marginLeft: 10,
    flex: 1,
  },
  deviceName: {
    color: "#122033",
    fontWeight: "700",
  },
  deviceMac: {
    color: "#5f6f82",
    marginTop: 2,
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d9e1ea",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#122033",
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  activeMac: {
    color: "#00509f",
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: "#00509f",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  primaryText: {
    color: "#fff",
    fontWeight: "800",
  },
  secondaryButton: {
    width: 72,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: "#e7edf5",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: "#122033",
    fontWeight: "800",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  debugButton: {
    width: "31.5%",
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d9e1ea",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  debugButtonText: {
    color: "#122033",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  logTitle: {
    fontSize: 16,
    color: "#122033",
    fontWeight: "800",
  },
  clearText: {
    color: "#00509f",
    fontWeight: "800",
  },
  logBox: {
    flex: 1,
    backgroundColor: "#101820",
    borderRadius: 8,
    marginBottom: 16,
  },
  logContent: {
    padding: 12,
  },
  logLine: {
    color: "#d9f2ff",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 11,
    marginBottom: 8,
  },
  logEmpty: {
    color: "#90a4b8",
  },
});
