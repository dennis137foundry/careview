/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
  RefreshControl,
  ActivityIndicator,
  ImageBackground,
} from "react-native";
import { TabView, TabBar } from "react-native-tab-view";
import { useDispatch, useSelector } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import type { SavedReading } from "../../services/sqliteService";

const screenWidth = Dimensions.get("window").width;

// Default BP thresholds (standard hypertension definition)
const DEFAULT_BP_THRESHOLDS = { systolicHigh: 140, diastolicHigh: 90 };

// Chart themes per device type
const CHART_THEMES: Record<
  string,
  {
    background: string;
    primary: string;
    secondary: string;
    accent: string;
  }
> = {
  BP: {
    background: "#1e293b",
    primary: "#FF6B6B",
    secondary: "#FCD34D",
    accent: "#94a3b8",
  },
  SCALE: {
    background: "#312e81",
    primary: "#FBBF24",
    secondary: "#FBBF24",
    accent: "#a5b4fc",
  },
  BG: {
    background: "#4c1d95",
    primary: "#A78BFA",
    secondary: "#A78BFA",
    accent: "#c4b5fd",
  },
  DEFAULT: {
    background: "#1f2937",
    primary: "#FB7185",
    secondary: "#FB7185",
    accent: "#9ca3af",
  },
};

interface DisplayReading extends SavedReading {
  displayNumber: number;
}

interface TabRoute {
  key: string;
  title: string;
}

