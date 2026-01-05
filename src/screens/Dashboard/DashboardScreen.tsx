/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState } from "react";
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
import { getDailyTip } from "../../utils/getDailyTip";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { loadReadings } from "../../redux/readingSlice";
import { loadDevices } from "../../redux/deviceSlice";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { AppDispatch, RootState } from "../../redux/store";

// Map device types to images
const deviceImages: Record<string, any> = {
  BP: require("../../assets/bp3l.png"),
  BP3L: require("../../assets/bp3l.png"),
  BP5: require("../../assets/bp3l.png"),
  BP5S: require("../../assets/bp3l.png"),
  SCALE: require("../../assets/hs5s.png"),
  HS2: require("../../assets/hs5s.png"),
  HS2S: require("../../assets/hs5s.png"),
  HS4S: require("../../assets/hs5s.png"),
  BG: require("../../assets/bg5.png"),
  BG5: require("../../assets/bg5.png"),
  BG5S: require("../../assets/bg5.png"),
};

// Friendly names for device types
const deviceTypeNames: Record<string, string> = {
  BP: "Blood Pressure",
  BP3L: "Blood Pressure",
  BP5: "Blood Pressure",
  BP5S: "Blood Pressure",
  SCALE: "Smart Scale",
  HS2: "Smart Scale",
  HS2S: "Smart Scale",
  HS4S: "Smart Scale",
  BG: "Glucose Meter",
  BG5: "Glucose Meter",
  BG5S: "Glucose Meter",
};

