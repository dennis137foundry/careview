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
import { cancelUrineReminders } from "../../services/urineReminderService";
import { clearLoginSession } from "../../services/urineProteinSession";
import { logout } from "../../redux/userSlice";
import { wipeAllPatientData } from "../../services/sqliteService";
import type { AppDispatch } from "../../redux/store";
import { BTN } from "../../constants/buttons";
import { useT } from "../../i18n";

export default function WipeDataScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const [confirmed, setConfirmed] = useState(false);
  const [wiping, setWiping] = useState(false);

  const handleWipe = () => {
    Alert.alert(
      t("profile.wipeFinalTitle"),
      t("profile.wipeFinalBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("profile.wipeConfirmButton"),
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
      cancelUrineReminders();
      clearLoginSession();
      dispatch(logout());
    } catch (error) {
      console.error("[WipeData] Wipe failed:", error);
      setWiping(false);
      Alert.alert(t("common.error"), t("profile.wipeFailed"));
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
        <Text style={styles.headerTitle}>{t("profile.signOutWipe")}</Text>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Warning icon */}
        <View style={styles.warningIconContainer}>
          <MaterialIcons name="warning" size={48} color={BTN.destructive} />
        </View>

        {/* Explanation card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("profile.wipeBeforeTitle")}</Text>

          <View style={styles.bulletRow}>
            <MaterialIcons name="cloud-done" size={20} color={BTN.link} />
            <Text style={styles.bulletText}>
              {t("profile.wipeSynced")}
            </Text>
          </View>

          <View style={styles.bulletRow}>
            <MaterialIcons name="phone-android" size={20} color={BTN.link} />
            <Text style={styles.bulletText}>
              {t("profile.wipeLocalOnly")}
            </Text>
          </View>

          <View style={styles.bulletRow}>
            <MaterialIcons name="sync-problem" size={20} color={BTN.destructive} />
            <Text style={[styles.bulletText, styles.warningText]}>
              {t("profile.wipeUnsyncedLost")}
            </Text>
          </View>

          <View style={styles.bulletRow}>
            <MaterialIcons name="delete-forever" size={20} color={BTN.destructive} />
            <Text style={[styles.bulletText, styles.warningText]}>
              {t("profile.wipePermanent")}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.bulletRow}>
            <MaterialIcons name="support-agent" size={20} color={BTN.link} />
            <Text style={styles.bulletText}>
              {t("profile.wipeContact")}
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
            {t("profile.wipeCheckbox")}
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
            {wiping ? t("profile.wiping") : t("profile.wipeButton")}
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
    flexShrink: 1, // wrap a longer translated title instead of running off screen
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
    backgroundColor: BTN.destructive,
    borderColor: BTN.destructive,
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
    backgroundColor: BTN.destructive,
    borderRadius: BTN.radius,
    paddingVertical: 16,
    gap: 10,
    shadowColor: BTN.destructive,
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