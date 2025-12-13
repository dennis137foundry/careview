import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

export default function ResultScreen({ route, navigation }: any) {
  const { reading } = route.params ?? {};

  return (
    <View style={styles.container}>
      {/* --- Success Icon --- */}
      <MaterialIcons
        name="check-circle"
        size={100}
        color="#006b6b"
        style={styles.icon}
      />

      {/* --- Title --- */}
      <Text style={styles.title}>Reading Saved</Text>

      {/* --- Reading Summary --- */}
      {reading ? (
        <View style={styles.card}>
          <Text style={styles.deviceName}>{reading.deviceName}</Text>
          {reading.type === "BP" ? (
            <Text style={styles.valueText}>
              {reading.value}/{reading.value2} {reading.unit}
            </Text>
          ) : (
            <Text style={styles.valueText}>
              {reading.value} {reading.unit}
            </Text>
          )}
          <Text style={styles.dateText}>
            {new Date(reading.ts || Date.now()).toLocaleString()}
          </Text>
        </View>
      ) : (
        <Text style={styles.noData}>No reading data found</Text>
      )}

      {/* --- Navigation Buttons --- */}
      <View style={styles.buttonGroup}>
        {/* Redo Reading */}
        <TouchableOpacity
          style={styles.redoButton}
          onPress={() => {
            if (reading?.deviceId) {
              navigation.navigate("Capture", {
                deviceId: reading.deviceId,
                deviceName: reading.deviceName,
                type: reading.type,
                redo: true,
              });
            } else {
              Alert.alert(
                "Device Not Found",
                "Please select a device before taking another reading."
              );
              navigation.navigate("DevicesMain");
            }
          }}
        >
          <MaterialIcons name="refresh" size={20} color="#fff" />
          <Text style={styles.redoButtonText}>Redo Reading</Text>
        </TouchableOpacity>

        {/* Go Back to Devices */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.navigate("DevicesMain")}
        >
          <MaterialIcons name="arrow-back" size={20} color="#fff" />
          <Text style={styles.backButtonText}>Device List</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    padding: 24,
  },
  icon: { marginBottom: 16 },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#003366",
    marginBottom: 24,
  },
  card: {
    backgroundColor: "rgba(0, 51, 102, 0.05)",
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 40,
    width: "85%",
  },
  deviceName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#002040",
    marginBottom: 8,
  },
  valueText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#003366",
  },
  dateText: {
    fontSize: 14,
    color: "#555",
    marginTop: 6,
  },
  noData: {
    fontSize: 16,
    color: "#555",
    marginBottom: 40,
  },
  buttonGroup: {
    marginTop: 24,
    alignItems: "center",
    width: "100%",
  },
  redoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00509f",
    borderRadius: 30,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: "80%",
    marginBottom: 16,
  },
  redoButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#002040",
    borderRadius: 30,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: "80%",
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
});
