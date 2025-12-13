/* eslint-disable react-native/no-inline-styles */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  FlatList,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useDispatch } from "react-redux";
import { addDevice } from "../../redux/deviceSlice";
import type { AppDispatch } from "../../redux/store";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { NativeModules, NativeEventEmitter, PermissionsAndroid } from "react-native";

const { IHealthDevices } = NativeModules;
const emitter = IHealthDevices ? new NativeEventEmitter(IHealthDevices) : null;

// Map device type codes to human-readable categories
const deviceTypeMap: Record<string, 'BP' | 'SCALE' | 'BG'> = {
  'BP3L': 'BP',
  'BP5': 'BP',
  'BP5S': 'BP',
  'BG5': 'BG',
  'BG5S': 'BG',
  'HS2S': 'SCALE',
  'HS2': 'SCALE',
  'HS4S': 'SCALE',
};

const deviceTypeLabels: Record<string, string> = {
  'BP3L': 'Blood Pressure Monitor',
  'BP5': 'Blood Pressure Monitor',
  'BP5S': 'Blood Pressure Monitor',
  'BG5': 'Glucose Meter (QR Required)',
  'BG5S': 'Glucose Meter',
  'HS2S': 'Smart Scale',
  'HS2': 'Smart Scale',
  'HS4S': 'Smart Scale',
};

const deviceIcons: Record<string, string> = {
  'BP': 'favorite',
  'SCALE': 'monitor-weight',
  'BG': 'bloodtype',
};

type DiscoveredDevice = {
  mac: string;
  name: string;
  type: string;  // The model: BP3L, BG5, BG5S, etc.
  rssi: number;
};

