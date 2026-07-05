import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  ScrollView,
} from "react-native";
import { useSelector, useDispatch } from "react-redux";
import { useStatusBarStyle } from "../../hooks/useStatusBarStyle";
import { loadDevices, removeDevice, renameDevice } from "../../redux/deviceSlice";
import { useToast } from "../../components/Toast";
import RenameDeviceModal from "../../components/RenameDeviceModal";
import type { RootState, AppDispatch } from "../../redux/store";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { BTN } from "../../constants/buttons";

const deviceImages: Record<string, any> = {
  BP: require("../../assets/bp3l.png"),
  SCALE: require("../../assets/hs5s.png"),
  BG: require("../../assets/bg5.png"),
};

const deviceTypeLabels: Record<string, string> = {
  BP: "Blood Pressure",
  SCALE: "Smart Scale",
  BG: "Glucose Meter",
};

function batteryColor(level: number): string {
  if (level < 20) return "#c62828"; // red
  if (level < 50) return "#e0952b"; // amber
  return "#1f8a5b"; // green
}

// Phone-style battery graphic. Renders nothing until a level has been read
// (battery is captured on each device connection). null/unknown => hidden.
function BatteryIndicator({ level }: { level: number | null | undefined }) {
  if (typeof level !== "number" || level < 0 || level > 100) return null;
  const color = batteryColor(level);
  const fillPct = Math.max(6, level); // keep a visible sliver even near 0
  return (
    <View style={styles.batteryRow}>
      <View style={styles.batteryBody}>
        <View
          style={[
            styles.batteryFill,
            { width: `${fillPct}%`, backgroundColor: color },
          ]}
        />
      </View>
      <View style={styles.batteryNub} />
      <Text style={[styles.batteryText, { color }]}>{Math.round(level)}%</Text>
    </View>
  );
}

