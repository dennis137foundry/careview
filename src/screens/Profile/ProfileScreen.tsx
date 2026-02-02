// src/screens/Profile/ProfileScreen.tsx
// NOTE: Requires react-native-image-picker
//   npm install react-native-image-picker
//   cd ios && pod install
//   (Camera/Photo Library permissions likely already in Info.plist from vision-camera)
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  Alert,
  StatusBar,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { useDispatch, useSelector } from "react-redux";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { launchImageLibrary, launchCamera } from "react-native-image-picker";
import { logout } from "../../redux/userSlice";
import SendMessageModal from "../../components/SendMessageModal";
import type { RootState, AppDispatch } from "../../redux/store";

const PHOTO_KEY = "careview_profile_photo";
const APP_VERSION = "1.0.0";

const formatPhone = (phone: string) => {
  if (!phone) return "Not Available";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

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
      <MaterialIcons name={icon} size={18} color="#fff" />
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

  const [showMessageModal, setShowMessageModal] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(PHOTO_KEY).then((uri) => {
      if (uri) setPhotoUri(uri);
    });
  }, []);

  const savePhoto = useCallback((uri: string) => {
    setPhotoUri(uri);
    AsyncStorage.setItem(PHOTO_KEY, uri);
  }, []);

  const removePhoto = useCallback(() => {
    setPhotoUri(null);
    AsyncStorage.removeItem(PHOTO_KEY);
  }, []);

  const handleAvatarPress = () => {
    const buttons: any[] = [
      {
        text: "Choose from Library",
        onPress: () =>
          launchImageLibrary(
            { mediaType: "photo", quality: 0.7, selectionLimit: 1 },
            (res) => {
              if (!res.didCancel && res.assets?.[0]?.uri) {
                savePhoto(res.assets[0].uri);
              }
            }
          ),
      },
      {
        text: "Take Photo",
        onPress: () =>
          launchCamera(
            { mediaType: "photo", quality: 0.7, cameraType: "front" },
            (res) => {
              if (!res.didCancel && res.assets?.[0]?.uri) {
                savePhoto(res.assets[0].uri);
              }
            }
          ),
      },
    ];
    if (photoUri) {
      buttons.push({
        text: "Remove Photo",
        style: "destructive",
        onPress: removePhoto,
      });
    }
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Profile Photo", undefined, buttons);
  };

  const handleAbout = () => {
    Alert.alert(
      "CareView",
      `Version ${APP_VERSION}\n\nRemote patient monitoring by Trinity Health & Home Services.`,
      [{ text: "OK" }]
    );
  };

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: () => dispatch(logout()),
      },
    ]);
  };

  const initials =
    (user.firstName?.charAt(0) || "") + (user.lastName?.charAt(0) || "");

  return (
    <ImageBackground
      source={require("../../assets/background.png")}
      style={styles.image}
      resizeMode="cover"
    >
      <StatusBar barStyle="dark-content" />

      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* Header */}
        <Text style={styles.headerTitle}>Profile</Text>

        {/* Name Card */}
        <View style={styles.nameCard}>
          <View style={styles.nameRow}>
            <TouchableOpacity
              onPress={handleAvatarPress}
              activeOpacity={0.7}
            >
              <View style={styles.avatarCircle}>
                {photoUri ? (
                  <Image
                    source={{ uri: photoUri }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
                <View style={styles.cameraBadge}>
                  <MaterialIcons name="camera-alt" size={11} color="#fff" />
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.nameContent}>
              <Text style={styles.userName}>
                {user.firstName || "Unknown"} {user.lastName || ""}
              </Text>
              <View style={styles.patientIdRow}>
                <MaterialIcons name="badge" size={14} color="#0066CC" />
                <Text style={styles.patientIdText}>
                  ID: {user.patientId || "N/A"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Send Message Button */}
        <TouchableOpacity
          style={styles.messageButton}
          onPress={() => setShowMessageModal(true)}
          activeOpacity={0.8}
        >
          <MaterialIcons name="chat-bubble-outline" size={22} color="#fff" />
          <Text style={styles.messageButtonText}>Send Us A Message</Text>
        </TouchableOpacity>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <InfoRow
            icon="phone"
            label="Phone"
            value={formatPhone(user.phone || "")}
          />
          <View style={styles.divider} />
          <InfoRow
            icon="person"
            label="Provider"
            value={
              user.providerFirstName
                ? `Dr. ${user.providerFirstName} ${user.providerLastName}`
                : "Not Assigned"
            }
          />
          <View style={styles.divider} />
          <InfoRow
            icon="local-hospital"
            label="Practice"
            value={user.providerPracticeName || "N/A"}
          />
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.actionButton} onPress={handleAbout}>
            <MaterialIcons name="info-outline" size={20} color="#0066CC" />
            <Text style={styles.actionButtonText}>About</Text>
            <MaterialIcons name="chevron-right" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonLast]}
            onPress={handleLogout}
          >
            <MaterialIcons name="logout" size={20} color="#e53935" />
            <Text style={[styles.actionButtonText, styles.logoutText]}>
              Sign Out
            </Text>
            <MaterialIcons name="chevron-right" size={20} color="#ccc" />
          </TouchableOpacity>
        </View>

        {/* Bottom version label */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>CareView v{APP_VERSION}</Text>
        </View>
      </View>

      {/* Send Message Modal */}
      <SendMessageModal
        visible={showMessageModal}
        onClose={() => setShowMessageModal(false)}
        patientId={user.patientId || ""}
        patientName={`${user.firstName || ""} ${user.lastName || ""}`.trim()}
        patientPhone={user.phone || ""}
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
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#00468c",
    marginBottom: 16,
  },

  /* ---- Name Card ---- */
  nameCard: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#0066CC",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
    overflow: "hidden",
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  nameContent: {
    flex: 1,
  },
  userName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a2a3a",
    marginBottom: 4,
  },
  patientIdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  patientIdText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#0066CC",
  },

  /* ---- Message Button ---- */
  messageButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0066CC",
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 12,
    gap: 10,
    shadowColor: "#0066CC",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  messageButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
  },

  /* ---- Info Card ---- */
  infoCard: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
  },
  infoIconContainer: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#0066CC",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    color: "#8899AA",
    marginBottom: 1,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a2a3a",
  },
  divider: {
    height: 1,
    backgroundColor: "#E8EEF4",
    marginVertical: 10,
  },

  /* ---- Action Buttons ---- */
  actionsContainer: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F4F8",
    gap: 12,
  },
  actionButtonLast: {
    borderBottomWidth: 0,
  },
  actionButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: "#1a2a3a",
  },
  logoutText: {
    color: "#e53935",
  },

  /* ---- Version ---- */
  versionContainer: {
    flex: 1,
    justifyContent: "flex-end",
    paddingBottom: 4,
  },
  versionText: {
    textAlign: "center",
    fontSize: 12,
    color: "rgba(0,70,140,0.35)",
  },
});