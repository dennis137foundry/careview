/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, Platform, TouchableOpacity } from "react-native";
import QRCodeScanner from "react-native-qrcode-scanner";
import { RNCamera } from "react-native-camera";
import { request, PERMISSIONS, RESULTS } from "react-native-permissions";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

type ScanQRParams = {
  // If updating an existing device's bottle code
  deviceId?: string;
  deviceName?: string;
  // Where to return after scanning
  returnTo?: 'AddDevice' | 'Capture';
};

export default function ScanQRScreen({ navigation, route }: any) {
  const params: ScanQRParams = route.params ?? {};
  const { deviceId, deviceName, returnTo } = params;
  
  const [hasPermission, setHasPermission] = useState(false);
  const [scanned, setScanned] = useState(false);

  const isUpdatingExisting = !!deviceId;
  const title = isUpdatingExisting 
    ? `Scan Bottle Code for ${deviceName || 'Glucose Meter'}`
    : 'Scan Device QR Code';

  // Ask for camera permission on mount
  useEffect(() => {
    const requestCamera = async () => {
      try {
        if (Platform.OS === "ios") {
          const res = await request(PERMISSIONS.IOS.CAMERA);
          setHasPermission(res === RESULTS.GRANTED);
        } else {
          const res = await request(PERMISSIONS.ANDROID.CAMERA);
          setHasPermission(res === RESULTS.GRANTED);
        }
      } catch (e) {
        console.warn("Camera permission error:", e);
      }
    };
    requestCamera();
  }, []);

  const onSuccess = (e: any) => {
    if (scanned) return;
    setScanned(true);
    const value = e.data;
    
    console.log("📷 QR Code scanned:", value);

    if (isUpdatingExisting) {
      // Updating bottle code for existing device
      Alert.alert(
        "Bottle Code Scanned",
        `Code: ${value.substring(0, 20)}${value.length > 20 ? '...' : ''}\n\nSave this code for your glucose meter?`,
        [
          { 
            text: "Cancel", 
            style: "cancel", 
            onPress: () => {
              setScanned(false);
            }
          },
          { 
            text: "Save", 
            onPress: () => {
              // Navigate back with the scanned code
              if (returnTo === 'Capture') {
                navigation.navigate('Capture', { 
                  deviceId, 
                  bottleCode: value 
                });
              } else {
                navigation.navigate('AddDevice', { 
                  scannedBottleCode: value,
                  forDeviceId: deviceId 
                });
              }
            }
          },
        ]
      );
    } else {
      // Adding new device - pass scanned ID
      Alert.alert(
        "QR Code Detected", 
        value.substring(0, 50) + (value.length > 50 ? '...' : ''),
        [
          { 
            text: "Cancel", 
            style: "cancel",
            onPress: () => setScanned(false)
          },
          {
            text: "Use This Code",
            onPress: () => navigation.navigate("AddDevice", { scannedId: value }),
          },
        ]
      );
    }
  };

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="camera-alt" size={48} color="#666" />
        <Text style={styles.permissionText}>Requesting camera permission...</Text>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="close" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <QRCodeScanner
        onRead={onSuccess}
        flashMode={RNCamera.Constants.FlashMode.off}
        showMarker={true}
        markerStyle={styles.marker}
        cameraStyle={styles.camera}
        topContent={
          <View style={styles.topContent}>
            <Text style={styles.instructionText}>
              {isUpdatingExisting 
                ? "Scan the QR code on your test strip bottle"
                : "Align the QR code within the frame"}
            </Text>
            {isUpdatingExisting && (
              <View style={styles.hintBox}>
                <MaterialIcons name="info" size={18} color="#00ACC1" />
                <Text style={styles.hintText}>
                  The QR code contains calibration data for your test strips
                </Text>
              </View>
            )}
          </View>
        }
        bottomContent={
          <View style={styles.bottomContent}>
            <View style={styles.scanIndicator}>
              <MaterialIcons name="qr-code-scanner" size={24} color="#00ACC1" />
              <Text style={styles.scanningText}>
                {scanned ? "Processing..." : "Scanning..."}
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.cancelButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: "#000" 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  camera: {
    flex: 1,
  },
  marker: {
    borderColor: '#00ACC1',
    borderRadius: 12,
  },
  topContent: {
    paddingTop: 100,
    paddingHorizontal: 32,
    paddingBottom: 20,
    alignItems: 'center',
  },
  instructionText: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 16,
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 172, 193, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  hintText: {
    color: '#84FFFF',
    fontSize: 13,
    flex: 1,
  },
  bottomContent: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  scanIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  scanningText: {
    color: "#00ACC1",
    fontSize: 16,
    fontWeight: '500',
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  cancelText: {
    color: "#fff",
    fontSize: 16,
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
    textAlign: 'center',
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
  },
});
