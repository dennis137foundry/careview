/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { useSelector, useDispatch } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getDailyTip } from "../../utils/getDailyTip";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { loadReadings } from "../../redux/readingSlice";
import { loadDevices } from "../../redux/deviceSlice";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { AppDispatch, RootState } from "../../redux/store";
import { isBPHigh } from "../../redux/userSlice";
import {
  needsUrineProteinResponse,
  hasUrineProteinDeferredToday,
  getIsFirstLaunch,
  setFirstLaunchComplete,
} from "../../services/sqliteService";
import UrineProteinModal from "../../components/UrineProteinModal";
import HospitalReportModal from "../../components/HospitalReportModal";

// Map device types to images
const deviceImages: Record<string, any> = {
  BP: require("../../assets/bp3l.png"),
  BP3L: require("../../assets/bp3l.png"),
  BP5: require("../../assets/bp3l.png"),
  BP5S: require("../../assets/bp3l.png"),
  GATT_BP: require("../../assets/bp3l.png"),
  SCALE: require("../../assets/hs5s.png"),
  HS2: require("../../assets/hs5s.png"),
  HS2S: require("../../assets/hs5s.png"),
  HS4S: require("../../assets/hs5s.png"),
  GATT_SCALE: require("../../assets/hs5s.png"),
};

// Friendly names for device types
const deviceTypeNames: Record<string, string> = {
  BP: "Blood Pressure",
  BP3L: "Blood Pressure",
  BP5: "Blood Pressure",
  BP5S: "Blood Pressure",
  GATT_BP: "Blood Pressure",
  SCALE: "Smart Scale",
  HS2: "Smart Scale",
  HS2S: "Smart Scale",
  HS4S: "Smart Scale",
  GATT_SCALE: "Smart Scale",
};

