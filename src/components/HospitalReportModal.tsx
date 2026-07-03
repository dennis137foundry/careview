import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { reportHospitalVisit } from "../services/hospitalReportService";
import { useToast } from "./Toast/ToastProvider";

const TEAL = "#0e7c86";

// How many recent days the "Earlier" list offers (starting 2 days back, since
// Today/Yesterday are their own chips).
const EARLIER_DAYS = 14;

type VisitChoice = "today" | "yesterday" | "earlier";

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayStart(daysBack: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d;
}

function earlierOptions(): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (let i = 2; i < EARLIER_DAYS + 2; i++) {
    const d = dayStart(i);
    out.push({
      label: d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      value: toISODate(d),
    });
  }
  return out;
}

interface HospitalReportModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * "I Went To The Hospital" report.
 *
 * The patient confirms the visit and picks WHEN it happened (Today / Yesterday /
 * an earlier date). We persist the event locally and background-sync it to the
 * EMR (hospital_report.php). We record both the visit date (when they went) and
 * the report time (when they pressed the button). Mirrors the UrineProteinModal
 * pattern: on a local save failure, keep the sheet open so they can retry.
 */
export default function HospitalReportModal({
  visible,
  onClose,
}: HospitalReportModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [visitChoice, setVisitChoice] = useState<VisitChoice>("today");
  const [earlierDate, setEarlierDate] = useState<string | null>(null);
  const { showToast } = useToast();

  const visitDate =
    visitChoice === "today"
      ? toISODate(dayStart(0))
      : visitChoice === "yesterday"
      ? toISODate(dayStart(1))
      : earlierDate;

  const resetState = () => {
    setVisitChoice("today");
    setEarlierDate(null);
    setSubmitting(false);
  };

  const handleConfirm = () => {
    if (!visitDate) {
      // "Earlier" chosen but no date picked yet.
      showToast({ message: "Please pick the day you went.", type: "warning" });
      return;
    }

    setSubmitting(true);
    try {
      reportHospitalVisit(visitDate);
    } catch (err) {
      console.error("[HospitalReport] Failed to save report:", err);
      setSubmitting(false);
      showToast({
        message: "Couldn't save your report. Please try again.",
        type: "error",
      });
      return;
    }

    showToast({
      message: "Your care team has been notified.",
      type: "success",
    });
    resetState();
    onClose();
  };

  const handleCancel = () => {
    if (submitting) return;
    resetState();
    onClose();
  };

  const choices: { key: VisitChoice; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "earlier", label: "Earlier" },
  ];

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
            that you have been to a hospital for medical care.
          </Text>

          {/* When did you go? */}
          <Text style={styles.whenLabel}>When did you go?</Text>
          <View style={styles.chipRow}>
            {choices.map((opt) => {
              const active = visitChoice === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setVisitChoice(opt.key)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {visitChoice === "earlier" && (
            <ScrollView
              style={styles.earlierList}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {earlierOptions().map((d) => {
                const active = earlierDate === d.value;
                return (
                  <TouchableOpacity
                    key={d.value}
                    style={[
                      styles.earlierItem,
                      active && styles.earlierItemActive,
                    ]}
                    onPress={() => setEarlierDate(d.value)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.earlierItemText,
                        active && styles.earlierItemTextActive,
                      ]}
                    >
                      {d.label}
                    </Text>
                    {active && (
                      <MaterialIcons name="check" size={18} color={TEAL} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[
                styles.confirmButton,
                !visitDate && styles.confirmButtonDisabled,
              ]}
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
    marginBottom: 20,
  },
  bodyStrong: {
    color: "#222",
    fontWeight: "700",
  },
  whenLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#002040",
    textAlign: "center",
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#d6dde6",
    backgroundColor: "#fff",
  },
  chipActive: {
    borderColor: TEAL,
    backgroundColor: "#e4f4f5",
  },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#5b6b7f",
  },
  chipTextActive: {
    color: TEAL,
  },
  earlierList: {
    maxHeight: 160,
    alignSelf: "stretch",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#eceff3",
    borderRadius: 12,
  },
  earlierItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f3f6",
  },
  earlierItemActive: {
    backgroundColor: "#e4f4f5",
  },
  earlierItemText: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
  },
  earlierItemTextActive: {
    color: TEAL,
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
  confirmButtonDisabled: {
    backgroundColor: "#bcc7cf",
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
