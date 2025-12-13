// src/screens/Profile/ProfileScreen.tsx
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { useDispatch } from "react-redux";
import { logout } from "../../redux/userSlice";

export default function ProfileScreen({ navigation }: any) {
  const dispatch = useDispatch();

  
const handleLogout = () => {
  Alert.alert("Log Out", "Are you sure you want to log out?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Log Out",
      style: "destructive",
      onPress: () => {
        dispatch(logout());
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: "Auth" }],
          })
        );
      },
    },
  ]);
};

  return (
    <View style={styles.container}>
      {/* --- Profile Card --- */}
      <View style={styles.card}>
        {/* Photo */}
        <Image
          source={require("../../assets/profilephoto.png")}
          style={styles.photo}
        />

        {/* Name */}
        <Text style={styles.name}>Demo Patient</Text>

        {/* Info */}
        <View style={styles.infoBox}>
          <Text style={styles.label}>Date of Birth</Text>
          <Text style={styles.value}>Jan 12, 1989</Text>

          <Text style={styles.label}>Medical Record #</Text>
          <Text style={styles.value}>MRN-102948</Text>

          <Text style={styles.label}>Estimated Delivery Date</Text>
          <Text style={styles.value}>March 14, 2026</Text>
        </View>
      </View>

      {/* --- Log Out Button --- */}
      <TouchableOpacity
  style={[styles.logoutButton, { opacity: 0.5 }]}
  disabled={true}
>
  <Text style={styles.logoutText}>Log Out</Text>
</TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f8f9fb",
  },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: "700",
    color: "#002040",
    marginBottom: 20,
  },
  infoBox: {
    width: "100%",
    backgroundColor: "#f2f5f8",
    borderRadius: 12,
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
    marginTop: 8,
  },
  value: {
    fontSize: 16,
    color: "#222",
    marginTop: 2,
  },
  logoutButton: {
    marginTop: 32,
    backgroundColor: "#002040",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 30,
    width: "80%",
    alignItems: "center",
  },
  logoutText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
});
