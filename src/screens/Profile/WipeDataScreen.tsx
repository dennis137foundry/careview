// src/screens/Profile/WipeDataScreen.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Alert,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { useDispatch } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logout } from "../../redux/userSlice";
import { wipeAllPatientData } from "../../services/sqliteService";
import type { AppDispatch } from "../../redux/store";

export default function WipeDataScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const insets = useSafeAreaInsets();
  const [confirmed, setConfirmed] = useState(false);
  const [wiping, setWiping] = useState(false);

  const handleWipe = () => {
    Alert.alert(
      "Final Confirmation",
      "This will permanently delete all local data and sign you out. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Wipe & Sign Out",
          style: "destructive",
          onPress: performWipe,
        },
      ],
    );
  };

  const performWipe = async () => {
    try {
      setWiping(true);

      // Clear all local SQLite data (readings, devices, screenings, app_settings)
      wipeAllPatientData();

      // Clear profile photo from AsyncStorage
      await AsyncStorage.multiRemove(["careview_profile_photo"]);

      // Dispatch logout (clears user table + resets Redux → navigates to Auth)
      dispatch(logout());
    } catch (error) {
      console.error("[WipeData] Wipe failed:", error);
      setWiping(false);
      Alert.alert("Error", "Unable to wipe data. Please try again.");
    }
  };

  return (
    <ImageBackground
      source={require("../../assets/background.png")}
      style={styles.image}
      resizeMode="cover"
    >
      <StatusBar barStyle="dark-content" />

      {/* Fixed header above scroll */}
      <View style={[styles.headerRow, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          activeOpacity={0.7}
        >
          <MaterialIcons name="arrow-back" size={24} color="#00468c" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sign Out & Wipe Data</Text>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Warning icon */}
        <View style={styles.warningIconContainer}>
          <MaterialIcons name="warning" size={48} color="#e53935" />
        </View>

        {/* Explanation card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Before You Continue</Text>

          <View style={styles.bulletRow}>
            <MaterialIcons name="cloud-done" size={20} color="#0066CC" />
            <Text style={styles.bulletText}>
              Measurements and readings collected by this app are synced to
              Trinity CareView EMR for retention and reporting.
            </Text>
          </View>

          <View style={styles.bulletRow}>
            <MaterialIcons name="phone-android" size={20} color="#0066CC" />
            <Text style={styles.bulletText}>
              This feature will only clear measurements and readings collected on
              the local device — not the EMR.
            </Text>
          </View>

          <View style={styles.bulletRow}>
            <MaterialIcons name="sync-problem" size={20} color="#e53935" />
            <Text style={[styles.bulletText, styles.warningText]}>
              Any unsynced readings will be lost.
            </Text>
          </View>

          <View style={styles.bulletRow}>
            <MaterialIcons name="delete-forever" size={20} color="#e53935" />
            <Text style={[styles.bulletText, styles.warningText]}>
              Wiped data cannot be retrieved.
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.bulletRow}>
            <MaterialIcons name="support-agent" size={20} color="#0066CC" />
            <Text style={styles.bulletText}>
              For more information, contact Trinity Home Health Services for
              additional guidance.
            </Text>
          </View>
        </View>

        {/* Confirmation checkbox */}
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setConfirmed(!confirmed)}
          activeOpacity={0.7}
        >
          <View
            style={[styles.checkbox, confirmed && styles.checkboxChecked]}
          >
            {confirmed && (
              <MaterialIcons name="check" size={16} color="#fff" />
            )}
          </View>
          <Text style={styles.checkboxLabel}>
            I understand that local data will be permanently deleted
          </Text>
        </TouchableOpacity>

        {/* Wipe button */}
        <TouchableOpacity
          style={[
            styles.wipeButton,
            (!confirmed || wiping) && styles.wipeButtonDisabled,
          ]}
          onPress={handleWipe}
          disabled={!confirmed || wiping}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="delete-forever"
            size={22}
            color={confirmed && !wiping ? "#fff" : "rgba(255,255,255,0.5)"}
          />
          <Text
            style={[
              styles.wipeButtonText,
              (!confirmed || wiping) && styles.wipeButtonTextDisabled,
            ]}
          >
            {wiping ? "Wiping Data..." : "Wipe Data & Sign Out"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#00468c",
  },
  warningIconContainer: {
    alignItems: "center",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a2a3a",
    marginBottom: 14,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: "#3a4a5a",
  },
  warningText: {
    color: "#c62828",
    fontWeight: "500",
  },
  divider: {
    height: 1,
    backgroundColor: "#E8EEF4",
    marginVertical: 12,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: "#e53935",
    borderColor: "#e53935",
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "#1a2a3a",
  },
  wipeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e53935",
    borderRadius: 12,
    paddingVertical: 16,
    gap: 10,
    shadowColor: "#e53935",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  wipeButtonDisabled: {
    backgroundColor: "#ccc",
    shadowOpacity: 0,
    elevation: 0,
  },
  wipeButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
  },
  wipeButtonTextDisabled: {
    color: "rgba(255,255,255,0.5)",
  },
});