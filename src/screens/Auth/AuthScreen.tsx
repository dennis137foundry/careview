import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useDispatch } from "react-redux";
import { login } from "../../redux/userSlice";
import authService from "../../services/authService";

export default function AuthScreen({ navigation }: any) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const dispatch = useDispatch();

  const handleLogin = async () => {
    if (!phone.trim()) return Alert.alert("Enter phone number");

    try {
      setBusy(true);

      // fake verify: always succeeds
      const user = await authService.verifyCode(phone, "1234");
      if (user) {
        dispatch(login(user));
        navigation.reset({
          index: 0,
          routes: [{ name: "Main" }],
        });
      } else {
        Alert.alert("Invalid code");
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Login failed");
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
        source={require("../../assets/logo.png")} // replace with your logo file
        style={styles.logo}
        resizeMode="contain"
      />

      {/* Title */}
      <Text style={styles.title}>Welcome to Trinity CareView</Text>
      <Text style={styles.subtitle}>Enter your phone number to continue</Text>

      {/* Input */}
      <TextInput
        style={styles.input}
        placeholder="Phone number"
        placeholderTextColor="#888"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />

      {/* Button */}
      <TouchableOpacity
        style={[styles.button, busy && { opacity: 0.6 }]}
        onPress={handleLogin}
        disabled={busy}
      >
        <Text style={styles.buttonText}>
          {busy ? "Please wait..." : "Continue"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.demoNote}>Demo mode – no code required</Text>
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
  },
});
