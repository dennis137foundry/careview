/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { BTN } from "../constants/buttons";
import {
  getUrineProteinSnapshot,
  recordUrineProteinResult,
  recordUrineProteinUnable,
} from "../services/urineProteinService";
import {
  describeRelative,
  isDuplicateEntry,
  PROTEIN_RESULTS,
  UNABLE_REASONS,
  URINE_INTERVAL_HOURS,
  type ProteinResult,
  type UnableReasonCode,
} from "../services/urineProteinLogic";

const RESULT_COLORS: Record<ProteinResult, string> = {
  Negative: "#4CAF50",
  Trace: "#8BC34A",
  "+1": "#FFC107",
  "+2": "#FF9800",
  "+3": "#FF5722",
  "+4": "#F44336",
};

export type UrineProteinMode = "voluntary" | "hold";

interface UrineProteinModalProps {
  visible: boolean;
  /**
   * voluntary — opened from the dashboard tile or the bell; can be cancelled.
   * hold      — the 72-hour floor was missed; rendered INLINE over the home
   *             screen (tab bar stays usable) and cannot be dismissed except
   *             by recording a result or reporting "I can't test right now".
   */
  mode: UrineProteinMode;
  onComplete: (result: ProteinResult) => void;
  onUnable: (reason: UnableReasonCode) => void;
  onCancel?: () => void;
}

/**
 * Urine Protein result picker.
 *
 * One component, two presentations. Patients may record a result whenever
 * they like (any number per day); the same sheet doubles as the mandatory
 * prompt once 72 hours pass with nothing recorded.
 */
