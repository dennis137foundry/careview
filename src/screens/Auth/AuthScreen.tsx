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
import { BTN } from "../../constants/buttons";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { LANGUAGE_NAMES, useT } from "../../i18n";
import LanguagePicker from "../../components/LanguagePicker";

import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";

type AuthScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, "AuthPhone">;
};

export default function AuthScreen({ navigation }: AuthScreenProps) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useT();
  const [showLanguage, setShowLanguage] = useState(false);

  const handleSendCode = async () => {
    const trimmed = phone.trim();
    if (!trimmed) {
      Alert.alert(t("auth.phoneRequiredTitle"), t("auth.phoneRequiredBody"));
      return;
    }

    try {
      setBusy(true);
      const success = await authService.sendCode(trimmed);

      if (!success) {
        Alert.alert(t("common.error"), t("auth.sendFailed"));
        return;
      }

      navigation.navigate("AuthCode", { phone: trimmed });
    } catch (e: any) {
      console.error("[AuthScreen] Error:", e);
      Alert.alert(t("common.error"), e?.message || t("auth.sendFailedRetry"));
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
      <Text style={styles.title}>Trinity CareView</Text>
      <Text style={styles.subtitle}>
        {t("auth.subtitle")}
      </Text>

      {/* Input */}
      <TextInput
        style={styles.input}
        placeholder={t("auth.phonePlaceholder")}
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
          {busy ? t("auth.pleaseWait") : t("auth.requestCode")}
        </Text>
      </TouchableOpacity>

      <Text style={styles.demoNote}>
        {t("auth.codeNote")}
      </Text>

      {/* Language: all three names, so a patient who reads none of the
          others still finds hers (her phone may not offer Creole). */}
      <TouchableOpacity
        style={styles.languageLink}
        onPress={() => setShowLanguage(true)}
        accessibilityLabel={t("language.choose")}
      >
        <MaterialIcons name="translate" size={18} color="#aabbcc" />
        <Text style={styles.languageText}>
          {[LANGUAGE_NAMES.en, LANGUAGE_NAMES.es, LANGUAGE_NAMES.ht].join("  ·  ")}
        </Text>
      </TouchableOpacity>
      <LanguagePicker visible={showLanguage} onClose={() => setShowLanguage(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#002040",
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
    color: "#ffffff",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#aabbcc",
    marginBottom: 24,
    textAlign: "center",
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#334455",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 20,
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  button: {
    backgroundColor: BTN.primary,
    borderRadius: BTN.radius,
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
  languageLink: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  languageText: {
    color: "#aabbcc",
    fontSize: 14,
    marginLeft: 8,
  },
  demoNote: {
    fontSize: 13,
    color: "#6688aa",
    marginTop: 8,
    textAlign: "center",
  },
});