/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  useWindowDimensions,
  AppState,
  Alert,
  type LayoutChangeEvent,
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
  getIsFirstLaunch,
  setFirstLaunchComplete,
} from "../../services/sqliteService";
import UrineProteinModal from "../../components/UrineProteinModal";
import {
  getUrineProteinSnapshot,
  type UrineSnapshot,
} from "../../services/urineProteinService";
import {
  describeRelative,
  isProteinAlert,
  type ProteinResult,
  type UnableReasonCode,
} from "../../services/urineProteinLogic";
import {
  markNotificationPermissionAsked,
  requestNotificationPermission,
  wasNotificationPermissionAsked,
} from "../../services/urineReminderService";
import { isLoginSession } from "../../services/urineProteinSession";
import HospitalReportModal from "../../components/HospitalReportModal";
import { useStatusBarStyle } from "../../hooks/useStatusBarStyle";
import { useToast } from "../../components/Toast";
import { BTN } from "../../constants/buttons";

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

  // Urine protein: one snapshot drives the tile, the bell and the hold.
  const [urine, setUrine] = useState<UrineSnapshot | null>(null);
  const [showUrinePicker, setShowUrinePicker] = useState(false);
  const permissionPromptShown = useRef(false);

  // Measured height of the docked New Reading button, so the scroll content
  // always clears it no matter the font scale or platform.
  const [dockHeight, setDockHeight] = useState(68);

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

  const refreshUrine = useCallback(() => {
    setUrine(getUrineProteinSnapshot());
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    dispatch(loadReadings());
    dispatch(loadDevices());
    refreshUrine();

    // The 72-hour clock keeps running while the app is in the background;
    // re-evaluate when it comes back to the foreground on this screen.
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refreshUrine();
    });
    return () => sub.remove();
  }, [dispatch, isFocused, refreshUrine]);

  // Ask for notification permission once, the first time the tile is seen
  // with nothing being held. Our own one-line pre-prompt first, then the OS.
  // Never in the login session: that session already carries the demo-seed
  // prompt and the first device-pairing permission dialogs, and on Android
  // two alerts at once means one of them is lost.
  useEffect(() => {
    if (!isFocused || !urine || urine.status.holdActive) return;
    if (isLoginSession()) return;
    if (permissionPromptShown.current || wasNotificationPermissionAsked()) return;
    permissionPromptShown.current = true;
    Alert.alert(
      "Reminders",
      "CareView can remind you when a urine protein result is due. Allow notifications?",
      [
        {
          text: "Not now",
          style: "cancel",
          onPress: () => markNotificationPermissionAsked(),
        },
        {
          text: "Allow",
          onPress: () => {
            requestNotificationPermission();
          },
        },
      ]
    );
  }, [isFocused, urine]);

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
    // Windowed on capturedAt (when the reading ENTERED the app), not ts
    // (when the sample was taken): a BG5S stored record captured today is
    // a new reading here even if the meter took it days ago. Cards still
    // display the clinical ts. capturedAt falls back to ts for rows saved
    // before the column existed.
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    return (readings || [])
      .filter((r: any) => (r.capturedAt ?? r.ts) >= cutoff)
      .sort(
        (a: any, b: any) => (b.capturedAt ?? b.ts) - (a.capturedAt ?? a.ts)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings, isFocused]);

  const [readingSlide, setReadingSlide] = useState(0);
  useEffect(() => {
    setReadingSlide(0); // new data → snap back to the newest reading
  }, [recentReadings.length]);

  const isBPReadingHigh = (reading: any) => {
    if (!reading?.value || !reading?.value2) return false;
    return isBPHigh(reading.value, reading.value2, bpThresholds);
  };

  const handleUrineComplete = (_result: ProteinResult) => {
    setShowUrinePicker(false);
    refreshUrine();
    showToast({
      message: "Urine protein result saved",
      type: "success",
      duration: 2500,
    });
  };

  const handleUrineUnable = (_reason: UnableReasonCode) => {
    setShowUrinePicker(false);
    refreshUrine();
    showToast({
      message: "Sent to your care team. We'll check back tomorrow.",
      type: "info",
      duration: 3000,
    });
  };

  // The bell is a status light, not a second entry point: when something is
  // owed it opens the same picker the tile opens.
  const handleBellTap = () => {
    if (urine?.status.owed) {
      setShowUrinePicker(true);
    } else {
      showToast({ message: "You're all caught up", type: "info", duration: 2000 });
    }
  };

  const now = Date.now();
  const urineOwed = !!urine?.status.owed;
  const urineAlertRecent = isProteinAlert(urine?.highestLast24h);
  const urineStatusLine = (() => {
    if (!urine) return "";
    if (urine.lastResultAt === null) {
      return urineOwed ? "Result needed" : "No result recorded yet";
    }
    const when = describeRelative(urine.lastResultAt, now);
    return urineOwed
      ? `Overdue · last result ${when}`
      : `Last: ${urine.lastResult ?? "—"} · ${when}`;
  })();
  const isNarrow = windowWidth < 360;

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
            onPress={handleBellTap}
            accessibilityLabel={
              urineOwed ? "Urine protein result due" : "Notifications"
            }
          >
            <MaterialIcons
              name={urineOwed ? "notifications-active" : "notifications-none"}
              size={22}
              color={NAVY}
            />
            {urineOwed && <View style={styles.bellDot} />}
          </TouchableOpacity>
        </View>

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
        <TouchableOpacity
          style={styles.hero}
          activeOpacity={0.9}
          disabled={!dailyFact}
          onPress={() => navigation.navigate("WellnessHistory")}
        >
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
                <Text
                  style={[styles.heroLink, { width: heroInnerWidth }]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  Earlier facts ›
                </Text>
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
        </TouchableOpacity>

        {/* Check-ins: urine protein (record any time; 72h minimum enforced
            by the hold) and health events. Two columns; stacked on very
            narrow phones. */}
        <View style={[styles.checkinRow, isNarrow && styles.checkinRowStacked]}>
          <View style={[styles.checkinCard, urineOwed && styles.checkinCardDue]}>
            <View>
              <View style={styles.checkinHeader}>
                <View style={styles.checkinIcon}>
                  <MaterialIcons name="science" size={17} color={TEAL} />
                </View>
                <Text style={styles.checkinTitle} numberOfLines={1}>
                  Urine protein
                </Text>
              </View>
              <Text
                style={[styles.checkinStatus, urineOwed && styles.checkinStatusDue]}
                maxFontSizeMultiplier={1.2}
              >
                {urineStatusLine}
              </Text>
              {(urineAlertRecent || (urine?.countToday ?? 0) > 1) && (
                <View style={styles.checkinChipRow}>
                  {urineAlertRecent && (
                    <View style={[styles.checkinChip, styles.checkinChipAlert]}>
                      <Text style={[styles.checkinChipText, styles.checkinChipAlertText]}>
                        ALERT {urine?.highestLast24h}
                      </Text>
                    </View>
                  )}
                  {(urine?.countToday ?? 0) > 1 && (
                    <View style={styles.checkinChip}>
                      <Text style={styles.checkinChipText}>
                        {urine?.countToday} TODAY
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.checkinButton}
              activeOpacity={0.85}
              onPress={() => setShowUrinePicker(true)}
            >
              <MaterialIcons name="add" size={18} color="#fff" />
              <Text style={styles.checkinButtonText} maxFontSizeMultiplier={1.2}>
                Record result
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.checkinCard}>
            <View>
              <View style={styles.checkinHeader}>
                <View style={styles.checkinIcon}>
                  <MaterialIcons name="local-hospital" size={17} color={TEAL} />
                </View>
                <Text style={styles.checkinTitle} numberOfLines={1}>
                  Health events
                </Text>
              </View>
              <Text style={styles.checkinStatus} maxFontSizeMultiplier={1.2}>
                Received care outside the home? Tell your care team right away.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.checkinButton}
              activeOpacity={0.85}
              onPress={() => setShowHospitalModal(true)}
            >
              <MaterialIcons name="local-hospital" size={18} color="#fff" />
              <Text style={styles.checkinButtonText} maxFontSizeMultiplier={1.2}>
                I went to the hospital
              </Text>
            </TouchableOpacity>
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

        {/* Clear the docked New Reading button, whatever its measured height */}
        <View style={{ height: dockHeight + 24 }} />
      </ScrollView>

      {/* Docked New Reading button — solid edge-to-edge block sitting
          flush on the bottom tab bar */}
      <View
        style={styles.dock}
        onLayout={(e: LayoutChangeEvent) =>
          setDockHeight(Math.ceil(e.nativeEvent.layout.height))
        }
      >
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

      {/* Urine protein picker, opened from the tile or the bell */}
      <UrineProteinModal
        visible={showUrinePicker && !urine?.status.holdActive}
        mode="voluntary"
        onComplete={handleUrineComplete}
        onUnable={handleUrineUnable}
        onCancel={() => setShowUrinePicker(false)}
      />

      {/* The 72-hour hold: the same picker, rendered inline over the home
          screen (after the dock, so it covers it). Only a saved result or a
          can't-test report clears it. */}
      <UrineProteinModal
        visible={!!urine?.status.holdActive}
        mode="hold"
        onComplete={handleUrineComplete}
        onUnable={handleUrineUnable}
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
  // Tap hint at the bottom of the wellness hero
  heroLink: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: "700",
    color: "#9fdce2",
    letterSpacing: 0.3,
  },
  // Check-ins row: urine protein (left) + health events (right)
  checkinRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 22,
  },
  checkinRowStacked: {
    flexDirection: "column",
  },
  checkinCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e7ecf2",
    padding: 14,
    justifyContent: "space-between",
  },
  checkinCardDue: {
    borderColor: "#f4b183",
    backgroundColor: "#fff8f1",
  },
  checkinHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  checkinIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: "#e4f4f5",
    alignItems: "center",
    justifyContent: "center",
  },
  checkinTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#0f1b2d",
  },
  checkinStatus: {
    fontSize: 12.5,
    lineHeight: 18,
    color: "#5b6b7f",
    marginBottom: 12,
    minHeight: 36,
  },
  checkinStatusDue: {
    color: "#b3541e",
    fontWeight: "600",
  },
  checkinChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  checkinChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#eef2f6",
  },
  checkinChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#5b6b7f",
    letterSpacing: 0.3,
  },
  checkinChipAlert: {
    backgroundColor: "#fdecec",
  },
  checkinChipAlertText: {
    color: ALERT,
  },
  checkinButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: BTN.primary,
    borderRadius: BTN.radius,
    paddingVertical: 11,
    paddingHorizontal: 8,
  },
  checkinButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
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
