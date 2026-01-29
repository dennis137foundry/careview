// src/screens/Profile/ProfileScreen.tsx
import React, { useEffect } from "react";
import {
  View,
  Text,
  ImageBackground,
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
        },
      },
    ]);
  };

  const handleHelpSupport = () => {
    Linking.openURL("https://www.trinityhhs.com/patients-home").catch(() => {
      Alert.alert("Error", "Unable to open the support page.");
    });
  };

  return (
    <ImageBackground
          source={require("../../assets/background.png")}
          style={styles.image}
          resizeMode="cover"
        >
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Background Gradient */}
      <LinearGradient
        colors={["#001830", "#002850", "#003870"]}
        style={styles.backgroundGradient}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Name Card */}
        <Animated.View
          style={[
            styles.nameCard,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <Text style={styles.userName}>
            {user.firstName || "Unknown"} {user.lastName || ""}
          </Text>
          <View style={styles.patientIdRow}>
            <MaterialIcons name="badge" size={16} color="#0066CC" />
            <Text style={styles.patientIdText}>
              Patient ID: {user.patientId || "N/A"}
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
            <MaterialIcons name="logout" size={20} color="#0066CC" />
            <Text style={styles.actionButtonText}>Sign Out</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonLast]}
            onPress={handleHelpSupport}
          >
            <MaterialIcons name="help-outline" size={20} color="#0066CC" />
            <Text style={styles.actionButtonText}>Help & Support</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Version */}
        <Text style={styles.versionText}>CareView v1.0.0</Text>
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
  container: {
    flex: 1,
    backgroundColor: "#001830",
  },
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  nameCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  userName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a2a3a",
    marginBottom: 8,
  },
  patientIdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  patientIdText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#0066CC",
  },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
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
    borderRadius: 16,
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
  actionButtonLast: {
    borderBottomWidth: 0,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1a2a3a",
  },
  versionText: {
    textAlign: "center",
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
  },
});