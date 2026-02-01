import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

interface RenameDeviceModalProps {
  visible: boolean;
  currentName: string;
  deviceType: string;
  onRename: (newName: string) => void;
  onCancel: () => void;
}

export default function RenameDeviceModal({
  visible,
  currentName,
  deviceType,
  onRename,
  onCancel,
}: RenameDeviceModalProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<TextInput>(null);

  // Reset and focus when modal opens
  useEffect(() => {
    if (visible) {
      setName(currentName);
      // Small delay to ensure modal is rendered before focusing
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [visible, currentName]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      onRename(trimmed);
    }
  };

  const getDeviceIcon = (): string => {
    switch (deviceType) {
      case "BP":
        return "favorite";
      case "SCALE":
        return "fitness-center";
      case "BG":
        return "water-drop";
      default:
        return "devices";
    }
  };

  const getDeviceColor = (): string => {
    switch (deviceType) {
      case "BP":
        return "#e53935";
      case "SCALE":
        return "#00acc1";
      case "BG":
        return "#7b1fa2";
      default:
        return "#757575";
    }
  };

  const isValid = name.trim().length > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: `${getDeviceColor()}20` },
              ]}
            >
              <MaterialIcons
                name={getDeviceIcon()}
                size={24}
                color={getDeviceColor()}
              />
            </View>
            <Text style={styles.title}>Rename Device</Text>
          </View>

          {/* Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Device Name</Text>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter device name"
              placeholderTextColor="#999"
              maxLength={30}
              autoCapitalize="words"
              autoCorrect={false}
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            <Text style={styles.charCount}>{name.length}/30</Text>
          </View>

          {/* Buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, !isValid && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={!isValid}
              activeOpacity={0.7}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  container: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a2e",
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#fafafa",
  },
  charCount: {
    fontSize: 12,
    color: "#999",
    textAlign: "right",
    marginTop: 6,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 30,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#666",
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 30,
    backgroundColor: "#00509f",
    alignItems: "center",
  },
  saveButtonDisabled: {
    backgroundColor: "#ccc",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});