export default function UrineProteinModal({
  visible,
  mode,
  onComplete,
  onUnable,
  onCancel,
}: UrineProteinModalProps) {
  const [selectedResult, setSelectedResult] = useState<ProteinResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unableOpen, setUnableOpen] = useState(false);
  const [reason, setReason] = useState<UnableReasonCode | null>(null);

  // Fresh state every time the sheet is shown.
  useEffect(() => {
    if (!visible) {
      setSelectedResult(null);
      setSubmitting(false);
      setUnableOpen(false);
      setReason(null);
    }
  }, [visible]);

  const saveResult = (result: ProteinResult) => {
    setSubmitting(true);
    // Local save failing means the result never left the phone — keep the
    // sheet open so the patient can try again.
    try {
      recordUrineProteinResult(result);
    } catch (err) {
      console.error("[UrineProtein] Failed to save result:", err);
      setSubmitting(false);
      Alert.alert("Couldn't save", "Your result was not saved. Please try again.");
      return;
    }
    setSubmitting(false);
    onComplete(result);
  };

  const handleSubmit = () => {
    if (!selectedResult || submitting) return;

    // Two taps inside two minutes is more often a double-tap than a second
    // test. Ask, never block.
    const now = Date.now();
    const snap = getUrineProteinSnapshot(now);
    if (isDuplicateEntry(snap.lastResultAt, now) && snap.lastResultAt !== null) {
      Alert.alert(
        "Record another result?",
        `You recorded ${snap.lastResult ?? "a result"} ${describeRelative(
          snap.lastResultAt,
          now
        )}. Save this one too?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Save", onPress: () => saveResult(selectedResult) },
        ]
      );
      return;
    }

    saveResult(selectedResult);
  };

  const handleUnableSend = () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      recordUrineProteinUnable(reason);
    } catch (err) {
      console.error("[UrineProtein] Failed to save can't-test report:", err);
      setSubmitting(false);
      Alert.alert("Couldn't save", "Your report was not saved. Please try again.");
      return;
    }
    setSubmitting(false);
    onUnable(reason);
  };

  const isHold = mode === "hold";

  const sheet = (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <MaterialIcons name="science" size={32} color={BTN.primary} />
          </View>
          <Text style={styles.title}>Urine Protein Check</Text>
          <Text style={styles.subtitle}>
            {isHold
              ? `It's been more than ${URINE_INTERVAL_HOURS} hours since your last result. Please record one to continue.`
              : "Please record your most recent urine protein test result."}
          </Text>
        </View>

        {unableOpen ? (
          <>
            {/* Can't-test reasons */}
            <View style={styles.infoBox}>
              <MaterialIcons name="info-outline" size={18} color="#1976D2" />
              <Text style={styles.infoText}>
                Let your care team know why. They'll see this on your chart,
                and we'll check back with you tomorrow.
              </Text>
            </View>

            <View style={styles.reasonList}>
              {UNABLE_REASONS.map((option) => {
                const selected = reason === option.code;
                return (
                  <TouchableOpacity
                    key={option.code}
                    style={[styles.reasonOption, selected && styles.reasonOptionSelected]}
                    onPress={() => setReason(option.code)}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={selected ? "radio-button-checked" : "radio-button-unchecked"}
                      size={22}
                      color={selected ? BTN.primary : "#9aa5b1"}
                    />
                    <Text style={[styles.reasonLabel, selected && styles.reasonLabelSelected]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.submitButton, !reason && styles.submitButtonDisabled]}
                onPress={handleUnableSend}
                disabled={!reason || submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <MaterialIcons name="send" size={18} color="#fff" />
                    <Text style={styles.submitButtonText}>Send to care team</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quietButton}
                onPress={() => setUnableOpen(false)}
                activeOpacity={0.7}
                disabled={submitting}
              >
                <MaterialIcons name="arrow-back" size={18} color={BTN.quietText} />
                <Text style={styles.quietButtonText}>Back to results</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            {/* Info Box */}
            <View style={styles.infoBox}>
              <MaterialIcons name="info-outline" size={18} color="#1976D2" />
              <Text style={styles.infoText}>
                This helps your care team monitor for signs of preeclampsia.
                Test strips are included in your kit.
              </Text>
            </View>

            {/* Result Options - 2 column grid */}
            <View style={styles.optionsGrid}>
              {PROTEIN_RESULTS.map((value) => {
                const color = RESULT_COLORS[value];
                const selected = selectedResult === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.resultOption,
                      selected && {
                        borderColor: color,
                        backgroundColor: `${color}15`,
                      },
                    ]}
                    onPress={() => setSelectedResult(value)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.resultDot,
                        { backgroundColor: selected ? color : "#ddd" },
                      ]}
                    />
                    <Text
                      style={[
                        styles.resultLabel,
                        selected && { color, fontWeight: "700" },
                      ]}
                    >
                      {value}
                    </Text>
                    {selected && (
                      <MaterialIcons name="check-circle" size={18} color={color} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Selected Result Summary */}
            {selectedResult && (
              <View style={styles.selectionSummary}>
                <Text style={styles.selectionText}>
                  Selected:{" "}
                  <Text style={styles.selectionValue}>{selectedResult}</Text>
                </Text>
              </View>
            )}

            {/* Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.submitButton, !selectedResult && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                disabled={!selectedResult || submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <MaterialIcons name="check" size={20} color="#fff" />
                    <Text style={styles.submitButtonText}>Save Result</Text>
                  </>
                )}
              </TouchableOpacity>

              {isHold ? (
                <TouchableOpacity
                  style={styles.quietButton}
                  onPress={() => setUnableOpen(true)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="event-busy" size={18} color={BTN.quietText} />
                  <Text style={styles.quietButtonText}>I can't test right now</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.quietButton}
                  onPress={onCancel}
                  activeOpacity={0.7}
                >
                  <Text style={styles.quietButtonText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.reminderNote}>
              You can record a result any time. If {URINE_INTERVAL_HOURS} hours
              pass without one, we'll ask you to enter it before continuing.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );

  if (isHold) {
    // Inline overlay, not a system Modal: it covers the home screen (and the
    // docked New Reading button) but leaves the tab bar reachable, so the
    // rest of the app keeps working while the answer is owed.
    if (!visible) return null;
    return <View style={styles.inlineOverlay}>{sheet}</View>;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>{sheet}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  inlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
    zIndex: 100,
    elevation: 100,
  },
  container: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
    overflow: "hidden",
  },
  scrollContent: {
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: "center",
    marginBottom: 20,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(5, 110, 120, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#002040",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#E3F2FD",
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: "#1565C0",
    lineHeight: 18,
  },
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  resultOption: {
    flexDirection: "row",
    alignItems: "center",
    width: "48%",
    padding: 12,
    borderRadius: BTN.radius,
    borderWidth: 2,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
    marginBottom: 10,
  },
  resultDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  resultLabel: {
    flex: 1,
    fontSize: 15,
    color: "#333",
  },
  selectionSummary: {
    alignItems: "center",
    paddingVertical: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    marginBottom: 20,
  },
  selectionText: {
    fontSize: 14,
    color: "#666",
  },
  selectionValue: {
    fontWeight: "700",
    color: "#333",
  },
  reasonList: {
    gap: 10,
    marginBottom: 20,
  },
  reasonOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: BTN.radius,
    borderWidth: 2,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
  },
  reasonOptionSelected: {
    borderColor: BTN.primary,
    backgroundColor: "rgba(5, 110, 120, 0.06)",
  },
  reasonLabel: {
    flex: 1,
    fontSize: 15,
    color: "#333",
  },
  reasonLabelSelected: {
    color: "#002040",
    fontWeight: "600",
  },
  buttonContainer: {
    gap: 12,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BTN.primary,
    padding: 16,
    borderRadius: BTN.radius,
    gap: 8,
  },
  submitButtonDisabled: {
    backgroundColor: "#ccc",
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  quietButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    borderRadius: BTN.radius,
    backgroundColor: BTN.quiet,
    gap: 6,
  },
  quietButtonText: {
    fontSize: 15,
    color: BTN.quietText,
    fontWeight: "500",
  },
  reminderNote: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    marginTop: 16,
    lineHeight: 17,
  },
});
