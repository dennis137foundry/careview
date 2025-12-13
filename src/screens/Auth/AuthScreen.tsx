/* eslint-disable react-native/no-inline-styles */
// src/screens/Auth/AuthScreen.tsx
import React, { useState } from "react";
import {
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import authService from "../../services/authService";

import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";

type AuthScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, "AuthPhone">;
};

export default function AuthScreen({ navigation }: AuthScreenProps) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSendCode = async () => {
    const trimmed = phone.trim();
    if (!trimmed) {
      Alert.alert("Phone required", "Please enter your mobile number.");
      return;
    }

    try {
      setBusy(true);
      const success = await authService.sendCode(trimmed);

      if (!success) {
        Alert.alert("Error", "Could not send verification code.");
        return;
      }

      navigation.navigate("AuthCode", { phone: trimmed });
    } catch (e: any) {
      console.error("[AuthScreen] Error:", e);
      Alert.alert("Error", e?.message || "Failed to send code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Logo */}
      <Image
        source={require("../../assets/logo.png")}
        style={styles.logo}
        resizeMode="contain"
      />

      {/* Title */}
      <Text style={styles.title}>Welcome to Trinity CareView</Text>
      <Text style={styles.subtitle}>
        Enter your mobile number to receive a verification code.
      </Text>

      {/* Input */}
      <TextInput
        style={styles.input}
        placeholder="Mobile number"
        placeholderTextColor="#888"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        autoComplete="tel"
        textContentType="telephoneNumber"
      />

      {/* Button */}
      <TouchableOpacity
        style={[styles.button, busy && { opacity: 0.6 }]}
        onPress={handleSendCode}
        disabled={busy}
      >
        <Text style={styles.buttonText}>
          {busy ? "Sending code..." : "Send Code"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.demoNote}>
        We'll text a 6-digit code to verify your number.
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: {
    width: 160,
    height: 160,
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#002040",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 24,
    textAlign: "center",
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 20,
    color: "#000",
  },
  button: {
    backgroundColor: "#002040",
    borderRadius: 30,
    width: "100%",
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  demoNote: {
    fontSize: 13,
    color: "#888",
    marginTop: 8,
    textAlign: "center",
  },
});