// Swipeable Device Card Component
function SwipeableDeviceCard({
  device,
  lastReading,
  onCapture,
  onDelete,
  onRename,
}: {
  device: any;
  lastReading: any;
  onCapture: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const [translateX] = useState(new Animated.Value(0));
  const [isOpen, setIsOpen] = useState(false);

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 20;
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dx < 0) {
        translateX.setValue(Math.max(gestureState.dx, -80));
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx < -40) {
        Animated.spring(translateX, {
          toValue: -80,
          useNativeDriver: true,
        }).start();
        setIsOpen(true);
      } else {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
        setIsOpen(false);
      }
    },
  });

  const resetSwipe = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
    setIsOpen(false);
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Device",
      `Are you sure you want to remove "${device.name}"?\n\nThis will not delete any saved readings.`,
      [
        { text: "Cancel", style: "cancel", onPress: resetSwipe },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            resetSwipe();
            onDelete();
          },
        },
      ]
    );
  };

  const handleMenuPress = () => {
    const typeLabel = deviceTypeLabels[device.type] || device.type;
    
    Alert.alert(
      device.name,
      `Type: ${typeLabel}\nMAC: ${device.mac || device.id}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rename",
          onPress: onRename,
        },
        {
          text: "Delete Device",
          style: "destructive",
          onPress: onDelete,
        },
      ]
    );
  };

  const image = deviceImages[device.type] || deviceImages.BP;
  const typeLabel = deviceTypeLabels[device.type] || device.type;

  return (
    <View style={styles.cardContainer}>
      {/* Delete button behind card */}
      <View style={styles.deleteButtonContainer}>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDelete}
          activeOpacity={0.8}
        >
          <MaterialIcons name="delete" size={24} color="#fff" />
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Main card - swipeable */}
      <Animated.View
        style={[styles.card, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Image source={image} style={styles.img} />

        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text style={styles.name}>{device.name}</Text>
            <TouchableOpacity
              style={styles.moreButton}
              onPress={handleMenuPress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name="more-vert" size={22} color="#888" />
            </TouchableOpacity>
          </View>

          <Text style={styles.typeLabel}>{typeLabel}</Text>

          <BatteryIndicator level={device.lastBattery} />

          {lastReading ? (
            <View style={styles.lastReadingRow}>
              <MaterialIcons name="schedule" size={14} color="#888" />
              <Text style={styles.meta}>
                {lastReading.type === "BP"
                  ? `${lastReading.value}/${lastReading.value2} ${lastReading.unit}`
                  : `${lastReading.value} ${lastReading.unit}${
                      lastReading.type === "BG" && lastReading.measurementCondition
                        ? ` - ${lastReading.measurementCondition}`
                        : ""
                    }`}{" "}
                · {new Date(lastReading.ts).toLocaleDateString()}
              </Text>
            </View>
          ) : (
            <View style={styles.lastReadingRow}>
              <MaterialIcons name="info-outline" size={14} color="#aaa" />
              <Text style={styles.metaEmpty}>No readings yet</Text>
            </View>
          )}

          <View style={styles.row}>
            <TouchableOpacity
              style={styles.newReadingButton}
              onPress={onCapture}
              activeOpacity={0.8}
            >
              <MaterialIcons name="play-arrow" size={20} color="#fff" />
              <Text style={styles.primaryText}>Capture</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {/* Tap outside to close swipe */}
      {isOpen && (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={resetSwipe}
          activeOpacity={1}
        />
      )}
    </View>
  );
}

export default function DevicesScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { showToast } = useToast();

  // Dark blue header → white status-bar glyphs.
  useStatusBarStyle("light-content");
  const { devices, loading } = useSelector((state: RootState) => state.devices);
  const readings = useSelector((state: RootState) => state.readings.items);

  // Rename modal state
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [deviceToRename, setDeviceToRename] = useState<any>(null);

  useEffect(() => {
    dispatch(loadDevices());
  }, [dispatch]);

  function getLastReading(deviceId: string) {
    const list = readings.filter((r: any) => r.deviceId === deviceId);
    if (!list.length) return null;
    list.sort((a: any, b: any) => b.ts - a.ts);
    return list[0];
  }

  const handleRenamePress = (device: any) => {
    setDeviceToRename(device);
    setRenameModalVisible(true);
  };

  const handleRenameConfirm = (newName: string) => {
    if (deviceToRename) {
      dispatch(renameDevice({ deviceId: deviceToRename.id, newName }));
      showToast({
        message: `Device renamed to "${newName}"`,
        type: "success",
        duration: 2500,
      });
    }
    setRenameModalVisible(false);
    setDeviceToRename(null);
  };

  const handleRenameCancel = () => {
    setRenameModalVisible(false);
    setDeviceToRename(null);
  };

  if (loading) {
    return (
      <ImageBackground
        source={require("../../assets/background.png")}
        style={styles.image}
        resizeMode="cover"
      >
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#00509f" />
          <Text style={styles.loadingText}>Loading devices…</Text>
        </View>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground
      source={require("../../assets/background.png")}
      style={styles.image}
      resizeMode="cover"
    >
      <ScrollView
        // Native stack header already consumes the safe-area top.
        contentContainerStyle={[styles.scrollContent, { paddingTop: 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Row */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>Your Devices</Text>
          <View style={styles.headerActions}>
            {__DEV__ ? (
              <TouchableOpacity
                style={styles.debugButton}
                onPress={() => navigation.navigate("BG5SDebug")}
                activeOpacity={0.8}
              >
                <MaterialIcons name="bug-report" size={20} color="#00509f" />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => navigation.navigate("AddDevice")}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add" size={20} color="#fff" />
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Device List or Empty State */}
        {devices.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <MaterialIcons name="bluetooth-searching" size={48} color="#00509f" />
            </View>
            <Text style={styles.emptyTitle}>No Devices Yet</Text>
            <Text style={styles.emptySubtitle}>
              Add your devices to start tracking your health.
            </Text>
            <TouchableOpacity
              style={styles.emptyAddButton}
              onPress={() => navigation.navigate("AddDevice")}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add-circle" size={22} color="#fff" />
              <Text style={styles.emptyAddButtonText}>Add Your First Device</Text>
            </TouchableOpacity>
          </View>
        ) : (
          devices.map((d) => {
            const last = getLastReading(d.id);

            return (
              <SwipeableDeviceCard
                key={d.id}
                device={d}
                lastReading={last}
                onCapture={() => navigation.navigate("Capture", { deviceId: d.id })}
                onDelete={() => dispatch(removeDevice(d.id))}
                onRename={() => handleRenamePress(d)}
              />
            );
          })
        )}
      </ScrollView>

      {/* Rename Modal */}
      <RenameDeviceModal
        visible={renameModalVisible}
        currentName={deviceToRename?.name || ""}
        deviceType={deviceToRename?.type || "BP"}
        onRename={handleRenameConfirm}
        onCancel={handleRenameCancel}
      />
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  image: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#666",
    fontSize: 15,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  debugButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(0, 80, 159, 0.18)",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1a1a2e",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: BTN.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: BTN.radius,
    shadowColor: "#00509f",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "600",
    marginLeft: 4,
    fontSize: 15,
  },
  cardContainer: {
    marginBottom: 12,
    position: "relative",
  },
  deleteButtonContainer: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButton: {
    backgroundColor: BTN.destructive,
    width: 70,
    height: "90%",
    borderRadius: BTN.radius,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  card: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  img: {
    width: 64,
    height: 64,
    marginRight: 14,
    borderRadius: 12,
    backgroundColor: "#f5f5f5",
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  name: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1a1a2e",
    flex: 1,
  },
  moreButton: {
    padding: 4,
    marginTop: -4,
    marginRight: -4,
  },
  typeLabel: {
    fontSize: 13,
    color: "#00509f",
    fontWeight: "500",
    marginTop: 2,
  },
  batteryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  batteryBody: {
    width: 26,
    height: 13,
    borderWidth: 1.5,
    borderColor: "#9aa7b5",
    borderRadius: 3,
    padding: 1.5,
    justifyContent: "center",
  },
  batteryFill: {
    height: "100%",
    borderRadius: 1.5,
  },
  batteryNub: {
    width: 2.5,
    height: 5,
    backgroundColor: "#9aa7b5",
    borderTopRightRadius: 1,
    borderBottomRightRadius: 1,
    marginLeft: 1,
  },
  batteryText: {
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 6,
  },
  lastReadingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 4,
  },
  meta: {
    color: "#666",
    fontSize: 13,
  },
  metaEmpty: {
    color: "#aaa",
    fontSize: 13,
    fontStyle: "italic",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  newReadingButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BTN.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: BTN.radius,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  primaryText: {
    color: "#fff",
    fontWeight: "600",
    marginLeft: 4,
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 100,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(0, 80, 159, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a2e",
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyAddButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: BTN.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: BTN.radius,
    shadowColor: "#00509f",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  emptyAddButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
    marginLeft: 8,
  },
});
