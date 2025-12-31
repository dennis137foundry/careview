import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from "react-native-vision-camera";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

type ScanQRParams = {
  deviceId?: string;
  deviceName?: string;
  returnTo?: "AddDevice" | "Capture";
};

export default function ScanQRScreen({ navigation, route }: any) {
  const params: ScanQRParams = route.params ?? {};
  const { deviceId, deviceName, returnTo } = params;

  const [scanned, setScanned] = useState(false);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");

  const isUpdatingExisting = !!deviceId;
  const title = isUpdatingExisting
    ? `Scan Code${deviceName ? ` - ${deviceName}` : ""}`
    : "Scan Device QR Code";

  // Request permission on mount
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const handleCodeScanned = useCallback(
    (codes: any[]) => {
      if (scanned || codes.length === 0) return;
      
      const value = codes[0].value;
      if (!value) return;

      setScanned(true);
      console.log("📷 QR Code scanned:", value);

      if (isUpdatingExisting) {
        Alert.alert(
          "Bottle Code Scanned",
          `Code: ${value.substring(0, 20)}${value.length > 20 ? "..." : ""}\n\nSave this code for your glucose meter?`,
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => setScanned(false),
            },
            {
              text: "Save",
              onPress: () => {
                if (returnTo === "Capture") {
                  navigation.navigate("Capture", { deviceId, bottleCode: value });
                } else {
                  navigation.navigate("AddDevice", {
                    scannedBottleCode: value,
                    forDeviceId: deviceId,
                  });
                }
              },
            },
          ]
        );
      } else {
        // Adding new device - parse QR for MAC
        // Format: "BG5S:004D3229FEE0"
        let mac = value;
        if (value.includes(":")) {
          mac = value.split(":")[1] || value;
        }

        Alert.alert(
          "QR Code Detected",
          `Device: ${value}\n\nAdd this device?`,
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => setScanned(false),
            },
            {
              text: "Add Device",
              onPress: () => navigation.navigate("AddDevice", { scannedId: value, scannedMac: mac }),
            },
          ]
        );
      }
    },
    [scanned, isUpdatingExisting, deviceId, returnTo, navigation]
  );

  const codeScanner = useCodeScanner({
    codeTypes: ["qr", "code-128", "code-39", "ean-13"],
    onCodeScanned: handleCodeScanned,
  });

  // No permission yet
  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="camera-alt" size={48} color="#666" />
        <Text style={styles.permissionText}>Camera permission required</Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={() => {
            requestPermission().then((granted) => {
              if (!granted) {
                Linking.openSettings();
              }
            });
          }}
        >
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No camera device
  if (!device) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="error-outline" size={48} color="#f44336" />
        <Text style={styles.permissionText}>No camera found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!scanned}
        codeScanner={codeScanner}
      />

      {/* Overlay UI */}
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Instructions */}
        <View style={styles.topContent}>
          <Text style={styles.instructionText}>
            {isUpdatingExisting
              ? "Scan the QR code on your test strip bottle"
              : "Scan the QR code on your iHealth device"}
          </Text>
        </View>

        {/* Scanner frame */}
        <View style={styles.scannerAreaContainer}>
          <View style={styles.scannerFrame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        </View>

        {/* Bottom controls */}
        <View style={styles.bottomContent}>
          <View style={styles.scanIndicator}>
            <MaterialIcons name="qr-code-scanner" size={24} color="#00ACC1" />
            <Text style={styles.scanningText}>
              {scanned ? "Processing..." : "Scanning..."}
            </Text>
          </View>
          <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    padding: 32,
  },
  permissionText: {
    color: "#888",
    fontSize: 16,
    marginTop: 16,
    marginBottom: 24,
    textAlign: "center",
  },
  permissionButton: {
    backgroundColor: "#00ACC1",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginBottom: 16,
  },
  permissionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  topContent: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
  },
  instructionText: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
  },
  scannerAreaContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scannerFrame: {
    width: 250,
    height: 250,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#00ACC1",
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 12,
  },
  bottomContent: {
    paddingVertical: 32,
    paddingBottom: 50,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  scanIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  scanningText: {
    color: "#00ACC1",
    fontSize: 16,
    fontWeight: "500",
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  cancelText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
});