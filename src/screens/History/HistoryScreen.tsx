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
} from "react-native";
import { TabView, TabBar } from "react-native-tab-view";
import { useDispatch, useSelector } from "react-redux";
import { loadReadings } from "../../redux/readingSlice";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import RNFS from "react-native-fs";
import Share from "react-native-share";
import { LineChart } from "react-native-gifted-charts";

const screenWidth = Dimensions.get("window").width;

// Enable layout animation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function HistoryScreen() {
  const dispatch = useDispatch();
  const { items } = useSelector((s: any) => s.readings);
  const [index, setIndex] = useState(0);
  const [routes, setRoutes] = useState<any[]>([]);
  const [sortDirections, setSortDirections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    dispatch(loadReadings() as any);
  }, [dispatch]);

  const grouped = useMemo(() => {
    return items.reduce((acc: any, r: any) => {
      if (!acc[r.deviceId]) acc[r.deviceId] = [];
      acc[r.deviceId].push(r);
      return acc;
    }, {});
  }, [items]);

  useEffect(() => {
    const newRoutes = Object.keys(grouped).map((id, i) => ({
      key: id,
      title: grouped[id][0]?.deviceName || `Device ${i + 1}`,
    }));
    setRoutes(newRoutes.length ? newRoutes : [{ key: "empty", title: "No Devices" }]);
  }, [grouped]);

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
        "Timestamp",
      ];
      const rows = items.map((r: any) => [
        r.deviceName || "",
        r.deviceId || "",
        r.type || "",
        r.value ?? "",
        r.value2 ?? "",
        r.unit ?? "",
        r.heartRate ?? "",
        new Date(r.ts).toLocaleString(),
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(
        2,
        "0"
      )}-${String(now.getMinutes()).padStart(2, "0")}`;
      const path = `${RNFS.DocumentDirectoryPath}/TrinityReadings_${timestamp}.csv`;

      await RNFS.writeFile(path, csv, "utf8");
      await Share.open({ url: "file://" + path, type: "text/csv", showAppsToView: true });
    } catch (err: any) {
      Alert.alert("Export failed", err.message || "Unable to export readings.");
    }
  };

  const toggleSort = useCallback((deviceId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSortDirections((prev) => ({ ...prev, [deviceId]: !prev[deviceId] }));
  }, []);

  const renderScene = ({ route }: any) => {
    if (route.key === "empty") {
      return (
        <View style={styles.emptyContainer}>
          <Text style={{ color: "#666" }}>No readings yet.</Text>
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
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>History</Text>
        <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
          <MaterialCommunityIcons name="file-export-outline" size={20} color="#fff" />
          <Text style={styles.exportText}>Export</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        <TabView
          navigationState={{ index, routes }}
          renderScene={renderScene}
          onIndexChange={setIndex}
          initialLayout={{ width: screenWidth }}
          renderTabBar={(props) => (
            <TabBar
              {...props}
              indicatorStyle={{ backgroundColor: "#002040", height: 3 }}
              style={{ backgroundColor: "#e6eef7" }}
              labelStyle={{
                color: "#002040",
                fontWeight: "700",
                textTransform: "none",
              }}
              inactiveColor="#777"
              activeColor="#002040"
              scrollEnabled
            />
          )}
        />
      </View>
    </View>
  );
}

/* ---- Per-device chart & list ---- */
function DeviceHistoryTab({
  data,
  sortAsc,
  onToggleSort,
}: {
  data: any[];
  sortAsc: boolean;
  onToggleSort: () => void;
}) {
  const chronological = useMemo(() => [...data].sort((a, b) => a.ts - b.ts), [data]);
  const numbered = useMemo(
    () => chronological.map((r, i) => ({ ...r, displayNumber: i + 1 })),
    [chronological]
  );

  const sortedList = useMemo(
    () =>
      sortAsc
        ? [...numbered].sort((a, b) => a.ts - b.ts)
        : [...numbered].sort((a, b) => b.ts - a.ts),
    [numbered, sortAsc]
  );

  // dynamic min/max for chart range
  const values = useMemo(() => {
    if (!numbered.length) return [];
    if (numbered[0].type === "BP") {
      return numbered.flatMap((r) => [
        parseFloat(r.value) || 0,
        parseFloat(r.value2) || 0,
      ]);
    }
    return numbered.map((r) => parseFloat(r.value) || 0);
  }, [numbered]);

  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 0;
  const yAxisOffset = Math.max(0, minVal - 10);
  const yAxisMax = maxVal + 10;

  const primaryData = useMemo(
    () =>
      numbered.map((r) => ({
        value: parseFloat(r.value) || 0,
        label: `#${r.displayNumber}`,
        dataPointText: String(r.value ?? ""),
      })),
    [numbered]
  );

  const secondaryData = useMemo(
    () =>
      numbered[0]?.type === "BP"
        ? numbered.map((r) => ({
            value: parseFloat(r.value2) || 0,
            label: `#${r.displayNumber}`,
            dataPointText: String(r.value2 ?? ""),
          }))
        : [],
    [numbered]
  );

  return (
    <View style={styles.scene}>
      {numbered.length > 2 && (
        <View style={styles.chartContainer}>
          <View style={styles.chartInner}>
            <LineChart
              scrollable
              scrollToEnd
              adjustToWidth={false}
              initialSpacing={20}
              spacing={Math.max(40, 280 / numbered.length)}
              thickness={3}
              height={140}
              noOfSections={4}
              curved
              textShiftY={-8}
              hideRules={false} // show horizontal lines
              showVerticalLines={true} // 👈 enable vertical grid lines
              verticalLinesColor="rgba(255,255,255,0.2)"
              yAxisColor="#60809f"
              xAxisColor="#60809f"
              yAxisTextStyle={{ color: "#fff", fontWeight: "600" }}
              xAxisLabelTextStyle={{ color: "#fff", fontSize: 10 }}
              showDataPoints
              showValuesAsDataPointsText={numbered.length <= 15}
              dataPointsShape="circle"
              dataPointsWidth={6}
              dataPointsHeight={6}
              dataPointsRadius={5}
              textColor="#fff"
              dataPointsLabelColor="#fff"
              isAnimated
              animationDuration={600}
              yAxisOffset={yAxisOffset}
              maxValue={yAxisMax}
              {...(numbered[0]?.type === "BP"
                ? {
                    dataSet: [
                      {
                        data: primaryData,
                        color: "#ffba49",
                        dataPointsColor: "#ffba49",
                      },
                      {
                        data: secondaryData,
                        color: "#f5f5f5",
                        dataPointsColor: "#f5f5f5",
                      },
                    ],
                  }
                : {
                    data: primaryData,
                    color: "#f5f5f5",
                    dataPointsColor: "#f5f5f5",
                  })}
            />
            {numbered[0]?.type === "BP" && (
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: "#ffba49" }]} />
                  <Text style={styles.legendText}>Systolic</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: "#f5f5f5" }]} />
                  <Text style={styles.legendText}>Diastolic</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      <View style={styles.metaRow}>
        <Text style={styles.countText}>
          {numbered.length} reading{numbered.length !== 1 ? "s" : ""}
        </Text>
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

      {/* List with numbered circles before values */}
      <FlatList
        data={sortedList}
        keyExtractor={(i: any) => i.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.info}>
              <View style={styles.valueRow}>
                <View style={styles.numberCircle}>
                  <Text style={styles.numberText}>{item.displayNumber}</Text>
                </View>
                <Text style={styles.value}>
                  {item.type === "BP"
                    ? `${item.value}/${item.value2} ${item.unit}`
                    : `${item.value} ${item.unit}`}
                </Text>
              </View>
              <Text style={styles.timeText}>
                {new Date(item.ts).toLocaleDateString([], {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                })}{" "}
                {new Date(item.ts).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </View>
            <View style={styles.statusContainer}>
              <MaterialCommunityIcons
                name="database-check"
                size={24}
                color="#006b6b"
              />
            </View>
          </View>
        )}
      />
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 32,
    paddingBottom: 16,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#002040" },
  exportButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#002040",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 50,
  },
  exportText: { color: "#fff", fontWeight: "700", marginLeft: 6, fontSize: 14 },
  scene: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
  chartContainer: {
    marginBottom: 12,
    marginTop: 12,
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
    paddingLeft: 8,
  },
  chartInner: {
    backgroundColor: "#006b6b",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  legendRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", marginHorizontal: 10 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { color: "#fff", fontSize: 13, fontWeight: "500" },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  countText: { color: "#002040", fontWeight: "600" },
  metaButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "#e6eef7",
  },
  sortText: { color: "#002040", marginLeft: 4, fontWeight: "600", fontSize: 13 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  info: { flex: 1, paddingRight: 10 },
  valueRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  numberCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#006b6b",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  numberText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  value: { fontSize: 18, fontWeight: "600", color: "#002040" },
  timeText: { color: "#777", fontSize: 13 },
  statusContainer: { alignItems: "center", justifyContent: "center", width: 60 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
});
