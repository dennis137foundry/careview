/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
  RefreshControl,
  ActivityIndicator,
  ImageBackground,
  ScrollView,
} from "react-native";
import { useStatusBarStyle } from "../../hooks/useStatusBarStyle";
import { useDispatch, useSelector } from "react-redux";
import { loadReadings } from "../../redux/readingSlice";
import { isBPHigh } from "../../redux/userSlice";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import RNFS from "react-native-fs";
import Share from "react-native-share";
import { LineChart } from "react-native-gifted-charts";
import {
  onSyncStateChange,
  forceSyncAll,
} from "../../services/vitalsSyncService";
import type { RootState, AppDispatch } from "../../redux/store";
import {
  getScreeningResponsesByType,
  getAllScreeningResponses,
  type SavedReading,
  type ScreeningResponse,
} from "../../services/sqliteService";

// Default BP thresholds (standard hypertension definition)
const DEFAULT_BP_THRESHOLDS = { systolicHigh: 140, diastolicHigh: 90 };

// Single unified chart theme - dark navy with coral/amber lines
const CHART_THEME = {
  background: "#1e293b", // Slate 800
  primaryLine: "#FF6B6B", // Coral (systolic / primary)
  secondaryLine: "#FBBF24", // Amber (diastolic / secondary)
  axisColor: "#94a3b8", // Slate 400
  textColor: "#ffffff",
};

interface DisplayReading extends SavedReading {
  displayNumber: number;
}

interface DisplayScreeningResponse extends ScreeningResponse {
  displayNumber: number;
}

interface TabRoute {
  key: string;
  title: string;
  kind: "reading" | "screening" | "empty";
}