const NAVY = "#002040";
const BLUE = "#00509f";
const TEAL = "#0e7c86";
const OK = "#1f8a5b";
const ALERT = "#c62828";

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export default function DashboardScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();

  const readings = useSelector((state: RootState) => state.readings.items);
  const devices = useSelector((state: RootState) => state.devices.devices);
  const user = useSelector((state: RootState) => state.user);
  const bpThresholds = useSelector((state: RootState) => state.user.bpThresholds);

  const [todayTip, setTodayTip] = useState<string>("");
  const [, setIsFirstLaunch] = useState<boolean>(false);

  // Urine Protein Modal State
  const [showUrineProteinModal, setShowUrineProteinModal] = useState(false);
  const [showUrineProteinAlert, setShowUrineProteinAlert] = useState(false);

  // Hospital Report Modal State
  const [showHospitalModal, setShowHospitalModal] = useState(false);

  useEffect(() => {
    getDailyTip().then(setTodayTip);

    // Check first launch status
    const firstLaunch = getIsFirstLaunch();
    setIsFirstLaunch(firstLaunch);
    if (firstLaunch) {
      setFirstLaunchComplete();
    }
  }, []);

  // Check for urine protein modal on focus (only if a device has been added)
  const checkUrineProteinStatus = useCallback(() => {
    if (devices.length === 0) {
      setShowUrineProteinModal(false);
      setShowUrineProteinAlert(false);
      return;
    }

    const needsResponse = needsUrineProteinResponse();
    const hasDeferred = hasUrineProteinDeferredToday();

    if (needsResponse && !hasDeferred) {
      setShowUrineProteinModal(true);
      setShowUrineProteinAlert(false);
    } else if (needsResponse && hasDeferred) {
      setShowUrineProteinModal(false);
      setShowUrineProteinAlert(true);
    } else {
      setShowUrineProteinModal(false);
      setShowUrineProteinAlert(false);
    }
  }, [devices.length]);

  useEffect(() => {
    if (isFocused) {
      dispatch(loadReadings());
      dispatch(loadDevices());
      checkUrineProteinStatus();
    }
  }, [dispatch, isFocused, checkUrineProteinStatus]);

  // Filter for BP and Scale readings only
  const lastBP = readings
    ?.filter((r: any) => r.type === "BP")
    .sort((a: any, b: any) => b.ts - a.ts)[0];

  const lastScale = readings
    ?.filter((r: any) => r.type === "SCALE")
    .sort((a: any, b: any) => b.ts - a.ts)[0];

  const deviceList = devices || [];
  const deviceCount = deviceList.length;

  // Helper to get device type from device object
  const getDeviceType = (device: any): string => {
    if (device.model && deviceImages[device.model]) {
      return device.model;
    }
    if (device.type && deviceImages[device.type]) {
      return device.type;
    }
    const nameParts = device.name?.split(" ") || [];
    if (nameParts[0] && deviceImages[nameParts[0]]) {
      return nameParts[0];
    }
    if (device.type === "BP") return "BP3L";
    if (device.type === "SCALE") return "HS2S";
    return "BP3L";
  };

  const getDeviceImage = (device: any) => {
    const deviceType = getDeviceType(device);
    return deviceImages[deviceType] || deviceImages.BP;
  };

  const getDeviceFriendlyName = (device: any) => {
    if (device.friendlyName) {
      return device.friendlyName;
    }
    const deviceType = getDeviceType(device);
    return deviceTypeNames[deviceType] || device.name || "Device";
  };

  const getSourceBadge = (device: any) => {
    if (device.source === "BLE_GATT") {
      return "BLE";
    }
    return null;
  };

  const isBPReadingHigh = (reading: any) => {
    if (!reading?.value || !reading?.value2) return false;
    return isBPHigh(reading.value, reading.value2, bpThresholds);
  };

  const handleUrineProteinComplete = (_result: string) => {
    setShowUrineProteinModal(false);
    setShowUrineProteinAlert(false);
  };

  const handleUrineProteinDefer = () => {
    setShowUrineProteinModal(false);
    setShowUrineProteinAlert(true);
  };

  const handleAlertBarTap = () => {
    setShowUrineProteinModal(true);
  };

  const firstName = user.firstName || "there";
  const bpHigh = isBPReadingHigh(lastBP);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContainer,
          { paddingTop: insets.top + 12 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greetingForNow()}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {firstName}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.bell}
            activeOpacity={0.7}
            onPress={() => {
              if (showUrineProteinAlert) handleAlertBarTap();
            }}
          >
            <MaterialIcons
              name="notifications-none"
              size={22}
              color={NAVY}
            />
            {showUrineProteinAlert && <View style={styles.bellDot} />}
          </TouchableOpacity>
        </View>

        {/* Urine Protein Alert Bar */}
        {showUrineProteinAlert && (
          <TouchableOpacity
            style={styles.alertBar}
            onPress={handleAlertBarTap}
            activeOpacity={0.8}
          >
            <MaterialIcons name="warning" size={20} color="#E65100" />
            <Text style={styles.alertBarText}>Add Urine Protein Result</Text>
            <MaterialIcons name="chevron-right" size={20} color="#E65100" />
          </TouchableOpacity>
        )}

        {/* Maternal Wellness Daily Tip — navy hero */}
        <LinearGradient
          colors={["#00325f", NAVY]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Text style={styles.heroTag}>Maternal Wellness Daily</Text>
          <Text style={styles.heroTip}>{todayTip}</Text>
        </LinearGradient>

        {/* Latest Readings */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Latest readings</Text>
          <TouchableOpacity onPress={() => navigation.navigate("History")}>
            <Text style={styles.sectionLink}>History</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.readsRow}>
          {/* Blood pressure */}
          <View
            style={[styles.statCard, bpHigh && styles.statCardAlert]}
          >
            <View style={styles.statTop}>
              <View
                style={[
                  styles.statIcon,
                  { backgroundColor: bpHigh ? "#f7d6d6" : "#fdecec" },
                ]}
              >
                <MaterialIcons
                  name="favorite"
                  size={15}
                  color={bpHigh ? ALERT : "#e53935"}
                />
              </View>
              <Text style={styles.statLabel}>Blood pressure</Text>
            </View>
            {lastBP ? (
              <>
                <Text
                  style={[styles.statValue, bpHigh && { color: ALERT }]}
                >
                  {lastBP.value}/{lastBP.value2}
                  <Text style={styles.statUnit}> {lastBP.unit}</Text>
                </Text>
                <Text
                  style={[
                    styles.statTrend,
                    { color: bpHigh ? ALERT : OK },
                  ]}
                >
                  {bpHigh ? "Above range" : "In range"} · {formatWhen(lastBP.ts)}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.statValue}>—</Text>
                <Text style={styles.statTrendMuted}>No readings yet</Text>
              </>
            )}
          </View>

          {/* Weight */}
          <View style={styles.statCard}>
            <View style={styles.statTop}>
              <View
                style={[styles.statIcon, { backgroundColor: "#e6f1fb" }]}
              >
                <MaterialIcons name="monitor-weight" size={15} color={BLUE} />
              </View>
              <Text style={styles.statLabel}>Weight</Text>
            </View>
            {lastScale ? (
              <>
                <Text style={styles.statValue}>
                  {lastScale.value}
                  <Text style={styles.statUnit}> {lastScale.unit}</Text>
                </Text>
                <Text style={[styles.statTrend, { color: OK }]}>
                  {formatWhen(lastScale.ts)}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.statValue}>—</Text>
                <Text style={styles.statTrendMuted}>No readings yet</Text>
              </>
            )}
          </View>
        </View>

        {/* Health Events — hospital report */}
        <View style={styles.eventsCard}>
          <View style={styles.eventsHeader}>
            <View style={styles.eventsIcon}>
              <MaterialIcons name="local-hospital" size={18} color={TEAL} />
            </View>
            <Text style={styles.eventsTitle}>Health events</Text>
          </View>
          <Text style={styles.eventsSub}>
            Let your care team know right away if you've received care outside
            the home.
          </Text>
          <TouchableOpacity
            style={styles.hospitalButton}
            activeOpacity={0.85}
            onPress={() => setShowHospitalModal(true)}
          >
            <MaterialIcons name="local-hospital" size={20} color={TEAL} />
            <Text style={styles.hospitalButtonText}>
              I Went To The Hospital
            </Text>
          </TouchableOpacity>
        </View>

        {/* My Devices */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>My devices</Text>
          {deviceCount > 0 && (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate("Devices", { screen: "DevicesMain" })
              }
            >
              <Text style={styles.sectionLink}>Manage</Text>
            </TouchableOpacity>
          )}
        </View>

        {deviceCount > 0 ? (
          <>
            <View style={styles.devsRow}>
              {deviceList.slice(0, 3).map((device: any, index: number) => {
                const imageSource = getDeviceImage(device);
                const friendlyName = getDeviceFriendlyName(device);
                const sourceBadge = getSourceBadge(device);
                return (
                  <TouchableOpacity
                    key={device.id || index}
                    style={styles.deviceCard}
                    onPress={() =>
                      navigation.navigate("Devices", {
                        screen: "Capture",
                        params: { deviceId: device.id },
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <View style={styles.deviceImageWrapper}>
                      <Image source={imageSource} style={styles.deviceIcon} />
                      {sourceBadge && (
                        <View style={styles.sourceBadge}>
                          <Text style={styles.sourceBadgeText}>
                            {sourceBadge}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.deviceName} numberOfLines={1}>
                      {friendlyName}
                    </Text>
                    <Text style={styles.devicePaired}>Paired</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {deviceCount > 3 && (
              <Text style={styles.moreDevices}>+{deviceCount - 3} more</Text>
            )}
          </>
        ) : (
          <TouchableOpacity
            style={styles.noDevicesCard}
            onPress={() => navigation.navigate("Devices", { screen: "AddDevice" })}
            activeOpacity={0.8}
          >
            <MaterialIcons name="devices-other" size={40} color="#b7c2d0" />
            <Text style={styles.noDevicesText}>No devices added yet</Text>
            <View style={styles.addDevicePrompt}>
              <MaterialIcons name="add-circle" size={18} color={BLUE} />
              <Text style={styles.addDeviceText}>Tap to add your first device</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Spacer for docked button */}
        <View style={{ height: 92 }} />
      </ScrollView>

      {/* Docked, edge-to-edge New Reading button */}
      <View style={styles.dock}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate("Devices", { screen: "DevicesMain" })
          }
        >
          <LinearGradient
            colors={["#00325f", NAVY]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.newReadingButton}
          >
            <MaterialIcons name="add-circle-outline" size={22} color="#fff" />
            <Text style={styles.newReadingText}>New Reading</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Urine Protein Modal */}
      <UrineProteinModal
        visible={showUrineProteinModal}
        onComplete={handleUrineProteinComplete}
        onDefer={handleUrineProteinDefer}
      />

      {/* Hospital Report Modal */}
      <HospitalReportModal
        visible={showHospitalModal}
        onClose={() => setShowHospitalModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#eef3f9",
  },
  scrollContainer: {
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
    paddingHorizontal: 2,
  },
  greeting: {
    fontSize: 13,
    color: "#5b6b7f",
    fontWeight: "500",
  },
  name: {
    fontSize: 26,
    fontWeight: "800",
    color: NAVY,
    marginTop: 2,
    letterSpacing: -0.4,
  },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e9f1",
    alignItems: "center",
    justifyContent: "center",
  },
  bellDot: {
    position: "absolute",
    top: 11,
    right: 12,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: ALERT,
    borderWidth: 2,
    borderColor: "#fff",
  },
  // Alert bar
  alertBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    marginBottom: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#FFE0B2",
  },
  alertBarText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#E65100",
  },
  // Hero
  hero: {
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 22,
  },
  heroTag: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#9dc2ec",
    marginBottom: 8,
  },
  heroTip: {
    fontSize: 15,
    lineHeight: 22,
    color: "#eaf2fb",
    fontWeight: "500",
  },
  // Sections
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0f1b2d",
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: "600",
    color: BLUE,
  },
  // Reading stat cards
  readsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 22,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e7ecf2",
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  statCardAlert: {
    borderColor: "#f0c4c4",
    backgroundColor: "#fdf2f2",
  },
  statTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  statIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    fontSize: 12,
    color: "#5b6b7f",
    fontWeight: "600",
    flex: 1,
  },
  statValue: {
    fontSize: 23,
    fontWeight: "800",
    color: NAVY,
    marginTop: 8,
    letterSpacing: -0.5,
  },
  statUnit: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8a97a6",
  },
  statTrend: {
    fontSize: 11.5,
    fontWeight: "600",
    marginTop: 4,
  },
  statTrendMuted: {
    fontSize: 11.5,
    fontWeight: "500",
    color: "#9aa7b5",
    marginTop: 4,
  },
  // Health events
  eventsCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e7ecf2",
    padding: 15,
    marginBottom: 22,
  },
  eventsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 6,
  },
  eventsIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: "#e4f4f5",
    alignItems: "center",
    justifyContent: "center",
  },
  eventsTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f1b2d",
  },
  eventsSub: {
    fontSize: 13,
    color: "#5b6b7f",
    lineHeight: 19,
    marginBottom: 14,
  },
  hospitalButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderWidth: 1.5,
    borderColor: TEAL,
    backgroundColor: "#e4f4f5",
    borderRadius: 14,
    paddingVertical: 13,
  },
  hospitalButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: TEAL,
  },
  // Devices
  devsRow: {
    flexDirection: "row",
    gap: 10,
  },
  deviceCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e7ecf2",
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  deviceImageWrapper: {
    position: "relative",
  },
  deviceIcon: {
    width: 44,
    height: 44,
    resizeMode: "contain",
    marginBottom: 6,
  },
  sourceBadge: {
    position: "absolute",
    bottom: 4,
    right: -4,
    backgroundColor: "#2196F3",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  sourceBadgeText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#fff",
  },
  deviceName: {
    fontSize: 11,
    color: "#5b6b7f",
    fontWeight: "600",
    textAlign: "center",
  },
  devicePaired: {
    fontSize: 10,
    color: OK,
    fontWeight: "700",
    marginTop: 3,
  },
  moreDevices: {
    color: "#8a97a6",
    fontSize: 13,
    marginTop: 10,
    textAlign: "center",
  },
  noDevicesCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e7ecf2",
    alignItems: "center",
    paddingVertical: 22,
  },
  noDevicesText: {
    fontSize: 15,
    color: "#8a97a6",
    marginTop: 8,
    marginBottom: 12,
  },
  addDevicePrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  addDeviceText: {
    fontSize: 14,
    color: BLUE,
    fontWeight: "600",
  },
  // Docked button (edge-to-edge)
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  newReadingButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    shadowColor: "#002040",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 12,
  },
  newReadingText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },
});