interface SyncState {
  status: "idle" | "syncing" | "offline" | "error";
  pendingCount: number;
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

/* ---- Segment Control Component ---- */
function SegmentControl({
  segments,
  selectedIndex,
  onChange,
}: {
  segments: { key: string; title: string }[];
  selectedIndex: number;
  onChange: (index: number) => void;
}) {
  return (
    <View style={segmentStyles.container}>
      {segments.map((segment, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <TouchableOpacity
            key={segment.key}
            style={[
              segmentStyles.segment,
              isSelected && segmentStyles.segmentSelected,
              idx === 0 && segmentStyles.segmentFirst,
              idx === segments.length - 1 && segmentStyles.segmentLast,
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
    </View>
  );
}

const segmentStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: "rgba(0, 32, 64, 0.15)",
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  segmentSelected: {
    backgroundColor: "#002040",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  segmentFirst: {
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  segmentLast: {
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
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
  const insets = useSafeAreaInsets();
  const { items } = useSelector((state: RootState) => state.readings);
  const bpThresholds = useSelector(
    (state: RootState) => state.user.bpThresholds
  );
  const [index, setIndex] = useState(0);
  const [routes, setRoutes] = useState<TabRoute[]>([]);
  const [sortDirections, setSortDirections] = useState<Record<string, boolean>>(
    {}
  );
  const [refreshing, setRefreshing] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({
    status: "idle",
    pendingCount: 0,
    lastSyncAttempt: null,
    lastSuccessfulSync: null,
    lastError: null,
    retryCount: 0,
  });

  // Subscribe to sync state changes
  useEffect(() => {
    const unsubscribe = onSyncStateChange((state) => {
      setSyncState(state);
      if (state.status === "idle" && state.pendingCount === 0) {
        dispatch(loadReadings());
      }
    });
    return unsubscribe;
  }, [dispatch]);

  useEffect(() => {
    dispatch(loadReadings());
  }, [dispatch]);

  // Group by TYPE (BP, SCALE) instead of deviceId
  const grouped = useMemo(() => {
    return items.reduce(
      (acc: Record<string, SavedReading[]>, r: SavedReading) => {
        const groupKey = r.type;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(r);
        return acc;
      },
      {}
    );
  }, [items]);

  // Create tabs based on type, use deviceName for display
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

        newRoutes.push({ key: type, title });
      }
    }

    setRoutes(
      newRoutes.length ? newRoutes : [{ key: "empty", title: "No Devices" }]
    );
  }, [grouped]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await dispatch(loadReadings());
    setRefreshing(false);
  }, [dispatch]);

  const handleSync = useCallback(async () => {
    try {
      const result = await forceSyncAll();
      await dispatch(loadReadings());

      if (result.synced > 0) {
        Alert.alert(
          "Sync Complete",
          `${result.synced} reading${result.synced !== 1 ? "s" : ""} synced to EMR.`
        );
      } else if (result.remaining > 0) {
        Alert.alert(
          "Sync Incomplete",
          `${result.remaining} reading${result.remaining !== 1 ? "s" : ""} still pending. Will retry automatically.`
        );
      }
    } catch (error) {
      Alert.alert("Sync Error", "Unable to sync readings. Please try again.");
    }
  }, [dispatch]);

  const handleExport = async () => {
    try {
      if (!items?.length) {
        Alert.alert("No data", "There are no readings to export.");
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
        "Synced",
        "Timestamp",
      ];
      const rows = items.map((r: SavedReading) => [
        r.deviceName || "",
        r.deviceId || "",
        r.type || "",
        r.value ?? "",
        r.value2 ?? "",
        r.unit ?? "",
        r.heartRate ?? "",
        r.synced ? "Yes" : "No",
        new Date(r.ts).toLocaleString(),
      ]);
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
      const path = `${RNFS.DocumentDirectoryPath}/TrinityReadings_${timestamp}.csv`;

      await RNFS.writeFile(path, csv, "utf8");
      await Share.open({
        url: "file://" + path,
        type: "text/csv",
        showAppsToView: true,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unable to export readings.";
      Alert.alert("Export failed", message);
    }
  };

  const toggleSort = useCallback((typeKey: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSortDirections((prev) => ({ ...prev, [typeKey]: !prev[typeKey] }));
  }, []);

  const renderScene = ({ route }: { route: TabRoute }) => {
    if (route.key === "empty") {
      return (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="show-chart" size={64} color="#ccc" />
          <Text style={styles.emptyTitle}>No Readings Yet</Text>
          <Text style={styles.emptySubtitle}>
            Take a measurement to see your history here
          </Text>
        </View>
      );
    }

    const typeReadings = grouped[route.key] || [];
    const sortAsc = sortDirections[route.key] ?? false;

    return (
      <DeviceHistoryTab
        data={typeReadings}
        sortAsc={sortAsc}
        onToggleSort={() => toggleSort(route.key)}
        refreshing={refreshing}
        onRefresh={onRefresh}
        bpThresholds={bpThresholds ?? DEFAULT_BP_THRESHOLDS}
      />
    );
  };

  const pendingCount = syncState.pendingCount;
  const isSyncing = syncState.status === "syncing";
  const isOffline = syncState.status === "offline";

  // Determine navigation mode based on device count
  const deviceCount = routes.filter((r) => r.key !== "empty").length;
  const useSegmentControl = deviceCount >= 1 && deviceCount <= 3;
  const useTabs = deviceCount >= 4;
  const isSingleDevice = deviceCount === 1;

  return (
    <ImageBackground
      source={require("../../assets/bg.png")}
      style={styles.backgroundImage}
      resizeMode="cover"
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Sync Banner - TOP of screen */}
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
                {pendingCount} reading{pendingCount !== 1 ? "s" : ""} pending
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

        {/* Dynamic Navigation: Single Title / Segment Control / Tabs */}
        {isSingleDevice && routes[0]?.key !== "empty" && (
          <View style={styles.singleDeviceHeader}>
            <Text style={styles.singleDeviceTitle}>{routes[0]?.title}</Text>
          </View>
        )}

        {useSegmentControl && !isSingleDevice && (
          <SegmentControl
            segments={routes}
            selectedIndex={index}
            onChange={setIndex}
          />
        )}

        {/* Content Area */}
        <View style={styles.contentContainer}>
          {useTabs ? (
            <TabView
              navigationState={{ index, routes }}
              renderScene={renderScene}
              onIndexChange={setIndex}
              initialLayout={{ width: screenWidth }}
              renderTabBar={(props) => (
                <TabBar
                  {...props}
                  indicatorStyle={styles.tabIndicator}
                  style={styles.tabBar}
                  scrollEnabled
                />
              )}
            />
          ) : routes[0]?.key === "empty" ? (
            <View style={styles.emptyContainer}>
              <MaterialIcons name="show-chart" size={64} color="#ccc" />
              <Text style={styles.emptyTitle}>No Readings Yet</Text>
              <Text style={styles.emptySubtitle}>
                Take a measurement to see your history here
              </Text>
            </View>
          ) : (
            renderScene({ route: routes[index] || routes[0] })
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
  type: "BP" | "SCALE" | "BG";
  bpThresholds: { systolicHigh: number; diastolicHigh: number };
}) {
  const stats = useMemo(() => {
    if (!data.length) return null;

    const values = data.map((r) => r.value || 0);
    const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const high = Math.max(...values);
    const low = Math.min(...values);

    if (type === "BP") {
      const values2 = data.map((r) => r.value2 || 0);
      const avg2 = Math.round(
        values2.reduce((a, b) => a + b, 0) / values2.length
      );
      const high2 = Math.max(...values2);
      const low2 = Math.min(...values2);

      const hrValues = data
        .filter((r) => r.heartRate != null)
        .map((r) => r.heartRate!);
      const avgHR = hrValues.length
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
  const chronological = useMemo(
    () => [...data].sort((a, b) => a.ts - b.ts),
    [data]
  );

  const numbered: DisplayReading[] = useMemo(
    () =>
      chronological.map((r, i) => ({
        ...r,
        displayNumber: i + 1,
      })),
    [chronological]
  );

  const sortedList = useMemo(
    () =>
      sortAsc
        ? [...numbered].sort((a, b) => a.ts - b.ts)
        : [...numbered].sort((a, b) => b.ts - a.ts),
    [numbered, sortAsc]
  );

  const deviceType = (numbered[0]?.type || "BP") as "BP" | "SCALE" | "BG";
  const chartTheme = CHART_THEMES[deviceType] || CHART_THEMES.DEFAULT;

  const syncedCount = useMemo(
    () => numbered.filter((r) => r.synced).length,
    [numbered]
  );
  const unsyncedCount = numbered.length - syncedCount;

  const values = useMemo(() => {
    if (!numbered.length) return [];
    if (deviceType === "BP") {
      return numbered.flatMap((r) => [
        parseFloat(String(r.value)) || 0,
        parseFloat(String(r.value2)) || 0,
      ]);
    }
    return numbered.map((r) => parseFloat(String(r.value)) || 0);
  }, [numbered, deviceType]);

  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 0;
  const yAxisOffset = Math.max(0, minVal - 10);
  const yAxisMax = maxVal + 10;

  const primaryData = useMemo(
    () =>
      numbered.map((r) => ({
        value: parseFloat(String(r.value)) || 0,
        label: `#${r.displayNumber}`,
        dataPointText: String(r.value ?? ""),
      })),
    [numbered]
  );

  const secondaryData = useMemo(
    () =>
      deviceType === "BP"
        ? numbered.map((r) => ({
            value: parseFloat(String(r.value2)) || 0,
            label: `#${r.displayNumber}`,
            dataPointText: String(r.value2 ?? ""),
          }))
        : [],
    [numbered, deviceType]
  );

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
                      ? `${item.value}/${item.value2} ${item.unit}`
                      : `${item.value} ${item.unit}`}
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

            {numbered.length > 2 && (
              <View style={styles.chartContainer}>
                <View
                  style={[
                    styles.chartInner,
                    { backgroundColor: chartTheme.background },
                  ]}
                >
                  {deviceType === "BP" ? (
                    <LineChart
                      dataSet={[
                        { data: primaryData, color: chartTheme.primary },
                        { data: secondaryData, color: chartTheme.secondary },
                      ]}
                      initialSpacing={20}
                      spacing={Math.max(40, 280 / numbered.length)}
                      thickness={3}
                      height={140}
                      noOfSections={4}
                      curved
                      hideRules={false}
                      yAxisColor={chartTheme.accent}
                      xAxisColor={chartTheme.accent}
                      yAxisTextStyle={{ color: "#fff", fontWeight: "600" }}
                      xAxisLabelTextStyle={{ color: "#fff", fontSize: 10 }}
                      yAxisOffset={yAxisOffset}
                      maxValue={yAxisMax}
                    />
                  ) : (
                    <LineChart
                      data={primaryData}
                      initialSpacing={20}
                      spacing={Math.max(40, 280 / numbered.length)}
                      thickness={3}
                      height={140}
                      noOfSections={4}
                      curved
                      hideRules={false}
                      yAxisColor={chartTheme.accent}
                      xAxisColor={chartTheme.accent}
                      yAxisTextStyle={{ color: "#fff", fontWeight: "600" }}
                      xAxisLabelTextStyle={{ color: "#fff", fontSize: 10 }}
                      color={chartTheme.primary}
                      yAxisOffset={yAxisOffset}
                      maxValue={yAxisMax}
                    />
                  )}
                  {deviceType === "BP" && (
                    <View style={styles.legendRow}>
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: chartTheme.primary },
                          ]}
                        />
                        <Text style={styles.legendText}>Systolic</Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: chartTheme.secondary },
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

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  // Sync Banner - top of screen
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
    paddingVertical: 8,
  },
  singleDeviceTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#002040",
  },
  // Content
  contentContainer: {
    flex: 1,
  },
  // Tabs (for 4+ devices)
  tabBar: {
    backgroundColor: "#002040",
    elevation: 0,
    shadowOpacity: 0,
  },
  tabIndicator: {
    backgroundColor: "#fff",
    height: 3,
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
    marginTop: 12,
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
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 8,
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
    color: "#444",
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
  numberCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#006b6b",
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