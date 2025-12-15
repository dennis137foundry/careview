/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, Platform, TouchableOpacity, Dimensions } from "react-native";
import QRCodeScanner from "react-native-qrcode-scanner";
import { RNCamera } from "react-native-camera";
import { request, PERMISSIONS, RESULTS } from "react-native-permissions";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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
    ? `Scan Code${deviceName ? ` - ${deviceName}` : ''}`
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
      <QRCodeScanner
        onRead={onSuccess}
        flashMode={RNCamera.Constants.FlashMode.off}
        showMarker={true}
        markerStyle={styles.marker}
        cameraStyle={styles.camera}
        containerStyle={styles.cameraContainer}
        topViewStyle={styles.zeroView}
        bottomViewStyle={styles.zeroView}
        reactivate={true}
        reactivateTimeout={2000}
      />

      {/* Overlay UI - positioned absolutely over the camera */}
      <View style={styles.overlay} pointerEvents="box-none">
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

        {/* Instructions at top */}
        <View style={styles.topContent}>
          <Text style={styles.instructionText}>
            {isUpdatingExisting 
              ? "Scan the QR code on your test strip bottle"
              : "Align the QR code within the frame"}
          </Text>
        </View>

        {/* Spacer for scanner area */}
        <View style={styles.scannerArea} />

        {/* Bottom controls */}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: "#000",
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    height: SCREEN_HEIGHT,
    width: SCREEN_WIDTH,
  },
  zeroView: {
    height: 0,
    flex: 0,
  },
  marker: {
    borderColor: '#00ACC1',
    borderRadius: 12,
    borderWidth: 3,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
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
    fontSize: 17,
    fontWeight: '600',
  },
  topContent: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
  },
  instructionText: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
  },
  scannerArea: {
    flex: 1,
  },
  bottomContent: {
    paddingVertical: 32,
    paddingBottom: 50,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  scanIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  scanningText: {
    color: "#00ACC1",
    fontSize: 16,
    fontWeight: '500',
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  cancelText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: '500',
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