export default function DashboardScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();

  // FIX: Use correct Redux state path - 'devices' not 'items'
  const readings = useSelector((state: RootState) => state.readings.items);
  const devices = useSelector((state: RootState) => state.devices.devices);
  const [todayTip, setTodayTip] = useState<string>("");

  useEffect(() => {
    getDailyTip().then(setTodayTip);
  }, []);

  useEffect(() => {
    if (isFocused) {
      dispatch(loadReadings());
      dispatch(loadDevices());
    }
  }, [dispatch, isFocused]);

  // Debug log to verify devices are loading
  useEffect(() => {
    console.log('[Dashboard] Devices loaded:', devices?.length, devices);
  }, [devices]);

  const lastBP = readings
    ?.filter((r: any) => r.type === "BP")
    .sort((a: any, b: any) => b.ts - a.ts)[0];

  const lastScale = readings
    ?.filter((r: any) => r.type === "SCALE")
    .sort((a: any, b: any) => b.ts - a.ts)[0];

  const lastBG = readings
    ?.filter((r: any) => r.type === "BG")
    .sort((a: any, b: any) => b.ts - a.ts)[0];

  const deviceList = devices || [];
  const deviceCount = deviceList.length;

  // Helper to get device type from device object
  const getDeviceType = (device: any): string => {
    // Check device.type first (from DB)
    if (device.type && deviceImages[device.type]) {
      return device.type;
    }
    // Try to extract from name (e.g., "BP3L", "HS2S 12345")
    const nameParts = device.name?.split(" ") || [];
    if (nameParts[0] && deviceImages[nameParts[0]]) {
      return nameParts[0];
    }
    // Fallback based on general type
    if (device.type === "BP") return "BP3L";
    if (device.type === "SCALE") return "HS2S";
    if (device.type === "BG") return "BG5";
    return "BP3L"; // ultimate fallback
  };

  // Get image for device
  const getDeviceImage = (device: any) => {
    const deviceType = getDeviceType(device);
    return deviceImages[deviceType] || deviceImages.BP;
  };

  // Get friendly name for device
  const getDeviceFriendlyName = (device: any) => {
    const deviceType = getDeviceType(device);
    return deviceTypeNames[deviceType] || device.name || "Device";
  };

  return (
    <ImageBackground
      source={require("../../assets/dashbg.png")}
      style={styles.image}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
        
        
        <Text style={styles.sectionTitle}>{deviceCount} {deviceCount === 1 ? "Device" : "Devices"} Saved</Text>
        
          {/* --- Device Card --- */}
          <View style={styles.deviceCard}>
            {deviceCount > 0 ? (
              <>
                <View style={styles.deviceRow}>
                  {deviceList.slice(0, 4).map((device: any, index: number) => {
                    const imageSource = getDeviceImage(device);
                    const friendlyName = getDeviceFriendlyName(device);
                    return (
                      <TouchableOpacity 
                        key={device.id || index} 
                        style={styles.deviceItem}
                        onPress={() => navigation.navigate("Devices", { 
                          screen: "Capture", 
                          params: { deviceId: device.id } 
                        })}
                        activeOpacity={0.7}
                      >
                        <Image
                          source={imageSource}
                          style={styles.deviceIcon}
                        />
                        <Text style={styles.deviceName} numberOfLines={2}>
                          {friendlyName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {deviceCount > 4 && (
                  <Text style={styles.moreDevices}>
                    +{deviceCount - 4} more
                  </Text>
                )}
              </>
            ) : (
              <TouchableOpacity 
                style={styles.noDevicesContainer}
                onPress={() => navigation.navigate("Devices", { screen: "AddDevice" })}
                activeOpacity={0.7}
              >
                <MaterialIcons name="devices-other" size={48} color="#ccc" />
                <Text style={styles.noDevicesText}>No devices added yet</Text>
                <View style={styles.addDevicePrompt}>
                  <MaterialIcons name="add-circle" size={20} color="#00509f" />
                  <Text style={styles.addDeviceText}>Tap here to add your first device.</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* --- Latest Readings Section --- */}
          <View style={styles.readingsContainer}>
            <Text style={styles.sectionTitle}>Latest Readings</Text>

            {lastBP || lastScale || lastBG ? (
              <>
                {lastBP && (
                  <View style={styles.readingItem}>
                    <View style={styles.readingHeader}>
                      <View style={[styles.readingIcon, { backgroundColor: '#ffebee' }]}>
                        <MaterialIcons name="favorite" size={18} color="#e53935" />
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
                    </View>
                    <Text style={styles.readingValue}>
                      {lastBP.value}/{lastBP.value2} <Text style={styles.readingUnit}>{lastBP.unit}</Text>
                    </Text>
                    {lastBP.heartRate && (
                        <Text style={styles.readingSecondary}>Pulse: {lastBP.heartRate} bpm</Text>
                    )}
                  </View>
                )}

                {lastScale && (
                  <View style={styles.readingItem}>
                    <View style={styles.readingHeader}>
                      <View style={[styles.readingIcon, { backgroundColor: '#e0f7fa' }]}>
                        <MaterialIcons name="fitness-center" size={18} color="#00acc1" />
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
                      {lastScale.value} <Text style={styles.readingUnit}>{lastScale.unit}</Text>
                    </Text>
                  </View>
                )}

                {lastBG && (
                  <View style={styles.readingItem}>
                    <View style={styles.readingHeader}>
                      <View style={[styles.readingIcon, { backgroundColor: '#e8f5e9' }]}>
                        <MaterialIcons name="water-drop" size={18} color="#43a047" />
                      </View>
                      <View style={styles.readingInfo}>
                        <Text style={styles.readingDevice}>
                          {lastBG.deviceName || "Glucose Meter"}
                        </Text>
                        <Text style={styles.readingTime}>
                          {new Date(lastBG.ts).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          {new Date(lastBG.ts).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.readingValue}>
                      {lastBG.value} <Text style={styles.readingUnit}>{lastBG.unit}</Text>
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

          {/* --- New Reading Button --- */}
          <TouchableOpacity
            style={styles.newReadingButton}
            activeOpacity={0.8}
            onPress={() =>
              navigation.navigate("Devices", { screen: "DevicesMain" })
            }
          >
            <MaterialIcons name="add-circle-outline" size={22} color="#fff" />
            <Text style={styles.newReadingText}>New Reading</Text>
          </TouchableOpacity>

          {/* --- Daily Tip Section --- */}
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
        </ScrollView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  image: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  scrollContainer: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 60,
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
    marginBottom: 24,
    minHeight: 140,
  },
  welcome: {
    fontSize: 26,
    fontWeight: "700",
    color: "#00509f",
    marginBottom: 16,
    textAlign: "center",
  },
  deviceRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-start",
    flexWrap: "wrap",
    width: "100%",
    marginBottom: 12,
    gap: 16,
  },
  deviceItem: {
    alignItems: "center",
    width: 70,
  },
  deviceIcon: {
    width: 56,
    height: 56,
    resizeMode: "contain",
    marginBottom: 4,
  },
  deviceName: {
    fontSize: 11,
    color: "#666",
    textAlign: "center",
    marginTop: 4,
  },
  deviceLabel: {
    color: "#00509f",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  moreDevices: {
    color: "#888",
    fontSize: 13,
    marginTop: 4,
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
  readingsContainer: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
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
  readingValue: {
    fontSize: 28,
    fontWeight: "700",
    color: "#222",
    marginTop: 4,
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
    backgroundColor: "rgba(255,255,255,0.8)",
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
  newReadingButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    backgroundColor: "#002040",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  newReadingText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  tipCard: {
    backgroundColor: "rgba(0, 80, 159, 0.08)",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#00509f",
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
});
