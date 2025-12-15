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
} from "react-native";
import { TabView, TabBar } from "react-native-tab-view";
import { useDispatch, useSelector } from "react-redux";
import { loadReadings } from "../../redux/readingSlice";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import RNFS from "react-native-fs";
import Share from "react-native-share";
import { LineChart } from "react-native-gifted-charts";
import {
  onSyncStateChange,
  forceSyncAll,
} from "../../services/VitalsSyncService";
import type { RootState, AppDispatch } from "../../redux/store";
import type { SavedReading } from "../../services/sqliteService";

const screenWidth = Dimensions.get("window").width;

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

export default function HistoryScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const { items } = useSelector((state: RootState) => state.readings);
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
      // Refresh readings list when sync completes
      if (state.status === "idle" && state.pendingCount === 0) {
        dispatch(loadReadings());
      }
    });
    return unsubscribe;
  }, [dispatch]);

  useEffect(() => {
    dispatch(loadReadings());
  }, [dispatch]);

  const grouped = useMemo(() => {
    return items.reduce(
      (acc: Record<string, SavedReading[]>, r: SavedReading) => {
        if (!acc[r.deviceId]) acc[r.deviceId] = [];
        acc[r.deviceId].push(r);
        return acc;
      },
      {}
    );
  }, [items]);

  useEffect(() => {
    const newRoutes: TabRoute[] = Object.keys(grouped).map((id, i) => ({
      key: id,
      title: grouped[id][0]?.deviceName || `Device ${i + 1}`,
    }));
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

  const toggleSort = useCallback((deviceId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSortDirections((prev) => ({ ...prev, [deviceId]: !prev[deviceId] }));
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

    const deviceReadings = grouped[route.key] || [];
    const sortAsc = sortDirections[route.key] ?? false;

    return (
      <DeviceHistoryTab
        data={deviceReadings}
        sortAsc={sortAsc}
        onToggleSort={() => toggleSort(route.key)}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    );
  };

  const pendingCount = syncState.pendingCount;
  const isSyncing = syncState.status === "syncing";
  const isOffline = syncState.status === "offline";

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>History</Text>
        <View style={styles.headerButtons}>
          {/* Sync Button - only show if there are pending readings */}
          {pendingCount > 0 && (
            <TouchableOpacity
              style={[
                styles.syncButton,
                isSyncing && styles.syncButtonDisabled,
                isOffline && styles.syncButtonOffline,
              ]}
              onPress={handleSync}
              disabled={isSyncing || isOffline}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons
                  name={isOffline ? "cloud-off-outline" : "cloud-upload"}
                  size={18}
                  color="#fff"
                />
              )}
              <Text style={styles.syncButtonText}>
                {isSyncing
                  ? "Syncing..."
                  : isOffline
                  ? "Offline"
                  : `Sync ${pendingCount}`}
              </Text>
            </TouchableOpacity>
          )}

          {/* Export Button */}
          <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
            <MaterialCommunityIcons
              name="file-export-outline"
              size={20}
              color="#fff"
            />
            <Text style={styles.exportText}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sync Status Banner */}
      {syncState.lastError && pendingCount > 0 && (
        <View style={styles.errorBanner}>
          <MaterialIcons name="warning" size={16} color="#f57c00" />
          <Text style={styles.errorBannerText}>
            {pendingCount} reading{pendingCount !== 1 ? "s" : ""} pending sync
          </Text>
          <TouchableOpacity onPress={handleSync}>
            <Text style={styles.errorBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.tabContainer}>
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
      </View>
    </View>
  );
}

/* ---- Summary Stats Component ---- */
function SummaryStats({
  data,
  type,
}: {
  data: SavedReading[];
  type: "BP" | "SCALE" | "BG";
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

      return { avg, high, low, avg2, high2, low2, avgHR };
    }

    return { avg, high, low };
  }, [data, type]);

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
          <MaterialCommunityIcons name="heart-pulse" size={16} color="#e53935" />
          <Text style={styles.statLabel}>Avg HR</Text>
          <Text style={styles.statValue}>{stats.avgHR}</Text>
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
}: {
  data: SavedReading[];
  sortAsc: boolean;
  onToggleSort: () => void;
  refreshing: boolean;
  onRefresh: () => void;
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

  const deviceType = numbered[0]?.type || "BP";

  // Count synced/unsynced
  const syncedCount = useMemo(
    () => numbered.filter((r) => r.synced).length,
    [numbered]
  );
  const unsyncedCount = numbered.length - syncedCount;

  // dynamic min/max for chart range
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

  const renderItem = useCallback(
    ({ item }: { item: DisplayReading }) => (
      <View style={styles.row}>
        <View style={styles.info}>
          <View style={styles.valueRow}>
            <View style={styles.numberCircle}>
              <Text style={styles.numberText}>{item.displayNumber}</Text>
            </View>
            <View style={styles.valueColumn}>
              <Text style={styles.value}>
                {item.type === "BP"
                  ? `${item.value}/${item.value2} ${item.unit}`
                  : `${item.value} ${item.unit}`}
              </Text>
              {item.type === "BP" && item.heartRate != null && (
                <View style={styles.heartRateRow}>
                  <MaterialCommunityIcons
                    name="heart-pulse"
                    size={14}
                    color="#e53935"
                  />
                  <Text style={styles.heartRateText}>{item.heartRate} BPM</Text>
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
    ),
    []
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
            {/* Summary Stats */}
            {numbered.length > 0 && (
              <SummaryStats data={data} type={deviceType} />
            )}

            {/* Chart */}
            {numbered.length > 2 && (
              <View style={styles.chartContainer}>
                <View style={styles.chartInner}>
                  {deviceType === "BP" ? (
                    <LineChart
                      dataSet={[
                        {
                          data: primaryData,
                          color: "#ffba49",
                        },
                        {
                          data: secondaryData,
                          color: "#f5f5f5",
                        },
                      ]}
                      initialSpacing={20}
                      spacing={Math.max(40, 280 / numbered.length)}
                      thickness={3}
                      height={140}
                      noOfSections={4}
                      curved
                      hideRules={false}
                      yAxisColor="#60809f"
                      xAxisColor="#60809f"
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
                      yAxisColor="#60809f"
                      xAxisColor="#60809f"
                      yAxisTextStyle={{ color: "#fff", fontWeight: "600" }}
                      xAxisLabelTextStyle={{ color: "#fff", fontSize: 10 }}
                      color="#f5f5f5"
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
                            { backgroundColor: "#ffba49" },
                          ]}
                        />
                        <Text style={styles.legendText}>Systolic</Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: "#f5f5f5" },
                          ]}
                        />
                        <Text style={styles.legendText}>Diastolic</Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Meta row */}
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
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#002040",
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ff9800",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 6,
  },
  syncButtonDisabled: {
    backgroundColor: "#bdbdbd",
  },
  syncButtonOffline: {
    backgroundColor: "#9e9e9e",
  },
  syncButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
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
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff3e0",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    color: "#e65100",
    fontSize: 13,
  },
  errorBannerAction: {
    color: "#1976d2",
    fontWeight: "600",
    fontSize: 13,
  },
  tabContainer: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: "#fff",
    elevation: 0,
    shadowOpacity: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  tabIndicator: {
    backgroundColor: "#002040",
    height: 3,
  },
  scene: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  // Summary Stats
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#fff",
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
    backgroundColor: "#006b6b",
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
    backgroundColor: "#fff",
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
    backgroundColor: "#fff",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
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