export default function AddDeviceScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [_debugLogs, setDebugLogs] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    console.log(`[AddDevice] ${msg}`);
    setDebugLogs(prev => [...prev.slice(-50), `${new Date().toLocaleTimeString()}: ${msg}`]);
  }, []);

  // Request permissions on Android
  useEffect(() => {
    if (Platform.OS === 'android') {
      const requestPermissions = async () => {
        try {
          const granted = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]);
          addLog(`Permissions: ${JSON.stringify(granted)}`);
        } catch (e) {
          addLog(`Permission error: ${e}`);
        }
      };
      requestPermissions();
    }
  }, [addLog]);

  // Listen for discovered devices
  useEffect(() => {
    if (!emitter) {
      addLog("Native module not available");
      return;
    }

    const sub = emitter.addListener('onDeviceFound', (device: DiscoveredDevice) => {
      addLog(`Found: ${device.name} (${device.type}) MAC=${device.mac}`);
      
      setDevices(prev => {
        // Avoid duplicates
        if (prev.find(d => d.mac === device.mac)) {
          return prev;
        }
        return [...prev, device];
      });
    });

    const debugSub = emitter.addListener('onDebugLog', (data: { message: string }) => {
      addLog(`[Native] ${data.message}`);
    });

    return () => {
      sub.remove();
      debugSub.remove();
    };
  }, [addLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanning && IHealthDevices?.stopScan) {
        IHealthDevices.stopScan().catch(() => {});
      }
    };
  }, [scanning]);

  const startScan = async () => {
    if (!IHealthDevices) {
      Alert.alert("Error", "Native module not available");
      return;
    }

    setDevices([]);
    setScanning(true);
    addLog("Starting scan...");

    try {
      // Authenticate first
      addLog("Authenticating SDK...");
      await IHealthDevices.authenticate('license.pem');
      addLog("✅ Authenticated");
    } catch (e: any) {
      addLog(`Auth note: ${e.message}`);
    }

    try {
      // Scan for all supported device types
      await IHealthDevices.startScan(['BP3L', 'BP5', 'BP5S', 'BG5', 'BG5S', 'HS2S', 'HS2', 'HS4S']);
      addLog("✅ Scan started - wake your devices!");

      // Auto-stop after 30 seconds
      setTimeout(() => {
        stopScan();
      }, 30000);
    } catch (e: any) {
      addLog(`Scan error: ${e.message}`);
      Alert.alert("Scan Error", e.message);
      setScanning(false);
    }
  };

  const stopScan = async () => {
    if (IHealthDevices?.stopScan) {
      try {
        await IHealthDevices.stopScan();
        addLog("Scan stopped");
      } catch (e) {
        // Ignore
      }
    }
    setScanning(false);
  };

  const selectDevice = (device: DiscoveredDevice) => {
    const category = deviceTypeMap[device.type] || 'BP';
    const isBG5 = device.type === 'BG5';

    Alert.alert(
      "Add Device",
      `Add "${device.name}" (${device.type}) to your devices?${isBG5 ? '\n\nNote: BG5 requires scanning test strip bottle QR code.' : ''}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isBG5 ? "Add & Scan QR" : "Add",
          onPress: () => {
            stopScan();
            
            // Save device with model info
            const newDevice = {
              id: device.mac,
              name: device.name || device.type,
              type: category,
              mac: device.mac,
              model: device.type,  // BP3L, BG5, BG5S, HS2S, etc.
              bottleCode: undefined,
            };
            
            dispatch(addDevice(newDevice));
            addLog(`✅ Device saved: ${device.name}`);

            if (isBG5) {
              // Navigate to QR scanner for BG5
              navigation.replace('ScanQR', {
                deviceId: device.mac,
                deviceName: device.name,
                returnTo: 'Capture',
              });
            } else {
              // Go back to devices list
              navigation.goBack();
            }
          },
        },
      ]
    );
  };

  const handleScanQR = () => {
    navigation.navigate('ScanQR');
  };

  const renderDevice = ({ item }: { item: DiscoveredDevice }) => {
    const category = deviceTypeMap[item.type] || 'BP';
    const icon = deviceIcons[category] || 'bluetooth';
    const label = deviceTypeLabels[item.type] || item.type;
    const isBG5 = item.type === 'BG5';

    return (
      <TouchableOpacity
        style={styles.deviceCard}
        onPress={() => selectDevice(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.deviceIcon, { backgroundColor: getIconBg(category) }]}>
          <MaterialIcons name={icon} size={24} color={getIconColor(category)} />
        </View>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name || item.type}</Text>
          <Text style={styles.deviceType}>{label}</Text>
          <Text style={styles.deviceMac}>{item.mac}</Text>
        </View>
        <View style={styles.deviceAction}>
          {isBG5 && (
            <MaterialIcons name="qr-code" size={16} color="#FF9800" style={{ marginRight: 4 }} />
          )}
          <MaterialIcons name="add-circle" size={28} color="#00509f" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#1a1a2e" />
        </TouchableOpacity>
        <Text style={styles.title}>Add Device</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Instructions */}
      <View style={styles.instructions}>
        <MaterialIcons name="bluetooth-searching" size={48} color="#00509f" />
        <Text style={styles.instructionTitle}>
          {scanning ? "Searching for devices..." : "Find Your Device"}
        </Text>
        <Text style={styles.instructionText}>
          {scanning 
            ? "Wake your device: press the button on BP monitors, step on scales, or turn on glucose meters."
            : "Make sure your iHealth device is nearby and ready to pair."}
        </Text>
      </View>

      {/* Scan Button */}
      <TouchableOpacity
        style={[styles.scanButton, scanning && styles.scanButtonActive]}
        onPress={scanning ? stopScan : startScan}
        activeOpacity={0.8}
      >
        {scanning ? (
          <>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.scanButtonText}>Stop Scanning</Text>
          </>
        ) : (
          <>
            <MaterialIcons name="bluetooth-searching" size={24} color="#fff" />
            <Text style={styles.scanButtonText}>Start Scanning</Text>
          </>
        )}
      </TouchableOpacity>

      {/* QR Scan Option */}
      <TouchableOpacity style={styles.qrButton} onPress={handleScanQR}>
        <MaterialIcons name="qr-code-scanner" size={20} color="#00509f" />
        <Text style={styles.qrButtonText}>Scan QR Code Instead</Text>
      </TouchableOpacity>

      {/* Device List */}
      {devices.length > 0 && (
        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>Found Devices ({devices.length})</Text>
          <FlatList
            data={devices}
            keyExtractor={(item) => item.mac}
            renderItem={renderDevice}
            contentContainerStyle={styles.listContent}
          />
        </View>
      )}

      {/* Empty State */}
      {scanning && devices.length === 0 && (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color="#00509f" />
          <Text style={styles.emptyText}>Looking for devices...</Text>
          <Text style={styles.emptyHint}>
            Press the button on your BP monitor, step on your scale, or turn on your glucose meter.
          </Text>
        </View>
      )}
    </View>
  );
}

function getIconBg(type: string): string {
  switch (type) {
    case 'BP': return 'rgba(244, 67, 54, 0.1)';
    case 'SCALE': return 'rgba(76, 175, 80, 0.1)';
    case 'BG': return 'rgba(33, 150, 243, 0.1)';
    default: return 'rgba(0, 0, 0, 0.05)';
  }
}

function getIconColor(type: string): string {
  switch (type) {
    case 'BP': return '#F44336';
    case 'SCALE': return '#4CAF50';
    case 'BG': return '#2196F3';
    default: return '#666';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  instructions: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
    marginBottom: 16,
  },
  instructionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a2e',
    marginTop: 12,
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00509f',
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  scanButtonActive: {
    backgroundColor: '#c62828',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 80, 159, 0.1)',
    gap: 8,
  },
  qrButtonText: {
    color: '#00509f',
    fontSize: 14,
    fontWeight: '500',
  },
  listContainer: {
    flex: 1,
    marginTop: 16,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  deviceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  deviceType: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  deviceMac: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  deviceAction: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
});