interface SyncState {
  status: "idle" | "syncing" | "offline" | "error";
  pendingCount: number;
  pendingScreeningCount: number;
  lastSyncAttempt: Date | null;
  lastSuccessfulSync: Date | null;
  lastError: string | null;
  retryCount: number;
}

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ---- Scrollable History Navigation ---- */
function HistoryTabBar({
  segments,
  selectedIndex,
  onChange,
}: {
  segments: { key: string; title: string }[];
  selectedIndex: number;
  onChange: (index: number) => void;
}) {
  if (!segments || segments.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={segmentStyles.contentContainer}
      style={segmentStyles.scrollContainer}
    >
      {segments.map((segment, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <TouchableOpacity
            key={segment.key}
            style={[
              segmentStyles.segment,
              isSelected && segmentStyles.segmentSelected,
            ]}
            onPress={() => onChange(idx)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                segmentStyles.segmentText,
                isSelected && segmentStyles.segmentTextSelected,
              ]}
              numberOfLines={1}
            >
              {segment.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const segmentStyles = StyleSheet.create({
  scrollContainer: {
    marginVertical: 12,
    flexGrow: 0,
  },
  contentContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
  },
  segment: {
    backgroundColor: "rgba(0, 32, 64, 0.12)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    minWidth: 112,
  },
  segmentSelected: {
    backgroundColor: "#002040",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#002040",
  },
  segmentTextSelected: {
    color: "#fff",
  },
});

export default function HistoryScreen() {
  const dispatch = useDispatch<AppDispatch>();

  // Navy header → white status-bar glyphs.
  useStatusBarStyle("light-content");

  const { items } = useSelector((state: RootState) => state.readings);
  const bpThresholds = useSelector(
    (state: RootState) => state.user.bpThresholds
  );
  const [index, setIndex] = useState(0);
  const [routes, setRoutes] = useState<TabRoute[]>([]);
  const [dailyHealthChecks, setDailyHealthChecks] = useState<
    ScreeningResponse[]
  >([]);
  const [urineProteinResponses, setUrineProteinResponses] = useState<
    ScreeningResponse[]
  >([]);
  const [sortDirections, setSortDirections] = useState<Record<string, boolean>>(
    {}
  );
  const [refreshing, setRefreshing] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({
    status: "idle",
    pendingCount: 0,
    pendingScreeningCount: 0,
    lastSyncAttempt: null,
    lastSuccessfulSync: null,
    lastError: null,
    retryCount: 0,
  });

  const loadScreeningHistory = useCallback(() => {
    setDailyHealthChecks(getScreeningResponsesByType("daily_health_check"));
    setUrineProteinResponses(
      getScreeningResponsesByType("urine_protein_result")
    );
  }, []);

  // Subscribe to sync state changes
  useEffect(() => {
    const unsubscribe = onSyncStateChange((state) => {
      setSyncState(state);
      if (
        state.status === "idle" &&
        state.pendingCount === 0 &&
        state.pendingScreeningCount === 0
      ) {
        dispatch(loadReadings());
        loadScreeningHistory();
      }
    });
    return unsubscribe;
  }, [dispatch, loadScreeningHistory]);

  useEffect(() => {
    dispatch(loadReadings());
    loadScreeningHistory();
  }, [dispatch, loadScreeningHistory]);

  // Group by TYPE (BP, SCALE, BG)
  const grouped = useMemo(() => {
    if (!items || !Array.isArray(items)) return {};
    return items.reduce(
      (acc: Record<string, SavedReading[]>, r: SavedReading) => {
        const groupKey = r.type || "OTHER";
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(r);
        return acc;
      },
      {}
    );
  }, [items]);

  // Create routes based on type
  useEffect(() => {
    const typeOrder = ["BP", "SCALE", "BG"];
    const newRoutes: TabRoute[] = [];

    for (const type of typeOrder) {
      if (grouped[type] && grouped[type].length > 0) {
        const readings = grouped[type];
        const sortedByTime = [...readings].sort((a, b) => b.ts - a.ts);
        const deviceName = sortedByTime[0]?.deviceName;

        let title = deviceName;
        if (!title || title.trim() === "") {
          if (type === "BP") title = "Blood Pressure";
          else if (type === "SCALE") title = "Weight";
          else if (type === "BG") title = "Glucose";
          else title = type;
        }

        newRoutes.push({ key: type, title, kind: "reading" });
      }
    }

    if (dailyHealthChecks.length > 0) {
      newRoutes.push({
        key: "daily_health_check",
        title: "Daily Health",
        kind: "screening",
      });
    }

    if (urineProteinResponses.length > 0) {
      newRoutes.push({
        key: "urine_protein_result",
        title: "Urine Protein",
        kind: "screening",
      });
    }

    setRoutes(
      newRoutes.length > 0
        ? newRoutes
        : [{ key: "empty", title: "No History", kind: "empty" }]
    );

    // Reset index if out of bounds
    if (index >= Math.max(newRoutes.length, 1)) {
      setIndex(0);
    }
  }, [dailyHealthChecks.length, grouped, index, urineProteinResponses.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await dispatch(loadReadings());
    loadScreeningHistory();
    setRefreshing(false);
  }, [dispatch, loadScreeningHistory]);

  const handleSync = useCallback(async () => {
    try {
      const result = await forceSyncAll();
      await dispatch(loadReadings());
      loadScreeningHistory();

      if (result.synced > 0) {
        Alert.alert(
          "Sync Complete",
          `${result.synced} item${result.synced !== 1 ? "s" : ""} synced to EMR.`
        );
      } else if (result.remaining > 0) {
        Alert.alert(
          "Sync Incomplete",
          `${result.remaining} item${result.remaining !== 1 ? "s" : ""} still pending. Will retry automatically.`
        );
      }
    } catch (error) {
      Alert.alert("Sync Error", "Unable to sync readings. Please try again.");
    }
  }, [dispatch, loadScreeningHistory]);

  const handleExport = async () => {
    try {
      const readings = items || [];
      // Include screening responses (urine protein, daily health checks,
      // hospital reports). Deferrals are UI memory, not clinical data — skip.
      const screenings = getAllScreeningResponses().filter(
        (s) => s.type !== "urine_protein_deferred"
      );

      if (readings.length === 0 && screenings.length === 0) {
        Alert.alert("No data", "There is no history to export.");
        return;
      }

      const header = [
        "Device Name",
        "Device ID",
        "Type",
        "Value",
        "Value2",
        "Unit",
        "Heart Rate",
        "Sample Window / Notes",
        "Synced",
        "Timestamp",
      ];

      type ExportRow = { ts: number; cols: (string | number)[] };

      const readingRows: ExportRow[] = readings.map((r: SavedReading) => ({
        ts: r.ts,
        cols: [
          r.deviceName || "",
          r.deviceId || "",
          r.type || "",
          r.value ?? "",
          r.value2 ?? "",
          r.unit ?? "",
          r.heartRate ?? "",
          r.measurementCondition ?? "",
          r.synced ? "Yes" : "No",
          new Date(r.ts).toLocaleString(),
        ],
      }));

      const screeningRows: ExportRow[] = screenings.map(
        (s: ScreeningResponse) => {
          const d = parseScreeningData(s);
          let typeLabel: string = s.type;
          let value = "";
          let notes = "";
          if (s.type === "urine_protein_result") {
            typeLabel = "Urine Protein";
            value = String(d.result ?? "");
          } else if (s.type === "daily_health_check") {
            typeLabel = "Daily Health Check";
            value = `Headaches: ${yesNoLabel(
              d.hasHeadaches
            )}; Visual disturbances: ${yesNoLabel(d.hasVisualDisturbances)}`;
            notes = typeof d.details === "string" ? d.details : "";
          } else if (s.type === "hospital_visit_report") {
            typeLabel = "Hospital Visit";
            value = "Reported hospital visit";
          }
          return {
            ts: s.timestamp,
            cols: [
              "",
              "",
              typeLabel,
              value,
              "",
              "",
              "",
              notes,
              s.synced ? "Yes" : "No",
              new Date(s.timestamp).toLocaleString(),
            ],
          };
        }
      );

      const rows = [...readingRows, ...screeningRows]
        .sort((a, b) => b.ts - a.ts)
        .map((r) => r.cols);
      const csv = [header, ...rows]
        .map((row) =>
          row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
        )
        .join("\n");

      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(
        now.getMonth() + 1
      ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(
        now.getHours()
      ).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
      const path = `${RNFS.DocumentDirectoryPath}/TrinityHistory_${timestamp}.csv`;

      await RNFS.writeFile(path, csv, "utf8");
      await Share.open({
        url: "file://" + path,
        type: "text/csv",
        showAppsToView: true,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unable to export readings.";
      if (!message.includes("User did not share")) {
        Alert.alert("Export failed", message);
      }
    }
  };

  const toggleSort = useCallback((typeKey: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSortDirections((prev) => ({ ...prev, [typeKey]: !prev[typeKey] }));
  }, []);

  const pendingCount =
    syncState.pendingCount + syncState.pendingScreeningCount;
  const isSyncing = syncState.status === "syncing";
  const isOffline = syncState.status === "offline";

  // Determine navigation mode
  const sectionCount = routes.filter((r) => r.key !== "empty").length;
  const isSingleSection = sectionCount === 1;
  const showHistoryTabs = sectionCount > 1;

  // Get current route safely
  const currentRoute = routes[index] || routes[0];
  const currentKey = currentRoute?.key || "empty";
  const currentScreeningData =
    currentKey === "daily_health_check"
      ? dailyHealthChecks
      : currentKey === "urine_protein_result"
        ? urineProteinResponses
        : [];

  return (
    <ImageBackground
      source={require("../../assets/background.png")}
      style={styles.backgroundImage}
      resizeMode="cover"
    >
      {/* Native stack header already consumes the safe-area top. */}
      <View style={[styles.container, { paddingTop: 8 }]}>
        {/* Sync Banner */}
        {pendingCount > 0 && (
        <View
          style={[styles.syncBanner, isOffline && styles.syncBannerOffline]}
        >
          <View style={styles.syncBannerLeft}>
            <MaterialCommunityIcons
              name={isOffline ? "cloud-off-outline" : "cloud-sync-outline"}
              size={20}
              color={isOffline ? "#9e9e9e" : "#e65100"}
            />
            <Text
              style={[
                styles.syncBannerText,
                isOffline && styles.syncBannerTextOffline,
              ]}
            >
              {pendingCount} item{pendingCount !== 1 ? "s" : ""} pending
              {isOffline ? " • Offline" : ""}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.syncBannerButton,
              isSyncing && styles.syncBannerButtonDisabled,
              isOffline && styles.syncBannerButtonOffline,
            ]}
            onPress={handleSync}
            disabled={isSyncing || isOffline}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons
                name="cloud-upload"
                size={16}
                color="#fff"
              />
            )}
            <Text style={styles.syncBannerButtonText}>
              {isSyncing ? "Syncing..." : "Sync Now"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>History</Text>
        <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
          <MaterialCommunityIcons
            name="file-export-outline"
            size={20}
            color="#fff"
          />
          <Text style={styles.exportText}>Export</Text>
        </TouchableOpacity>
      </View>

      {/* Single History Section Title */}
      {isSingleSection && currentKey !== "empty" && (
        <View style={styles.singleDeviceHeader}>
          <Text style={styles.singleDeviceTitle}>{currentRoute?.title}</Text>
        </View>
      )}

      {/* Scrollable History Sections */}
      {showHistoryTabs && (
        <HistoryTabBar
          segments={routes}
          selectedIndex={index}
          onChange={setIndex}
        />
      )}

      {/* Content */}
      <View style={styles.contentContainer}>
        {currentKey === "empty" ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="show-chart" size={64} color="#ccc" />
            <Text style={styles.emptyTitle}>No Readings Yet</Text>
            <Text style={styles.emptySubtitle}>
              Take a measurement or answer a health check to see history here
            </Text>
          </View>
        ) : currentRoute?.kind === "screening" ? (
          <ScreeningHistoryTab
            data={currentScreeningData}
            type={currentKey}
            sortAsc={sortDirections[currentKey] ?? false}
            onToggleSort={() => toggleSort(currentKey)}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : (
          <DeviceHistoryTab
            data={grouped[currentKey] || []}
            sortAsc={sortDirections[currentKey] ?? false}
            onToggleSort={() => toggleSort(currentKey)}
            refreshing={refreshing}
            onRefresh={onRefresh}
            bpThresholds={bpThresholds ?? DEFAULT_BP_THRESHOLDS}
          />
        )}
      </View>
    </View>
    </ImageBackground>
  );
}

/* ---- Summary Stats Component ---- */
function SummaryStats({
  data,
  type,
  bpThresholds,
}: {
  data: SavedReading[];
  type: string;
  bpThresholds: { systolicHigh: number; diastolicHigh: number };
}) {
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;

    const values = data.map((r) => r.value || 0).filter((v) => v > 0);
    if (values.length === 0) return null;

    const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const high = Math.max(...values);
    const low = Math.min(...values);

    if (type === "BP") {
      const values2 = data.map((r) => r.value2 || 0).filter((v) => v > 0);
      const avg2 =
        values2.length > 0
          ? Math.round(values2.reduce((a, b) => a + b, 0) / values2.length)
          : 0;
      const high2 = values2.length > 0 ? Math.max(...values2) : 0;
      const low2 = values2.length > 0 ? Math.min(...values2) : 0;

      const hrValues = data
        .filter((r) => r.heartRate != null && r.heartRate > 0)
        .map((r) => r.heartRate!);
      const avgHR =
        hrValues.length > 0
          ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length)
          : null;

      const highCount = data.filter((r) =>
        isBPHigh(r.value || 0, r.value2 || 0, bpThresholds)
      ).length;

      return { avg, high, low, avg2, high2, low2, avgHR, highCount };
    }

    return { avg, high, low };
  }, [data, type, bpThresholds]);

  if (!stats) return null;

  return (
    <View style={styles.statsContainer}>
      <View style={styles.statItem}>
        <MaterialIcons name="trending-up" size={16} color="#e53935" />
        <Text style={styles.statLabel}>High</Text>
        <Text style={styles.statValue}>
          {type === "BP" ? `${stats.high}/${stats.high2}` : stats.high}
        </Text>
      </View>
      <View style={styles.statItem}>
        <MaterialIcons name="show-chart" size={16} color="#00acc1" />
        <Text style={styles.statLabel}>Avg</Text>
        <Text style={styles.statValue}>
          {type === "BP" ? `${stats.avg}/${stats.avg2}` : stats.avg}
        </Text>
      </View>
      <View style={styles.statItem}>
        <MaterialIcons name="trending-down" size={16} color="#43a047" />
        <Text style={styles.statLabel}>Low</Text>
        <Text style={styles.statValue}>
          {type === "BP" ? `${stats.low}/${stats.low2}` : stats.low}
        </Text>
      </View>
      {type === "BP" && stats.avgHR != null && (
        <View style={styles.statItem}>
          <MaterialCommunityIcons
            name="heart-pulse"
            size={16}
            color="#e53935"
          />
          <Text style={styles.statLabel}>Avg HR</Text>
          <Text style={styles.statValue}>{stats.avgHR}</Text>
        </View>
      )}
      {type === "BP" && stats.highCount != null && stats.highCount > 0 && (
        <View style={styles.statItem}>
          <MaterialIcons name="warning" size={16} color="#c62828" />
          <Text style={styles.statLabel}>Elevated</Text>
          <Text style={[styles.statValue, { color: "#c62828" }]}>
            {stats.highCount}
          </Text>
        </View>
      )}
    </View>
  );
}

/* ---- Per-device chart & list ---- */
function DeviceHistoryTab({
  data,
  sortAsc,
  onToggleSort,
  refreshing,
  onRefresh,
  bpThresholds,
}: {
  data: SavedReading[];
  sortAsc: boolean;
  onToggleSort: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  bpThresholds: { systolicHigh: number; diastolicHigh: number };
}) {
  // Sort chronologically for numbering
  const chronological = useMemo(() => {
    if (!data || data.length === 0) return [];
    return [...data].sort((a, b) => a.ts - b.ts);
  }, [data]);

  // Add display numbers
  const numbered: DisplayReading[] = useMemo(
    () =>
      chronological.map((r, i) => ({
        ...r,
        displayNumber: i + 1,
      })),
    [chronological]
  );

  // Sort for display
  const sortedList = useMemo(
    () =>
      sortAsc
        ? [...numbered].sort((a, b) => a.ts - b.ts)
        : [...numbered].sort((a, b) => b.ts - a.ts),
    [numbered, sortAsc]
  );

  const deviceType = numbered[0]?.type || "BP";

  // Sync counts
  const unsyncedCount = useMemo(
    () => numbered.filter((r) => !r.synced).length,
    [numbered]
  );

  // Chart data - only render if we have enough data points
  const showChart = numbered.length >= 3;

  const chartData = useMemo(() => {
    if (!showChart) return { primary: [], secondary: [], yAxisOffset: 0, yAxisMax: 200 };

    const primary = numbered.map((r) => ({
      value: parseFloat(String(r.value)) || 0,
      label: `#${r.displayNumber}`,
    }));

    const secondary =
      deviceType === "BP"
        ? numbered.map((r) => ({
            value: parseFloat(String(r.value2)) || 0,
            label: `#${r.displayNumber}`,
          }))
        : [];

    // Calculate Y axis range
    const allValues =
      deviceType === "BP"
        ? [...primary.map((p) => p.value), ...secondary.map((s) => s.value)]
        : primary.map((p) => p.value);

    const validValues = allValues.filter((v) => v > 0);
    const minVal = validValues.length > 0 ? Math.min(...validValues) : 0;
    const maxVal = validValues.length > 0 ? Math.max(...validValues) : 200;

    return {
      primary,
      secondary,
      yAxisOffset: Math.max(0, minVal - 15),
      yAxisMax: maxVal + 15,
    };
  }, [numbered, deviceType, showChart]);

  const isReadingHigh = useCallback(
    (item: DisplayReading): boolean => {
      if (item.type !== "BP") return false;
      return isBPHigh(item.value || 0, item.value2 || 0, bpThresholds);
    },
    [bpThresholds]
  );

  const renderItem = useCallback(
    ({ item }: { item: DisplayReading }) => {
      const isHigh = isReadingHigh(item);

      return (
        <View style={[styles.row, isHigh && styles.rowHigh]}>
          <View style={styles.info}>
            <View style={styles.valueRow}>
              <View
                style={[styles.numberCircle, isHigh && styles.numberCircleHigh]}
              >
                <Text style={styles.numberText}>{item.displayNumber}</Text>
              </View>
              <View style={styles.valueColumn}>
                <View style={styles.valueWithBadge}>
                  <Text style={[styles.value, isHigh && styles.valueHigh]}>
                    {item.type === "BP"
                      ? `${item.value}/${item.value2} ${item.unit || "mmHg"}`
                      : `${item.value} ${item.unit || ""}`}
                  </Text>
                  {isHigh && (
                    <View style={styles.highBadge}>
                      <Text style={styles.highBadgeText}>HIGH</Text>
                    </View>
                  )}
                </View>
                {item.type === "BP" && item.heartRate != null && (
                  <View style={styles.heartRateRow}>
                    <MaterialCommunityIcons
                      name="heart-pulse"
                      size={14}
                      color="#e53935"
                    />
                    <Text style={styles.heartRateText}>
                      {item.heartRate} BPM
                    </Text>
                  </View>
                )}
                {item.type === "BG" && item.measurementCondition ? (
                  <View style={styles.heartRateRow}>
                    <MaterialCommunityIcons
                      name="clock-outline"
                      size={14}
                      color="#43a047"
                    />
                    <Text style={styles.heartRateText}>
                      {item.measurementCondition}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Text style={styles.timeText}>
              {new Date(item.ts).toLocaleDateString([], {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}{" "}
              at{" "}
              {new Date(item.ts).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </View>
          <View style={styles.statusContainer}>
            {item.synced ? (
              <View style={styles.syncedBadge}>
                <MaterialCommunityIcons
                  name="cloud-check"
                  size={20}
                  color="#fff"
                />
              </View>
            ) : (
              <View style={styles.pendingBadge}>
                <MaterialCommunityIcons
                  name="cloud-upload-outline"
                  size={20}
                  color="#ff9800"
                />
              </View>
            )}
          </View>
        </View>
      );
    },
    [isReadingHigh]
  );

  return (
    <View style={styles.scene}>
      <FlatList
        data={sortedList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#002040"
            colors={["#002040"]}
          />
        }
        ListHeaderComponent={
          <>
            {numbered.length > 0 && (
              <SummaryStats
                data={data}
                type={deviceType}
                bpThresholds={bpThresholds}
              />
            )}

            {showChart && (
              <View style={styles.chartContainer}>
                <View style={styles.chartInner}>
                  {deviceType === "BP" ? (
                    <LineChart
                      data={chartData.primary}
                      data2={chartData.secondary}
                      initialSpacing={20}
                      spacing={Math.max(40, 280 / numbered.length)}
                      thickness={3}
                      thickness2={3}
                      height={140}
                      noOfSections={4}
                      curved
                      hideRules={false}
                      yAxisColor={CHART_THEME.axisColor}
                      xAxisColor={CHART_THEME.axisColor}
                      yAxisTextStyle={{ color: CHART_THEME.textColor, fontSize: 11 }}
                      xAxisLabelTextStyle={{ color: CHART_THEME.textColor, fontSize: 10 }}
                      color={CHART_THEME.primaryLine}
                      color2={CHART_THEME.secondaryLine}
                      yAxisOffset={chartData.yAxisOffset}
                      maxValue={chartData.yAxisMax}
                      hideDataPoints={numbered.length > 15}
                    />
                  ) : (
                    <LineChart
                      data={chartData.primary}
                      initialSpacing={20}
                      spacing={Math.max(40, 280 / numbered.length)}
                      thickness={3}
                      height={140}
                      noOfSections={4}
                      curved
                      hideRules={false}
                      yAxisColor={CHART_THEME.axisColor}
                      xAxisColor={CHART_THEME.axisColor}
                      yAxisTextStyle={{ color: CHART_THEME.textColor, fontSize: 11 }}
                      xAxisLabelTextStyle={{ color: CHART_THEME.textColor, fontSize: 10 }}
                      color={CHART_THEME.primaryLine}
                      yAxisOffset={chartData.yAxisOffset}
                      maxValue={chartData.yAxisMax}
                      hideDataPoints={numbered.length > 15}
                    />
                  )}
                  {deviceType === "BP" && (
                    <View style={styles.legendRow}>
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: CHART_THEME.primaryLine },
                          ]}
                        />
                        <Text style={styles.legendText}>Systolic</Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: CHART_THEME.secondaryLine },
                          ]}
                        />
                        <Text style={styles.legendText}>Diastolic</Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            )}

            <View style={styles.metaRow}>
              <View style={styles.countRow}>
                <Text style={styles.countText}>
                  {numbered.length} reading{numbered.length !== 1 ? "s" : ""}
                </Text>
                {unsyncedCount > 0 && (
                  <View style={styles.unsyncedPill}>
                    <MaterialCommunityIcons
                      name="cloud-upload-outline"
                      size={12}
                      color="#ff9800"
                    />
                    <Text style={styles.unsyncedPillText}>
                      {unsyncedCount} pending
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity style={styles.metaButton} onPress={onToggleSort}>
                <MaterialCommunityIcons
                  name={
                    sortAsc
                      ? "sort-clock-ascending-outline"
                      : "sort-clock-descending-outline"
                  }
                  size={18}
                  color="#002040"
                />
                <Text style={styles.sortText}>
                  {sortAsc ? "Oldest first" : "Newest first"}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.listEmpty}>
            <Text style={styles.listEmptyText}>No readings for this device</Text>
          </View>
        }
      />
    </View>
  );
}

function parseScreeningData(response: ScreeningResponse): Record<string, unknown> {
  try {
    return response.data ? JSON.parse(response.data) : {};
  } catch (_error) {
    return {};
  }
}

function yesNoLabel(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not answered";
}

function isProteinAlert(result: unknown): boolean {
  return result === "+2" || result === "+3" || result === "+4";
}

function proteinTextColor(result: unknown): string {
  if (result === "Negative") return "#2e7d32";
  if (result === "Trace" || result === "+1") return "#ef6c00";
  if (isProteinAlert(result)) return "#c62828";
  return "#002040";
}

function ScreeningSummary({
  data,
  type,
}: {
  data: ScreeningResponse[];
  type: string;
}) {
  const summary = useMemo(() => {
    if (type === "daily_health_check") {
      const symptomCount = data.filter((response) => {
        const parsed = parseScreeningData(response);
        return parsed.hasHeadaches === true || parsed.hasVisualDisturbances === true;
      }).length;
      return {
        firstLabel: "Total",
        firstValue: String(data.length),
        secondLabel: "Symptoms",
        secondValue: String(symptomCount),
        thirdLabel: "Clear",
        thirdValue: String(data.length - symptomCount),
      };
    }

    const alertCount = data.filter((response) => {
      const parsed = parseScreeningData(response);
      return isProteinAlert(parsed.result);
    }).length;
    const latest = data[0] ? parseScreeningData(data[0]).result : "--";

    return {
      firstLabel: "Total",
      firstValue: String(data.length),
      secondLabel: "Latest",
      secondValue: typeof latest === "string" ? latest : "--",
      thirdLabel: "Alerts",
      thirdValue: String(alertCount),
    };
  }, [data, type]);

  if (!data.length) return null;

  return (
    <View style={styles.statsContainer}>
      <View style={styles.statItem}>
        <MaterialIcons name="fact-check" size={16} color="#00509f" />
        <Text style={styles.statLabel}>{summary.firstLabel}</Text>
        <Text style={styles.statValue}>{summary.firstValue}</Text>
      </View>
      <View style={styles.statItem}>
        <MaterialIcons name="health-and-safety" size={16} color="#e53935" />
        <Text style={styles.statLabel}>{summary.secondLabel}</Text>
        <Text
          style={[
            styles.statValue,
            type === "urine_protein_result" && {
              color: proteinTextColor(summary.secondValue),
            },
          ]}
        >
          {summary.secondValue}
        </Text>
      </View>
      <View style={styles.statItem}>
        <MaterialIcons name="check-circle" size={16} color="#43a047" />
        <Text style={styles.statLabel}>{summary.thirdLabel}</Text>
        <Text style={styles.statValue}>{summary.thirdValue}</Text>
      </View>
    </View>
  );
}

function ScreeningHistoryTab({
  data,
  type,
  sortAsc,
  onToggleSort,
  refreshing,
  onRefresh,
}: {
  data: ScreeningResponse[];
  type: string;
  sortAsc: boolean;
  onToggleSort: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const chronological = useMemo(() => {
    if (!data || data.length === 0) return [];
    return [...data].sort((a, b) => a.timestamp - b.timestamp);
  }, [data]);

  const numbered: DisplayScreeningResponse[] = useMemo(
    () =>
      chronological.map((response, i) => ({
        ...response,
        displayNumber: i + 1,
      })),
    [chronological]
  );

  const sortedList = useMemo(
    () =>
      sortAsc
        ? [...numbered].sort((a, b) => a.timestamp - b.timestamp)
        : [...numbered].sort((a, b) => b.timestamp - a.timestamp),
    [numbered, sortAsc]
  );

  const unsyncedCount = useMemo(
    () => numbered.filter((response) => !response.synced).length,
    [numbered]
  );

  const renderItem = useCallback(
    ({ item }: { item: DisplayScreeningResponse }) => {
      const parsed = parseScreeningData(item);
      const isDailyHealth = type === "daily_health_check";
      const headacheYes = parsed.hasHeadaches === true;
      const visionYes = parsed.hasVisualDisturbances === true;
      const result = parsed.result;
      const abnormal = isDailyHealth
        ? headacheYes || visionYes
        : isProteinAlert(result);
      const details =
        typeof parsed.details === "string" ? parsed.details.trim() : "";

      return (
        <View style={[styles.row, abnormal && styles.rowHigh]}>
          <View style={styles.info}>
            <View style={styles.valueRow}>
              <View
                style={[
                  styles.numberCircle,
                  abnormal && styles.numberCircleHigh,
                ]}
              >
                <Text style={styles.numberText}>{item.displayNumber}</Text>
              </View>
              <View style={styles.valueColumn}>
                <View style={styles.valueWithBadge}>
                  <Text
                    style={[
                      styles.value,
                      abnormal && styles.valueHigh,
                      !isDailyHealth && { color: proteinTextColor(result) },
                    ]}
                  >
                    {isDailyHealth
                      ? abnormal
                        ? "Symptoms Reported"
                        : "No Symptoms"
                      : `Urine Protein: ${typeof result === "string" ? result : "--"}`}
                  </Text>
                  {abnormal && (
                    <View style={styles.highBadge}>
                      <Text style={styles.highBadgeText}>
                        {isDailyHealth ? "YES" : "ALERT"}
                      </Text>
                    </View>
                  )}
                </View>

                {isDailyHealth ? (
                  <View style={styles.screeningBadgeRow}>
                    <View
                      style={[
                        styles.answerPill,
                        headacheYes ? styles.answerPillYes : styles.answerPillNo,
                      ]}
                    >
                      <Text
                        style={[
                          styles.answerPillText,
                          headacheYes
                            ? styles.answerPillTextYes
                            : styles.answerPillTextNo,
                        ]}
                      >
                        Headache: {yesNoLabel(parsed.hasHeadaches)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.answerPill,
                        visionYes ? styles.answerPillYes : styles.answerPillNo,
                      ]}
                    >
                      <Text
                        style={[
                          styles.answerPillText,
                          visionYes
                            ? styles.answerPillTextYes
                            : styles.answerPillTextNo,
                        ]}
                      >
                        Vision: {yesNoLabel(parsed.hasVisualDisturbances)}
                      </Text>
                    </View>
                  </View>
                ) : null}

                {details ? (
                  <Text style={styles.screeningDetails}>{details}</Text>
                ) : null}
              </View>
            </View>
            <Text style={styles.timeText}>
              {new Date(item.timestamp).toLocaleDateString([], {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}{" "}
              at{" "}
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </View>
          <View style={styles.statusContainer}>
            {item.synced ? (
              <View style={styles.syncedBadge}>
                <MaterialCommunityIcons
                  name="cloud-check"
                  size={20}
                  color="#fff"
                />
              </View>
            ) : (
              <View style={styles.pendingBadge}>
                <MaterialCommunityIcons
                  name="cloud-upload-outline"
                  size={20}
                  color="#ff9800"
                />
              </View>
            )}
          </View>
        </View>
      );
    },
    [type]
  );

  return (
    <View style={styles.scene}>
      <FlatList
        data={sortedList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#002040"
            colors={["#002040"]}
          />
        }
        ListHeaderComponent={
          <>
            <ScreeningSummary data={data} type={type} />
            <View style={styles.metaRow}>
              <View style={styles.countRow}>
                <Text style={styles.countText}>
                  {numbered.length}{" "}
                  {type === "daily_health_check" ? "check" : "result"}
                  {numbered.length !== 1 ? "s" : ""}
                </Text>
                {unsyncedCount > 0 && (
                  <View style={styles.unsyncedPill}>
                    <MaterialCommunityIcons
                      name="cloud-upload-outline"
                      size={12}
                      color="#ff9800"
                    />
                    <Text style={styles.unsyncedPillText}>
                      {unsyncedCount} pending
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity style={styles.metaButton} onPress={onToggleSort}>
                <MaterialCommunityIcons
                  name={
                    sortAsc
                      ? "sort-clock-ascending-outline"
                      : "sort-clock-descending-outline"
                  }
                  size={18}
                  color="#002040"
                />
                <Text style={styles.sortText}>
                  {sortAsc ? "Oldest first" : "Newest first"}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.listEmpty}>
            <Text style={styles.listEmptyText}>No answers yet</Text>
          </View>
        }
      />
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  // Sync Banner
  syncBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff3e0",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#ffe0b2",
  },
  syncBannerOffline: {
    backgroundColor: "#f5f5f5",
    borderBottomColor: "#e0e0e0",
  },
  syncBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  syncBannerText: {
    color: "#e65100",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  syncBannerTextOffline: {
    color: "#757575",
  },
  syncBannerButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ff9800",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  syncBannerButtonDisabled: {
    backgroundColor: "#bdbdbd",
  },
  syncBannerButtonOffline: {
    backgroundColor: "#9e9e9e",
  },
  syncBannerButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13,
  },
  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#002040",
  },
  exportButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#002040",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 6,
  },
  exportText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  // Single device header
  singleDeviceHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  singleDeviceTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#002040",
  },
  // Content
  contentContainer: {
    flex: 1,
  },
  scene: {
    flex: 1,
  },
  // Summary Stats
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statItem: {
    alignItems: "center",
    gap: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#888",
    fontWeight: "500",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#002040",
  },
  // Chart
  chartContainer: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  chartInner: {
    backgroundColor: CHART_THEME.background,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 12,
    gap: 24,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  // Meta row
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  countText: {
    color: "#666",
    fontWeight: "600",
    fontSize: 14,
  },
  unsyncedPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff3e0",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  unsyncedPillText: {
    color: "#e65100",
    fontSize: 11,
    fontWeight: "600",
  },
  metaButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sortText: {
    color: "#002040",
    fontWeight: "600",
    fontSize: 13,
  },
  // List row
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  rowHigh: {
    backgroundColor: "#ffebee",
    borderWidth: 2,
    borderColor: "#ef5350",
  },
  info: {
    flex: 1,
    paddingRight: 10,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
    gap: 10,
  },
  valueColumn: {
    flexDirection: "column",
    flex: 1,
  },
  valueWithBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  heartRateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  heartRateText: {
    fontSize: 13,
    color: "#e53935",
    fontWeight: "600",
  },
  screeningBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  answerPill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  answerPillYes: {
    backgroundColor: "#ffebee",
    borderColor: "#ef9a9a",
  },
  answerPillNo: {
    backgroundColor: "#e8f5e9",
    borderColor: "#a5d6a7",
  },
  answerPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  answerPillTextYes: {
    color: "#c62828",
  },
  answerPillTextNo: {
    color: "#2e7d32",
  },
  screeningDetails: {
    fontSize: 13,
    color: "#555",
    lineHeight: 18,
    marginTop: 8,
  },
  numberCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#002040",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  numberCircleHigh: {
    backgroundColor: "#c62828",
  },
  numberText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  value: {
    fontSize: 18,
    fontWeight: "700",
    color: "#002040",
  },
  valueHigh: {
    color: "#c62828",
  },
  highBadge: {
    backgroundColor: "#c62828",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  highBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  timeText: {
    color: "#888",
    fontSize: 13,
    marginLeft: 36,
    marginTop: 2,
  },
  statusContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  syncedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#43a047",
    alignItems: "center",
    justifyContent: "center",
  },
  pendingBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fff3e0",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ff9800",
  },
  // Empty states
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#888",
    textAlign: "center",
    marginTop: 8,
  },
  listEmpty: {
    padding: 32,
    alignItems: "center",
  },
  listEmptyText: {
    color: "#888",
    fontSize: 14,
  },
});
