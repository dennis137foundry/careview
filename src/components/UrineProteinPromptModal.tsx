import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { BTN } from "../constants/buttons";

const PURPLE = "#9C27B0";

interface UrineProteinPromptModalProps {
  visible: boolean;
  onSkip: () => void;
  onEnter: () => void;
}

/**
 * Gentle, centered "reminder" that appears a couple seconds after landing on
 * the dashboard when a urine-protein result is due. Deliberately less intrusive
 * than the full result picker: the patient can Skip (defer for now) or Enter
 * Result, which opens the full UrineProteinModal.
 */
export default function UrineProteinPromptModal({
  visible,
  onSkip,
  onEnter,
}: UrineProteinPromptModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onSkip}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <MaterialIcons name="science" size={30} color={PURPLE} />
          </View>
          <Text style={styles.title}>Urine Protein Check</Text>
          <Text style={styles.subtitle}>
            Please record your most recent urine protein test result.
          </Text>

          <TouchableOpacity
            style={styles.enterButton}
            onPress={onEnter}
            activeOpacity={0.85}
          >
            <Text style={styles.enterButtonText}>Enter Result</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipButton}
            onPress={onSkip}
            activeOpacity={0.7}
          >
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 20,
    alignItems: "center",
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: "rgba(156, 39, 176, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    color: "#002040",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 22,
  },
  enterButton: {
    width: "100%",
    backgroundColor: BTN.primary,
    paddingVertical: 14,
    borderRadius: BTN.radius,
    alignItems: "center",
  },
  enterButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  skipButton: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: BTN.radius,
    backgroundColor: BTN.quiet,
    alignItems: "center",
    marginTop: 4,
  },
  skipButtonText: {
    color: BTN.quietText,
    fontSize: 15,
    fontWeight: "600",
  },
});
