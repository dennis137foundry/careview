/* eslint-disable react-native/no-inline-styles */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import {
  saveScreeningResponse,
  UrineProteinData,
} from "../services/sqliteService";

// Urine protein test result options
const PROTEIN_OPTIONS = [
  { value: "Negative", label: "Negative", color: "#4CAF50" },
  { value: "Trace", label: "Trace", color: "#8BC34A" },
  { value: "+1", label: "+1", color: "#FFC107" },
  { value: "+2", label: "+2", color: "#FF9800" },
  { value: "+3", label: "+3", color: "#FF5722" },
  { value: "+4", label: "+4", color: "#F44336" },
] as const;

type ProteinResult = typeof PROTEIN_OPTIONS[number]["value"];

interface UrineProteinModalProps {
  visible: boolean;
  onComplete: (result: ProteinResult) => void;
  onDefer: () => void;
}

/**
 * Urine Protein Modal
 * 
 * Shown on dashboard load if 72+ hours since last answer.
 * User can select a result or press "Answer Later" to defer.
 * 
 * If deferred, an alert bar appears on dashboard until answered.
 */
export default function UrineProteinModal({
  visible,
  onComplete,
  onDefer,
}: UrineProteinModalProps) {
  const [selectedResult, setSelectedResult] = useState<ProteinResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedResult) return;

    setSubmitting(true);

    const data: UrineProteinData = {
      result: selectedResult,
    };

    // Save to local DB
    saveScreeningResponse('urine_protein_result', data);

    console.log("[UrineProtein] Result saved:", selectedResult);

    setSubmitting(false);
    setSelectedResult(null);
    onComplete(selectedResult);
  };

  const handleDefer = () => {
    // Save deferral to DB
    saveScreeningResponse('urine_protein_deferred', { deferred: true });
    
    console.log("[UrineProtein] User deferred - will show alert bar");
    
    setSelectedResult(null);
    onDefer();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleDefer}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.container}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.scrollContent}
          >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <MaterialIcons name="science" size={32} color="#9C27B0" />
            </View>
            <Text style={styles.title}>Urine Protein Check</Text>
            <Text style={styles.subtitle}>
              Please record your most recent urine protein test result.
            </Text>
          </View>

          {/* Info Box */}
          <View style={styles.infoBox}>
            <MaterialIcons name="info-outline" size={18} color="#1976D2" />
            <Text style={styles.infoText}>
              This helps your care team monitor for signs of preeclampsia. Test strips are included in your kit.
            </Text>
          </View>

          {/* Result Options - 2 column grid */}
          <View style={styles.optionsGrid}>
            {PROTEIN_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.resultOption,
                  selectedResult === option.value && { 
                    borderColor: option.color, 
                    backgroundColor: `${option.color}15` 
                  },
                ]}
                onPress={() => setSelectedResult(option.value)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.resultDot,
                    { backgroundColor: selectedResult === option.value ? option.color : "#ddd" },
                  ]}
                />
                <Text
                  style={[
                    styles.resultLabel,
                    selectedResult === option.value && { color: option.color, fontWeight: "700" },
                  ]}
                >
                  {option.label}
                </Text>
                {selectedResult === option.value && (
                  <MaterialIcons name="check-circle" size={18} color={option.color} />
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Selected Result Summary */}
          {selectedResult && (
            <View style={styles.selectionSummary}>
              <Text style={styles.selectionText}>
                Selected: <Text style={styles.selectionValue}>{selectedResult}</Text>
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

            <TouchableOpacity
              style={styles.deferButton}
              onPress={handleDefer}
              activeOpacity={0.7}
            >
              <MaterialIcons name="schedule" size={18} color="#666" />
              <Text style={styles.deferButtonText}>Answer Later</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.reminderNote}>
            You'll be reminded every 72 hours to record a result.
          </Text>
          </ScrollView>
        </KeyboardAvoidingView>
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
    backgroundColor: "rgba(156, 39, 176, 0.1)",
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
    borderRadius: 12,
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
  buttonContainer: {
    gap: 12,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9C27B0",
    padding: 16,
    borderRadius: 30,
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
  deferButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    borderRadius: 30,
    backgroundColor: "#f5f5f5",
    gap: 6,
  },
  deferButtonText: {
    fontSize: 15,
    color: "#666",
    fontWeight: "500",
  },
  reminderNote: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    marginTop: 16,
  },
});