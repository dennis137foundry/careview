/* eslint-disable react-native/no-inline-styles */
// src/screens/Auth/CodeVerifyScreen.tsx
import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useDispatch } from "react-redux";
import authService from "../../services/authService";
import { login } from "../../redux/userSlice";
import { useToast } from "../../components/Toast";

import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import type { AppDispatch } from "../../redux/store";

type CodeVerifyScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, "AuthCode">;
  route: RouteProp<RootStackParamList, "AuthCode">;
};

const DIGITS = 6;

export default function CodeVerifyScreen({
  route,
  navigation,
}: CodeVerifyScreenProps) {
  const { phone } = route.params || {};
  const dispatch = useDispatch<AppDispatch>();
  const { showToast } = useToast();

  const [values, setValues] = useState<string[]>(Array(DIGITS).fill(""));
  const [busy, setBusy] = useState(false);

  const inputs = useRef<Array<TextInput | null>>([]);

  // Focus first input on mount
  useEffect(() => {
    if (inputs.current[0]) {
      inputs.current[0].focus();
    }
  }, []);

  const focusInput = (index: number) => {
    inputs.current[index]?.focus();
  };

  const handleChange = (index: number, text: string) => {
    if (busy) return;

    const clean = text.replace(/\D/g, "");
    const newValues = [...values];

    if (clean.length > 1) {
      const digits = clean.slice(0, DIGITS).split("");
      const startIndex = digits.length === DIGITS ? 0 : index;

      digits.forEach((digit, offset) => {
        const targetIndex = startIndex + offset;
        if (targetIndex < DIGITS) {
          newValues[targetIndex] = digit;
        }
      });

      setValues(newValues);

      const code = newValues.join("");
      if (code.length === DIGITS) {
        inputs.current[DIGITS - 1]?.blur();
        verify(newValues);
      } else {
        focusInput(Math.min(startIndex + digits.length, DIGITS - 1));
      }
      return;
    }

    const char = clean.slice(-1);
    newValues[index] = char;

    setValues(newValues);

    if (char && index < DIGITS - 1) {
      focusInput(index + 1);
    }

    if (index === DIGITS - 1 && char) {
      const code = newValues.join("");
      if (code.length === DIGITS) {
        inputs.current[DIGITS - 1]?.blur();
        verify(newValues);
      }
    }
  };

  const handleKeyPress = (index: number, e: any) => {
    if (e.nativeEvent.key === "Backspace") {
      if (!values[index] && index > 0) {
        const prevInput = inputs.current[index - 1];
        if (prevInput) {
          prevInput.focus();
        }
      }
    }
  };

  const verify = async (valsOverride?: string[]) => {
    if (busy) return;

    const code = (valsOverride || values).join("");

    if (code.length !== DIGITS) {
      Alert.alert("Invalid code", "Please enter all 6 digits.");
      return;
    }

    try {
      setBusy(true);
      const user = await authService.verifyCode(phone, code);

      if (!user) {
        Alert.alert("Verification failed", "Invalid or expired code.");
        return;
      }

      // Dispatch login - this will trigger AppNavigator to show Main
      dispatch(login(user));

      // Navigation will automatically switch to Main due to isAuthenticated change
    } catch (e: any) {
      console.error("[CodeVerify] Error:", e);
      Alert.alert(
        "Verification failed",
        e?.message || "The code is incorrect or has expired."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    try {
      setBusy(true);
      await authService.sendCode(phone);
      // Show confirmation as a toast instead of blocking alert
      showToast({
        message: "A new verification code has been sent.",
        type: "success",
        duration: 3000,
      });
    } catch (e: any) {
      console.error("[CodeVerify] Resend error:", e);
      Alert.alert(
        "Error",
        e?.message || "Unable to resend verification code."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleEditPhone = () => {
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Enter Verification Code</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{" "}
          <Text style={styles.phoneText}>{phone}</Text>
        </Text>

        <View style={styles.codeRow}>
          {values.map((v, i) => (
            <TextInput
              key={i}
              ref={(ref) => {
                inputs.current[i] = ref;
              }}
              style={[styles.codeInput, v ? styles.codeInputFilled : null]}
              keyboardType="number-pad"
              value={v}
              onChangeText={(text) => handleChange(i, text)}
              onKeyPress={(e) => handleKeyPress(i, e)}
              textAlign="center"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
              textContentType="oneTimeCode"
              importantForAutofill="yes"
              editable={!busy}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.button, busy && { opacity: 0.7 }]}
          onPress={() => verify()}
          disabled={busy}
        >
          <Text style={styles.buttonText}>
            {busy ? "Verifying..." : "Verify"}
          </Text>
        </TouchableOpacity>

        <View style={styles.footerRow}>
          <TouchableOpacity onPress={handleEditPhone} disabled={busy}>
            <Text style={styles.linkText}>Change number</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleResend} disabled={busy}>
            <Text style={styles.linkText}>Resend code</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.noteText}>Codes expire after 10 minutes.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#001529",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 24,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 5,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#002040",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#555",
    textAlign: "center",
    marginBottom: 24,
  },
  phoneText: {
    fontWeight: "600",
    color: "#002040",
  },
  codeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  codeInput: {
    width: 45,
    height: 55,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    fontSize: 22,
    fontWeight: "600",
    color: "#002040",
    backgroundColor: "#f8f9fb",
  },
  codeInputFilled: {
    borderColor: "#002040",
    backgroundColor: "#eef3ff",
  },
  button: {
    backgroundColor: "#002040",
    borderRadius: 30,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  buttonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  linkText: {
    fontSize: 14,
    color: "#0050b3",
    fontWeight: "600",
  },
  noteText: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
  },
});
