// src/screens/Profile/ProfileScreen.tsx
import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  StatusBar,
  ScrollView,
  Linking,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { useDispatch, useSelector } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { logout } from "../../redux/userSlice";
import type { RootState, AppDispatch } from "../../redux/store";

// Helper function
const formatPhone = (phone: string) => {
  if (!phone) return "Not Available";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

// Info Row Component
const InfoRow = ({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) => (
  <View style={styles.infoRow}>
    <View style={styles.infoIconContainer}>
      <MaterialIcons name={icon} size={20} color="#fff" />
    </View>
    <View style={styles.infoContent}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || "Not Available"}</Text>
    </View>
  </View>
);

export default function ProfileScreen({ navigation: _navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector((state: RootState) => state.user);
  const insets = useSafeAreaInsets();

  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: () => {
          dispatch(logout());
          // Navigation will automatically switch to Auth due to isAuthenticated change
        },
      },
    ]);
  };

  const handleHelpSupport = () => {
    Linking.openURL("https://www.trinityhhs.com/patients-home").catch(() => {
      Alert.alert("Error", "Unable to open the support page.");
    });
  };

  const initials =
    (user.firstName?.charAt(0) ?? "") + (user.lastName?.charAt(0) ?? "");

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Background Gradient */}
      <LinearGradient
        colors={["#001830", "#002850", "#003870"]}
        style={styles.backgroundGradient}
      />

       <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.profileSection,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Avatar */}
          <View style={styles.avatarOuter}>
            <LinearGradient
              colors={["#0066CC", "#004499"]}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarText}>
                {initials || "?"}
              </Text>
            </LinearGradient>
          </View>

          {/* Name & ID */}
          <Text style={styles.userName}>
            {user.firstName || "Unknown"} {user.lastName || ""}
          </Text>
          <View style={styles.patientIdBadge}>
            <MaterialIcons name="badge" size={14} color="#0066CC" />
            <Text style={styles.patientIdText}>
              ID: {user.patientId || "N/A"}
            </Text>
          </View>
        </Animated.View>

        {/* Info Card */}
        <Animated.View
          style={[
            styles.infoCard,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <Text style={styles.sectionTitle}>Contact Information</Text>

          <InfoRow
            icon="phone"
            label="Phone Number"
            value={formatPhone(user.phone || "")}
          />

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Healthcare Team</Text>

          <InfoRow
            icon="person"
            label="Provider"
            value={
              user.providerFirstName
                ? `Dr. ${user.providerFirstName} ${user.providerLastName}`
                : "Not Assigned"
            }
          />

          <InfoRow
            icon="local-hospital"
            label="Practice"
            value={user.providerPracticeName || "N/A"}
          />
        </Animated.View>

        {/* Action Buttons */}
        <Animated.View
          style={[
            styles.actionsContainer,
            {
              opacity: fadeAnim,
            },
          ]}
        >

          <TouchableOpacity style={styles.actionButton} onPress={handleLogout}>
            <MaterialIcons name="settings" size={20} color="#0066CC" />
            <Text style={styles.actionButtonText}>Sign Out</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleHelpSupport}>
            <MaterialIcons name="help-outline" size={20} color="#0066CC" />
            <Text style={styles.actionButtonText}>Help & Support</Text>
          </TouchableOpacity>
        </Animated.View>

       

        {/* Version */}
        <Text style={styles.versionText}>CareView v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#001830",
  },
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  topShape: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 280,
    overflow: "hidden",
  },
  topShapeGradient: {
    flex: 1,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  profileSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  avatarOuter: {
    width: 110,
    height: 110,
    borderRadius: 55,
    padding: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginBottom: 16,
  },
  avatarGradient: {
    flex: 1,
    borderRadius: 53,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 38,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 2,
  },
  userName: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 8,
  },
  patientIdBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  patientIdText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0066CC",
  },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#8899AA",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  infoIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#0066CC",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: "#8899AA",
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a2a3a",
  },
  divider: {
    height: 1,
    backgroundColor: "#E8EEF4",
    marginVertical: 20,
  },
  actionsContainer: {
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F4F8",
    gap: 14,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1a2a3a",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(220, 53, 69, 0.1)",
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
    marginBottom: 20,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#DC3545",
  },
  versionText: {
    textAlign: "center",
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
  },
});