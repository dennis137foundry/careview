import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { reportHospitalVisit } from "../services/hospitalReportService";
import { useToast } from "./Toast/ToastProvider";

const TEAL = "#0e7c86";

interface HospitalReportModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * "I Went To The Hospital" report.
 *
 * A one-tap confirmation the patient sends to their care team when they've
 * received care outside the home. On confirm we persist the event locally and
 * kick off a background sync to the EMR (hospital_report.php). Mirrors the
 * UrineProteinModal pattern: if the local save throws, keep the sheet open so
 * the patient can retry rather than showing a false success.
 */
export default function HospitalReportModal({
  visible,
  onClose,
}: HospitalReportModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const handleConfirm = () => {
    setSubmitting(true);

    try {
      reportHospitalVisit();
    } catch (err) {
      console.error("[HospitalReport] Failed to save report:", err);
      setSubmitting(false);
      // Keep the sheet open so the patient can try again — the report never
      // left the phone.
      showToast({
        message: "Couldn't save your report. Please try again.",
        type: "error",
      });
      return;
    }

    setSubmitting(false);
    showToast({
      message: "Your care team has been notified.",
      type: "success",
    });
    onClose();
  };

  const handleCancel = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <MaterialIcons name="local-hospital" size={32} color={TEAL} />
            </View>
            <Text style={styles.title}>Report a hospital visit</Text>
          </View>

          {/* Confirmation message */}
          <Text style={styles.body}>
            You are reporting to{" "}
            <Text style={styles.bodyStrong}>Trinity Home Health Services</Text>{" "}
            that you have been to a hospital for medical care. To confirm this
            action, please press the{" "}
            <Text style={styles.bodyStrong}>Confirm</Text> button.
          </Text>

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleConfirm}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="check" size={20} color="#fff" />
                  <Text style={styles.confirmButtonText}>Confirm</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
              disabled={submitting}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  container: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 34,
  },
  header: {
    alignItems: "center",
    marginBottom: 16,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "rgba(14, 124, 134, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#002040",
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    color: "#555",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  bodyStrong: {
    color: "#222",
    fontWeight: "700",
  },
  buttonContainer: {
    gap: 10,
  },
  confirmButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEAL,
    padding: 16,
    borderRadius: 15,
    gap: 8,
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  cancelButton: {
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    borderRadius: 15,
  },
  cancelButtonText: {
    fontSize: 15,
    color: "#666",
    fontWeight: "600",
  },
});
