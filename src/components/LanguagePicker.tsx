// src/components/LanguagePicker.tsx
// The patient's language (2026-10-28): "Same as my phone" (the default),
// English, Español, Kreyòl ayisyen. Opened from Profile and from the sign-in
// screen, so a patient whose phone is in another language — every Haitian
// Creole speaker on Android — can switch before she even signs in.

import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { BTN } from "../constants/buttons";
import { deviceLanguage, LANGUAGE_NAMES, useT, type LangChoice } from "../i18n";

const CHOICES: LangChoice[] = ["auto", "en", "es", "ht"];

export default function LanguagePicker({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t, choice, setLanguageChoice } = useT();

  const pick = (c: LangChoice) => {
    setLanguageChoice(c);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>{t("language.choose")}</Text>
          {CHOICES.map((c) => {
            const selected = c === choice;
            return (
              <TouchableOpacity
                key={c}
                style={[styles.row, selected && styles.rowSelected]}
                onPress={() => pick(c)}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <View style={styles.rowText}>
                  <Text style={styles.name}>
                    {c === "auto" ? t("language.auto") : LANGUAGE_NAMES[c]}
                  </Text>
                  {c === "auto" ? (
                    <Text style={styles.detail}>
                      {t("language.autoDetail", { language: LANGUAGE_NAMES[deviceLanguage()] })}
                    </Text>
                  ) : null}
                </View>
                {selected ? <MaterialIcons name="check" size={22} color={BTN.primary} /> : null}
              </TouchableOpacity>
            );
          })}
          <Text style={styles.note}>{t("language.note")}</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>{t("common.close")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** The current choice as one line for a settings row ("Same as my phone", "Español", ...). */
export function languageChoiceLabel(choice: LangChoice, t: (k: "language.auto") => string): string {
  return choice === "auto" ? t("language.auto") : LANGUAGE_NAMES[choice];
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  container: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a2e",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: BTN.radius,
    borderWidth: 1,
    borderColor: "#e3e8ee",
    marginBottom: 8,
  },
  rowSelected: {
    borderColor: BTN.primary,
    backgroundColor: "#eaf6f7",
  },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: "600", color: "#1a1a2e" },
  detail: { fontSize: 13, color: "#5b6b7f", marginTop: 2 },
  note: { fontSize: 13, color: "#5b6b7f", marginTop: 4, marginBottom: 12 },
  closeButton: {
    backgroundColor: BTN.quiet,
    borderRadius: BTN.radius,
    paddingVertical: 12,
    alignItems: "center",
  },
  closeText: { color: BTN.quietText, fontSize: 15, fontWeight: "600" },
});
