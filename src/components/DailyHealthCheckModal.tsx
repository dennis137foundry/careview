import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import {
  saveScreeningResponse,
  DailyHealthCheckData,
} from "../services/sqliteService";
import { syncPendingScreening } from "../services/vitalsSyncService";
import { BTN } from "../constants/buttons";
import { useT } from "../i18n";

/** "**word**" in a translated string marks the part shown in bold. */
function withEmphasis(text: string, style: object) {
  return text.split("**").map((part, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={style}>
        {part}
      </Text>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

interface DailyHealthCheckModalProps {
  visible: boolean;
  onComplete: (data: DailyHealthCheckData) => void;
}

const RadioOption = ({
  label,
  selected,
  onPress,
  color = "#00509f",
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  color?: string;
}) => (
  <TouchableOpacity
    style={[
      styles.radioOption,
      selected && { borderColor: color, backgroundColor: `${color}10` },
    ]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={[styles.radioCircle, selected && { borderColor: color }]}>
      {selected && (
        <View style={[styles.radioFill, { backgroundColor: color }]} />
      )}
    </View>
    <Text
      style={[
        styles.radioLabel,
        selected && styles.radioLabelSelected,
        selected && { color },
      ]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

export default function DailyHealthCheckModal({
  visible,
  onComplete,
}: DailyHealthCheckModalProps) {
  const { t } = useT();
  const [hasHeadaches, setHasHeadaches] = useState<boolean | null>(null);
  const [hasVisualDisturbances, setHasVisualDisturbances] = useState<boolean | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = hasHeadaches !== null && hasVisualDisturbances !== null;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);

    const data: DailyHealthCheckData = {
      hasHeadaches: hasHeadaches!,
      hasVisualDisturbances: hasVisualDisturbances!,
      details: details.trim() || undefined,
    };

    // Save to local DB. If this throws, the patient's answer never left
    // the phone — keep the modal open so they can retry. Silently
    // advancing to the BP-capture screen on a failed save is a data-loss
    // path and breaks the preeclampsia-screening contract.
    try {
      saveScreeningResponse("daily_health_check", data);
    } catch (err) {
      console.error("[DailyHealthCheck] Failed to save screening response:", err);
      setSubmitting(false);
      // Keep modal open. Could add a toast provider reference here later —
      // for now, errors are visible in the logs and the modal stays
      // open so the user can try again.
      return;
    }

    // Trigger background sync to EMR
    syncPendingScreening().catch((err) => {
      console.error("[DailyHealthCheck] Background sync error:", err);
    });

    setSubmitting(false);

    // Reset for next time
    setHasHeadaches(null);
    setHasVisualDisturbances(null);
    setDetails("");

    onComplete(data);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => {
        // Cannot dismiss without answering
      }}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.iconContainer}>
                <MaterialIcons name="health-and-safety" size={32} color="#00509f" />
              </View>
              <Text style={styles.title}>{t("modals.dhcTitle")}</Text>
              <Text style={styles.subtitle}>{t("modals.dhcSubtitle")}</Text>
            </View>

            {/* Question 1: Headaches */}
            <View style={styles.questionBlock}>
              <Text style={styles.questionText}>
                {withEmphasis(t("modals.dhcHeadaches"), styles.emphasis)}
              </Text>
              <View style={styles.radioRow}>
                <RadioOption
                  label={t("common.no")}
                  selected={hasHeadaches === false}
                  onPress={() => setHasHeadaches(false)}
                  color="#4CAF50"
                />
                <RadioOption
                  label={t("common.yes")}
                  selected={hasHeadaches === true}
                  onPress={() => setHasHeadaches(true)}
                  color="#c62828"
                />
              </View>
            </View>

            {/* Question 2: Visual Disturbances */}
            <View style={styles.questionBlock}>
              <Text style={styles.questionText}>
                {withEmphasis(t("modals.dhcVisual"), styles.emphasis)}
              </Text>
              <Text style={styles.questionHint}>{t("modals.dhcVisualHint")}</Text>
              <View style={styles.radioRow}>
                <RadioOption
                  label={t("common.no")}
                  selected={hasVisualDisturbances === false}
                  onPress={() => setHasVisualDisturbances(false)}
                  color="#4CAF50"
                />
                <RadioOption
                  label={t("common.yes")}
                  selected={hasVisualDisturbances === true}
                  onPress={() => setHasVisualDisturbances(true)}
                  color="#c62828"
                />
              </View>
            </View>

            {/* Optional Details (shown if any symptom is Yes) */}
            {(hasHeadaches || hasVisualDisturbances) && (
              <View style={styles.detailsBlock}>
                <Text style={styles.detailsLabel}>{t("modals.dhcDetailsLabel")}</Text>
                <TextInput
                  style={styles.detailsInput}
                  placeholder={t("modals.dhcDetailsPlaceholder")}
                  placeholderTextColor="#999"
                  multiline
                  numberOfLines={3}
                  value={details}
                  onChangeText={setDetails}
                  textAlignVertical="top"
                />
              </View>
            )}

            {/* Warning Banner (shown if any symptoms) */}
            {(hasHeadaches || hasVisualDisturbances) && (
              <View style={styles.warningBanner}>
                <MaterialIcons name="warning" size={20} color="#E65100" />
                <Text style={styles.warningText}>{t("modals.dhcWarning")}</Text>
              </View>
            )}

            {/* Submit Button */}
            <TouchableOpacity
              style={[
                styles.submitButton,
                !canSubmit && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit || submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.submitButtonText}>{t("modals.dhcContinue")}</Text>
                  <MaterialIcons name="arrow-forward" size={20} color="#fff" />
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.requiredNote}>{t("modals.dhcRequired")}</Text>
          </ScrollView>
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
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
    maxHeight: "90%",
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(0, 80, 159, 0.1)",
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
  questionBlock: {
    marginBottom: 24,
  },
  questionText: {
    fontSize: 16,
    color: "#333",
    marginBottom: 8,
    fontWeight: "500",
  },
  emphasis: {
    fontWeight: "700",
    color: "#002040",
  },
  questionHint: {
    fontSize: 13,
    color: "#888",
    marginBottom: 12,
    fontStyle: "italic",
  },
  radioRow: {
    flexDirection: "row",
    gap: 12,
  },
  radioOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: BTN.radius,
    borderWidth: 2,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#ccc",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  radioFill: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  radioLabel: {
    fontSize: 16,
    color: "#333",
  },
  radioLabelSelected: {
    fontWeight: "600",
  },
  detailsBlock: {
    marginBottom: 20,
  },
  detailsLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  detailsInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: "#333",
    minHeight: 80,
    backgroundColor: "#fafafa",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
    gap: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: "#E65100",
    fontWeight: "500",
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
  requiredNote: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    marginTop: 12,
  },
});