import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { authedFetch } from "../services/authToken";

interface SendMessageModalProps {
  visible: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  patientPhone: string;
}

const API_URL = "https://trinitycareview.com/api/careviewapp/app_messenger.php";
const API_KEY = "dc9a8e0f685349ab93c0e06f417ff7f8c13fbbac170b71270b55bd2ba7c3ba85";
const REQUEST_TIMEOUT = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1500;

// ============================================================================
// Network Helpers (same pattern as authService)
// ============================================================================

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = REQUEST_TIMEOUT
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Request timed out"));
    }, timeout);

    // authedFetch adds Authorization: Bearer and refreshes on 401.
    // Legacy X-API-Key stays in the options.headers during transition.
    authedFetch(url, { ...options, signal: controller.signal })
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);
      return response;
    } catch (error: any) {
      lastError = error;
      console.warn(`[SendMessage] Attempt ${attempt}/${retries} failed:`, error.message);

      if (attempt < retries) {
        await wait(RETRY_DELAY);
      }
    }
  }

  throw lastError || new Error("Network request failed");
}

function isNetworkError(e: any): boolean {
  const msg = e?.message?.toLowerCase() || "";
  return (
    msg.includes("network request failed") ||
    msg.includes("request timed out") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("aborted")
  );
}

// ============================================================================
// Component
// ============================================================================

export default function SendMessageModal({
  visible,
  onClose,
  patientId,
  patientName,
  patientPhone,
}: SendMessageModalProps) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setMessage("");
      setSent(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [visible]);

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      Alert.alert("Message Required", "Please enter a message before sending.");
      return;
    }

    setSending(true);

    try {
      const response = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({
          patientId,
          patientName,
          patientPhone,
          message: trimmed,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Success
      setSent(true);
    } catch (error: any) {
      console.error("[SendMessage] Error:", error);

      const alertMessage = isNetworkError(error)
        ? "Unable to reach the server. Please check your internet connection and try again."
        : "Your message could not be sent. Please try again or contact support directly.";

      Alert.alert("Unable to Send", alertMessage);
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setMessage("");
    setSent(false);
    onClose();
  };

  const charCount = message.length;
  const maxChars = 500;
  const isOverLimit = charCount > maxChars;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name="close" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Send Us A Message</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {sent ? (
            // Success State
            <View style={styles.successContainer}>
              <View style={styles.successIconCircle}>
                <MaterialIcons name="check" size={48} color="#fff" />
              </View>
              <Text style={styles.successTitle}>Message Sent</Text>
              <Text style={styles.successSubtitle}>
                Thank you for reaching out. A member of our care team will respond shortly.
              </Text>
              <TouchableOpacity
                style={styles.doneButton}
                onPress={handleClose}
                activeOpacity={0.8}
              >
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Form State
            <>
              {/* Emergency Warning */}
              <View style={styles.warningBox}>
                <MaterialIcons name="warning" size={24} color="#c62828" />
                <Text style={styles.warningText}>
                  <Text style={styles.warningBold}>
                    If you are experiencing a medical emergency, call 9-1-1.
                  </Text>
                  {" "}This form is not for emergency medical assistance.
                </Text>
              </View>

              {/* Message Input */}
              <Text style={styles.label}>Your Message</Text>
              <TextInput
                ref={inputRef}
                style={[
                  styles.textArea,
                  isOverLimit && styles.textAreaError,
                ]}
                placeholder="Type your message here..."
                placeholderTextColor="#999"
                multiline
                numberOfLines={6}
                textAlignVertical="top"
                value={message}
                onChangeText={setMessage}
                maxLength={maxChars + 50} // Allow slight overage for UX
                editable={!sending}
              />
              <Text
                style={[
                  styles.charCount,
                  isOverLimit && styles.charCountError,
                ]}
              >
                {charCount}/{maxChars}
              </Text>

              {/* Send Button */}
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (sending || isOverLimit || !message.trim()) &&
                    styles.sendButtonDisabled,
                ]}
                onPress={handleSend}
                disabled={sending || isOverLimit || !message.trim()}
                activeOpacity={0.8}
              >
                {sending ? (
                  <>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.sendButtonText}>Sending...</Text>
                  </>
                ) : (
                  <>
                    <MaterialIcons name="send" size={20} color="#fff" />
                    <Text style={styles.sendButtonText}>Send Message</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Info Note */}
              <Text style={styles.infoNote}>
                Messages are typically responded to within 1 business day.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a2a3a",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  // Warning Box
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#ffebee",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: "#c62828",
    gap: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
  },
  warningBold: {
    fontWeight: "700",
    color: "#c62828",
  },
  // Form
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  textArea: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: "#333",
    minHeight: 150,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  textAreaError: {
    borderColor: "#c62828",
  },
  charCount: {
    fontSize: 12,
    color: "#888",
    textAlign: "right",
    marginTop: 8,
    marginBottom: 24,
  },
  charCountError: {
    color: "#c62828",
    fontWeight: "600",
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0066CC",
    borderRadius: 30,
    paddingVertical: 16,
    gap: 10,
    shadowColor: "#0066CC",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: "#bbb",
    shadowOpacity: 0,
  },
  sendButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
  },
  infoNote: {
    fontSize: 13,
    color: "#888",
    textAlign: "center",
    marginTop: 16,
  },
  // Success State
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  successIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#43a047",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1a2a3a",
    marginBottom: 12,
  },
  successSubtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: 20,
    marginBottom: 32,
  },
  doneButton: {
    backgroundColor: "#0066CC",
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  doneButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
  },
  headerSpacer: {
    width: 40,
  },
});