/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  useWindowDimensions,
} from "react-native";
import { useSelector, useDispatch } from "react-redux";
import { getDailyFact } from "../../utils/getDailyFact";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { loadReadings } from "../../redux/readingSlice";
import { loadDevices } from "../../redux/deviceSlice";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { AppDispatch, RootState } from "../../redux/store";
import { isBPHigh, setEdd } from "../../redux/userSlice";
import DueDateForm from "../../components/DueDateForm";
import {
  needsUrineProteinResponse,
  hasUrineProteinDeferredToday,
  getIsFirstLaunch,
  setFirstLaunchComplete,
  saveScreeningResponse,
} from "../../services/sqliteService";
import { syncPendingScreening } from "../../services/vitalsSyncService";
import UrineProteinModal from "../../components/UrineProteinModal";
import UrineProteinPromptModal from "../../components/UrineProteinPromptModal";
import HospitalReportModal from "../../components/HospitalReportModal";
import { useStatusBarStyle } from "../../hooks/useStatusBarStyle";
import { useToast } from "../../components/Toast";
import { BTN } from "../../constants/buttons";

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
  const { showToast } = useToast();

  // The navy CareView header (AppNavigator) sits behind the status bar on
  // this screen — white glyphs, or the clock/signal disappear into it.
  useStatusBarStyle("light-content");

  const readings = useSelector((state: RootState) => state.readings.items);
  const devices = useSelector((state: RootState) => state.devices.devices);
  const user = useSelector((state: RootState) => state.user);
  const bpThresholds = useSelector((state: RootState) => state.user.bpThresholds);

  const [, setIsFirstLaunch] = useState<boolean>(false);

  // Daily fact aligned to the pregnancy. Recomputed on focus so the fact
  // rolls over at midnight without an app restart. Null → no usable EDD →
  // the hero card shows the due-date form instead.
  const dailyFact = React.useMemo(
    () => (user.edd ? getDailyFact(user.edd) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.edd, isFocused]
  );

  // Urine Protein Modal State
  const [showUrineIntro, setShowUrineIntro] = useState(false);
  const [showUrineProteinModal, setShowUrineProteinModal] = useState(false);
  const [showUrineProteinAlert, setShowUrineProteinAlert] = useState(false);

  // Hospital Report Modal State
  const [showHospitalModal, setShowHospitalModal] = useState(false);

  useEffect(() => {
    // Check first launch status
    const firstLaunch = getIsFirstLaunch();
    setIsFirstLaunch(firstLaunch);
    if (firstLaunch) {
      setFirstLaunchComplete();
    }
  }, []);

  // Decide what urine-protein UI (if any) is due. Only prompts once a device
  // has been added.
  const evaluateUrineProtein = useCallback((): "intro" | "alert" | "none" => {
    if (devices.length === 0) return "none";
    const needsResponse = needsUrineProteinResponse();
    const hasDeferred = hasUrineProteinDeferredToday();
    if (needsResponse && !hasDeferred) return "intro";
    if (needsResponse && hasDeferred) return "alert";
    return "none";
  }, [devices.length]);

  useEffect(() => {
    if (!isFocused) return;
    dispatch(loadReadings());
    dispatch(loadDevices());

    const decision = evaluateUrineProtein();
    if (decision === "intro") {
      // Let the patient land on the dashboard first, then gently prompt with a
      // centered reminder (Skip / Enter Result) instead of the full picker.
      setShowUrineProteinAlert(false);
      const t = setTimeout(() => setShowUrineIntro(true), 2000);
      return () => clearTimeout(t); // cancel if they navigate away first
    }
    if (decision === "alert") {
      setShowUrineIntro(false);
      setShowUrineProteinModal(false);
      setShowUrineProteinAlert(true);
    } else {
      setShowUrineIntro(false);
      setShowUrineProteinModal(false);
      setShowUrineProteinAlert(false);
    }
  }, [dispatch, isFocused, evaluateUrineProtein]);

  // Latest-readings slider: every reading from the last 48 hours — BP,
  // weight, and glucose interleaved — newest first, one per slide.
  const { width: windowWidth } = useWindowDimensions();
  const slideWidth = windowWidth - 36; // scrollContainer padding 18 each side

  // Hero card content width, computed EXPLICITLY from the screen:
  // window − 36 (scroll padding) − 40 (hero padding). The card's text
  // previously relied on the container to constrain it, and the
  // container lied (text rendered unwrapped and clipped). An absolute
  // width forces the text engine to wrap correctly no matter what any
  // parent reports.
  const heroInnerWidth = windowWidth - 36 - 40;

  const recentReadings = React.useMemo(() => {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    return (readings || [])
      .filter((r: any) => r.ts >= cutoff)
      .sort((a: any, b: any) => b.ts - a.ts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings, isFocused]);

  const [readingSlide, setReadingSlide] = useState(0);
  useEffect(() => {
    setReadingSlide(0); // new data → snap back to the newest reading
  }, [recentReadings.length]);

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
    showToast({
      message: "Urine protein result saved",
      type: "success",
      duration: 2500,
    });
  };

  const handleUrineProteinDefer = () => {
    setShowUrineProteinModal(false);
    setShowUrineProteinAlert(true);
  };

  const handleAlertBarTap = () => {
    setShowUrineProteinModal(true);
  };

  // Intro "Enter Result" → open the full result picker.
  const handleUrineIntroEnter = () => {
    setShowUrineIntro(false);
    setShowUrineProteinModal(true);
  };

  // Intro "Skip" → defer for now (persist so we don't re-prompt today) and
  // leave the tappable reminder bar so they can still enter it later.
  const handleUrineIntroSkip = () => {
    setShowUrineIntro(false);
    try {
      saveScreeningResponse("urine_protein_deferred", { deferred: true });
    } catch (err) {
      console.error("[UrineProtein] Failed to save deferral:", err);
    }
    syncPendingScreening().catch(() => {});
    setShowUrineProteinAlert(true);
  };

  const firstName = user.firstName || "there";

  // One slide per reading in the 48h window. BP slides carry the
  // threshold coloring; glucose slides show the timing context.
  const renderReadingSlide = ({ item }: { item: any }) => {
    const isBP = item.type === "BP";
    const isBG = item.type === "BG";
    const high = isBP && isBPReadingHigh(item);

    const iconName = isBP ? "favorite" : isBG ? "opacity" : "monitor-weight";
    const iconColor = isBP ? (high ? ALERT : "#c62828") : isBG ? "#e65100" : BLUE;
    const iconBg = isBP ? (high ? "#f7d6d6" : "#fdecec") : isBG ? "#fff3e0" : "#e6f1fb";
    const label = isBP ? "Blood pressure" : isBG ? "Blood glucose" : "Weight";

    return (
      <View style={[styles.readSlide, { width: slideWidth }, high && styles.statCardAlert]}>
        <View style={styles.statTop}>
          <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
            <MaterialIcons name={iconName} size={15} color={iconColor} />
          </View>
          <Text style={styles.statLabel}>{label}</Text>
          <Text style={styles.statWhen}>{formatWhen(item.ts)}</Text>
        </View>
        <Text style={[styles.statValue, high && { color: ALERT }]}>
          {isBP ? `${item.value}/${item.value2}` : item.value}
          <Text style={styles.statUnit}>
            {" "}
            {item.unit || (isBG ? "mg/dL" : "")}
          </Text>
        </Text>
        {isBP ? (
          <Text style={[styles.statTrend, { color: high ? ALERT : OK }]}>
            {high ? "Above range" : "In range"}
            {item.heartRate ? ` · HR ${item.heartRate}` : ""}
          </Text>
        ) : isBG && item.measurementCondition ? (
          <Text style={styles.statTrendMuted}>{item.measurementCondition}</Text>
        ) : (
          <Text style={[styles.statTrend, { color: OK }]}>Recorded</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        // The native stack header already consumes the safe-area top —
        // adding insets.top again doubled the gap above the greeting.
        contentContainerStyle={[styles.scrollContainer, { paddingTop: 16 }]}
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

        {/* Maternal Wellness Daily Fact — solid navy hero with a teal
            accent bar. Aligned to the pregnancy via EDD; asks for the due
            date when none is known.

            Construction notes (do not "simplify"): plain View instead of
            LinearGradient — the gradient container fed its children a bad
            width constraint on-device (text rendered unwrapped and was
            clipped by the card). Every text is width-pinned to
            heroInnerWidth and has allowFontScaling={false}: absolute
            geometry, nothing depends on parent measurement or Dynamic
            Type. The week pill sits on its own line so nothing competes
            for horizontal space. */}
        <View style={styles.hero}>
          <View style={{ width: heroInnerWidth }}>
            {dailyFact ? (
              <>
                <Text
                  style={[styles.heroTag, { width: heroInnerWidth }]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  Maternal Wellness Daily
                </Text>
                <Text
                  style={[styles.heroTip, { width: heroInnerWidth }]}
                  allowFontScaling={false}
                >
                  {dailyFact.fact}
                </Text>
                <View style={styles.heroWeekBadge}>
                  <Text
                    style={styles.heroWeekBadgeText}
                    numberOfLines={1}
                    allowFontScaling={false}
                  >
                    {dailyFact.isPostpartum
                      ? "After Delivery"
                      : `Week ${dailyFact.week} • Day ${dailyFact.dayOfWeek}`}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text
                  style={[styles.heroTag, { width: heroInnerWidth }]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  Maternal Wellness Daily
                </Text>
                <DueDateForm
                  onSave={(edd) => {
                    dispatch(setEdd({ edd, source: "patient" }));
                    showToast({
                      message: "Due date saved",
                      type: "success",
                      duration: 2500,
                    });
                  }}
                />
              </>
            )}
          </View>
        </View>

        {/* Latest Readings */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Latest readings</Text>
          <TouchableOpacity onPress={() => navigation.navigate("History")}>
            <Text style={styles.sectionLink}>History</Text>
          </TouchableOpacity>
        </View>

        {recentReadings.length === 0 ? (
          <View style={styles.emptyReadingsCard}>
            <Text style={styles.statValue}>—</Text>
            <Text style={styles.statTrendMuted}>
              No readings in the last 48 hours
            </Text>
          </View>
        ) : (
          <View style={styles.sliderWrap}>
            <FlatList
              data={recentReadings}
              keyExtractor={(item: any) => item.id}
              renderItem={renderReadingSlide}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) =>
                setReadingSlide(
                  Math.round(e.nativeEvent.contentOffset.x / slideWidth)
                )
              }
            />
            {recentReadings.length > 1 && (
              <View style={styles.sliderMeta}>
                <View style={styles.dotsRow}>
                  {recentReadings.length <= 6 &&
                    recentReadings.map((r: any, i: number) => (
                      <View
                        key={r.id}
                        style={[
                          styles.dot,
                          i === readingSlide && styles.dotActive,
                        ]}
                      />
                    ))}
                </View>
                <Text style={styles.sliderCount}>
                  {readingSlide + 1} of {recentReadings.length} · swipe · last
                  48 hrs
                </Text>
              </View>
            )}
          </View>
        )}

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
            <MaterialIcons name="local-hospital" size={20} color="#fff" />
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

      {/* Docked New Reading button — solid edge-to-edge block sitting
          flush on the bottom tab bar */}
      <View style={styles.dock}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate("Devices", { screen: "DevicesMain" })
          }
          style={styles.newReadingButton}
        >
          <MaterialIcons name="add-circle-outline" size={22} color="#fff" />
          <Text style={styles.newReadingText} maxFontSizeMultiplier={1.2}>
            New Reading
          </Text>
        </TouchableOpacity>
      </View>

      {/* Gentle centered reminder shown ~2s after landing */}
      <UrineProteinPromptModal
        visible={showUrineIntro}
        onSkip={handleUrineIntroSkip}
        onEnter={handleUrineIntroEnter}
      />

      {/* Urine Protein Modal (full result picker) */}
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
  // Hero — solid navy with a teal accent bar (see construction notes in
  // the JSX; geometry is intentionally absolute).
  hero: {
    backgroundColor: "#00325f",
    borderRadius: 20,
    borderLeftWidth: 4,
    borderLeftColor: BTN.primary,
    paddingVertical: 18,
    paddingHorizontal: 20,
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
    fontSize: 16,
    lineHeight: 23,
    color: "#eaf2fb",
    fontWeight: "500",
  },
  // Footer pill on its own line — nothing competes with it horizontally.
  heroWeekBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(5, 110, 120, 0.45)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 12,
  },
  heroWeekBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#9fdce2",
    letterSpacing: 0.3,
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
  // Latest-readings slider (one reading per slide, last 48 hours)
  sliderWrap: {
    marginBottom: 22,
  },
  readSlide: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e7ecf2",
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  emptyReadingsCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e7ecf2",
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 22,
  },
  statCardAlert: {
    borderColor: "#f0c4c4",
    backgroundColor: "#fdf2f2",
  },
  sliderMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 4,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#c5d1de",
  },
  dotActive: {
    backgroundColor: NAVY,
  },
  sliderCount: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8a97a6",
  },
  statTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  statWhen: {
    marginLeft: "auto",
    fontSize: 11,
    fontWeight: "600",
    color: "#8a97a6",
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
    backgroundColor: BTN.primary,
    borderRadius: BTN.radius,
    paddingVertical: 13,
  },
  hospitalButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
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
  // Docked button — edge-to-edge solid block, flush against the tab bar.
  // Teal (the app's secondary accent) so it reads as its own control and
  // doesn't blend into the navy tab bar below it.
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
    backgroundColor: BTN.primary,
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
