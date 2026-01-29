/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
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
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean>(false);

  // Urine Protein Modal State
  const [showUrineProteinModal, setShowUrineProteinModal] = useState(false);
  const [showUrineProteinAlert, setShowUrineProteinAlert] = useState(false);

  useEffect(() => {
    getDailyTip().then(setTodayTip);

    // Check first launch status
    const firstLaunch = getIsFirstLaunch();
    setIsFirstLaunch(firstLaunch);
    if (firstLaunch) {
      setFirstLaunchComplete();
    }
  }, []);

  // Check for urine protein modal on focus
  const checkUrineProteinStatus = useCallback(() => {
    const needsResponse = needsUrineProteinResponse();
    const hasDeferred = hasUrineProteinDeferredToday();
    console.log("[Dashboard] Urine protein check:", { needsResponse, hasDeferred });

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
  }, []);

  useEffect(() => {
    if (isFocused) {
      dispatch(loadReadings());
      dispatch(loadDevices());
      checkUrineProteinStatus();
    }
  }, [dispatch, isFocused, checkUrineProteinStatus]);

  useEffect(() => {
    console.log("[Dashboard] Devices loaded:", devices?.length, devices);
  }, [devices]);

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

  const handleUrineProteinComplete = (result: string) => {
    console.log("[Dashboard] Urine protein result:", result);
    setShowUrineProteinModal(false);
    setShowUrineProteinAlert(false);
  };

  const handleUrineProteinDefer = () => {
    console.log("[Dashboard] Urine protein deferred");
    setShowUrineProteinModal(false);
    setShowUrineProteinAlert(true);
  };

  const handleAlertBarTap = () => {
    setShowUrineProteinModal(true);
  };

  const firstName = user.firstName || "there";
  const welcomeMessage = isFirstLaunch
    ? `Welcome, ${firstName}`
    : `Welcome back, ${firstName}!`;

  return (
    <ImageBackground
      source={require("../../assets/background.png")}
      style={styles.image}
      resizeMode="cover"
    >
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContainer,
            { paddingTop: insets.top + 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Welcome Header */}
          <Text style={styles.welcomeText}>{welcomeMessage}</Text>

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

          {/* Maternal Wellness Daily Tip */}
          <View style={styles.tipCard}>
            <View style={styles.tipHeader}>
              <MaterialIcons
                name="health-and-safety"
                size={22}
                color="#002040"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.tipTitle}>Maternal Wellness Daily</Text>
            </View>
            <Text style={styles.tipText}>{todayTip}</Text>
          </View>

          {/* Latest Readings Section */}
          <View style={styles.readingsContainer}>
            <Text style={styles.sectionTitle}>Latest Readings</Text>
            {lastBP || lastScale ? (
              <>
                {lastBP && (
                  <View
                    style={[
                      styles.readingItem,
                      isBPReadingHigh(lastBP) && styles.readingItemHigh,
                    ]}
                  >
                    <View style={styles.readingHeader}>
                      <View
                        style={[
                          styles.readingIcon,
                          {
                            backgroundColor: isBPReadingHigh(lastBP)
                              ? "#ffcdd2"
                              : "#ffebee",
                          },
                        ]}
                      >
                        <MaterialIcons
                          name="favorite"
                          size={18}
                          color={isBPReadingHigh(lastBP) ? "#c62828" : "#e53935"}
                        />
                      </View>
                      <View style={styles.readingInfo}>
                        <Text style={styles.readingDevice}>
                          {lastBP.deviceName || "Blood Pressure"}
                        </Text>
                        <Text style={styles.readingTime}>
                          {new Date(lastBP.ts).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          {new Date(lastBP.ts).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </Text>
                      </View>
                      {isBPReadingHigh(lastBP) && (
                        <View style={styles.highBadge}>
                          <Text style={styles.highBadgeText}>HIGH</Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.readingValue,
                        isBPReadingHigh(lastBP) && styles.readingValueHigh,
                      ]}
                    >
                      {lastBP.value}/{lastBP.value2}
                      <Text style={styles.readingUnit}> {lastBP.unit}</Text>
                    </Text>
                    {lastBP.heartRate && (
                      <Text style={styles.readingSecondary}>
                        Pulse: {lastBP.heartRate} bpm
                      </Text>
                    )}
                  </View>
                )}

                {lastScale && (
                  <View style={styles.readingItem}>
                    <View style={styles.readingHeader}>
                      <View
                        style={[styles.readingIcon, { backgroundColor: "#e0f7fa" }]}
                      >
                        <MaterialIcons
                          name="fitness-center"
                          size={18}
                          color="#00acc1"
                        />
                      </View>
                      <View style={styles.readingInfo}>
                        <Text style={styles.readingDevice}>
                          {lastScale.deviceName || "Scale"}
                        </Text>
                        <Text style={styles.readingTime}>
                          {new Date(lastScale.ts).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          {new Date(lastScale.ts).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.readingValue}>
                      {lastScale.value}
                      <Text style={styles.readingUnit}> {lastScale.unit}</Text>
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noReadingsContainer}>
                <MaterialIcons name="show-chart" size={32} color="#ccc" />
                <Text style={styles.noReadingsText}>No readings yet</Text>
                <Text style={styles.noReadingsHint}>
                  Take your first measurement to see it here
                </Text>
              </View>
            )}
          </View>

          {/* My Devices Section */}
          <Text style={styles.sectionTitle}>My Devices</Text>
          <View style={styles.deviceCard}>
            {deviceCount > 0 ? (
              <>
                <View style={styles.deviceRow}>
                  {deviceList.slice(0, 4).map((device: any, index: number) => {
                    const imageSource = getDeviceImage(device);
                    const friendlyName = getDeviceFriendlyName(device);
                    const sourceBadge = getSourceBadge(device);
                    return (
                      <TouchableOpacity
                        key={device.id || index}
                        style={styles.deviceItem}
                        onPress={() =>
                          navigation.navigate("Devices", {
                            screen: "Capture",
                            params: { deviceId: device.id },
                          })
                        }
                        activeOpacity={0.7}
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
                        <Text style={styles.deviceName} numberOfLines={2}>
                          {friendlyName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {deviceCount > 4 && (
                  <Text style={styles.moreDevices}>+{deviceCount - 4} more</Text>
                )}
              </>
            ) : (
              <TouchableOpacity
                style={styles.noDevicesContainer}
                onPress={() =>
                  navigation.navigate("Devices", { screen: "AddDevice" })
                }
                activeOpacity={0.7}
              >
                <MaterialIcons name="devices-other" size={48} color="#ccc" />
                <Text style={styles.noDevicesText}>No devices added yet</Text>
                <View style={styles.addDevicePrompt}>
                  <MaterialIcons name="add-circle" size={20} color="#00509f" />
                  <Text style={styles.addDeviceText}>
                    Tap to add your first device
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* Spacer for fixed button */}
          <View style={{ height: 80 }} />
        </ScrollView>

        {/* Fixed New Reading Button */}
        <View style={[styles.fixedButtonContainer, { paddingBottom: 8 }]}>
          <TouchableOpacity
            style={styles.newReadingButton}
            activeOpacity={0.8}
            onPress={() => navigation.navigate("Devices", { screen: "DevicesMain" })}
          >
            <MaterialIcons name="add-circle-outline" size={22} color="#fff" />
            <Text style={styles.newReadingText}>New Reading</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Urine Protein Modal */}
      <UrineProteinModal
        visible={showUrineProteinModal}
        onComplete={handleUrineProteinComplete}
        onDefer={handleUrineProteinDefer}
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
  container: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  scrollContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: "700",
    color: "#00468c",
    marginBottom: 20,
  },
  alertBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
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
  tipCard: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: "#00509f",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  tipHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#00509f",
  },
  tipText: {
    fontSize: 15,
    color: "#444",
    lineHeight: 22,
  },
  readingsContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#00468c",
    marginBottom: 12,
  },
  readingItem: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  readingItemHigh: {
    borderWidth: 2,
    borderColor: "#ef5350",
    backgroundColor: "rgba(255,235,238,0.95)",
  },
  readingHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  readingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  readingInfo: {
    flex: 1,
  },
  readingDevice: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  readingTime: {
    color: "#888",
    fontSize: 12,
    marginTop: 2,
  },
  highBadge: {
    backgroundColor: "#c62828",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  highBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  readingValue: {
    fontSize: 28,
    fontWeight: "700",
    color: "#222",
    marginTop: 4,
  },
  readingValueHigh: {
    color: "#c62828",
  },
  readingUnit: {
    fontSize: 16,
    fontWeight: "400",
    color: "#666",
  },
  readingSecondary: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  noReadingsContainer: {
    alignItems: "center",
    paddingVertical: 24,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 12,
  },
  noReadingsText: {
    fontSize: 16,
    color: "#999",
    marginTop: 8,
  },
  noReadingsHint: {
    fontSize: 13,
    color: "#bbb",
    marginTop: 4,
  },
  deviceCard: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 16,
    minHeight: 120,
  },
  deviceRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-start",
    flexWrap: "wrap",
    width: "100%",
    gap: 16,
  },
  deviceItem: {
    alignItems: "center",
    width: 70,
  },
  deviceImageWrapper: {
    position: "relative",
  },
  deviceIcon: {
    width: 56,
    height: 56,
    resizeMode: "contain",
    marginBottom: 4,
  },
  sourceBadge: {
    position: "absolute",
    bottom: 2,
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
    color: "#666",
    textAlign: "center",
    marginTop: 4,
  },
  moreDevices: {
    color: "#888",
    fontSize: 13,
    marginTop: 12,
  },
  noDevicesContainer: {
    alignItems: "center",
    paddingVertical: 16,
  },
  noDevicesText: {
    fontSize: 16,
    color: "#999",
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
    color: "#00509f",
    fontWeight: "500",
  },
  fixedButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    backgroundColor: "transparent",
  },
  newReadingButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#002040",
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  newReadingText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    marginLeft: 10,
  },
});