import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type {
  DeviceType,
  DeviceInfo,
  AuthResult,
  ScanOptions,
  ConnectOptions,
  BloodPressureReading,
  BloodGlucoseReading,
  WeightReading,
  MeasurementReading,
} from './types';

const LINKING_ERROR =
  `The package 'react-native-ihealth-devices' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n';

const NativeIHealthDevices = NativeModules.IHealthDevices
  ? NativeModules.IHealthDevices
  : new Proxy({}, { get() { throw new Error(LINKING_ERROR); } });

const eventEmitter = new NativeEventEmitter(NativeIHealthDevices);

type Subscription = { remove: () => void };

class IHealthDevicesManager {
  private authenticated = false;
  private connectedDevices: Map<string, DeviceInfo> = new Map();

  async authenticate(licensePath: string = 'license.pem'): Promise<AuthResult> {
    try {
      const success = await NativeIHealthDevices.authenticate(licensePath);
      this.authenticated = success;
      if (success) {
        return { success: true, authorizedDevices: ['BP3L', 'BP5', 'BP5S', 'BG5', 'BG5S', 'HS2S'] };
      }
      return { success: false, error: 'Authentication failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return NativeIHealthDevices.isAuthenticated();
  }

  async startScan(options: ScanOptions = {}): Promise<void> {
    const { deviceTypes = ['BP3L', 'BP5', 'BP5S', 'BG5', 'BG5S', 'HS2S'], timeout = 30000 } = options;
    await NativeIHealthDevices.startScan(deviceTypes);
    if (timeout > 0) {
      setTimeout(() => { this.stopScan().catch(() => {}); }, timeout);
    }
  }

  async stopScan(): Promise<void> {
    return NativeIHealthDevices.stopScan();
  }

  onDeviceFound(callback: (device: DeviceInfo) => void): Subscription {
    return eventEmitter.addListener('onDeviceFound', callback);
  }

  onScanStateChanged(callback: (scanning: boolean) => void): Subscription {
    return eventEmitter.addListener('onScanStateChanged', (data: any) => callback(data.scanning));
  }

  async connect(mac: string, deviceType: DeviceType, options: ConnectOptions = {}): Promise<boolean> {
    const success = await NativeIHealthDevices.connectDevice(mac, deviceType);
    if (success) {
      this.connectedDevices.set(mac, { mac, name: '', type: deviceType, connectionType: this.getConnectionType(deviceType) });
    }
    return success;
  }

  async disconnect(mac: string): Promise<void> {
    await NativeIHealthDevices.disconnectDevice(mac);
    this.connectedDevices.delete(mac);
  }

  async disconnectAll(): Promise<void> {
    await NativeIHealthDevices.disconnectAll();
    this.connectedDevices.clear();
  }

  onConnectionStateChanged(callback: (event: any) => void): Subscription {
    return eventEmitter.addListener('onConnectionStateChanged', callback);
  }

  async startMeasurement(mac: string): Promise<void> {
    return NativeIHealthDevices.startMeasurement(mac);
  }

  async stopMeasurement(mac: string): Promise<void> {
    return NativeIHealthDevices.stopMeasurement(mac);
  }

  async syncOfflineData(mac: string): Promise<MeasurementReading[]> {
    const json = await NativeIHealthDevices.syncOfflineData(mac);
    return JSON.parse(json);
  }

  onBloodPressureReading(callback: (reading: BloodPressureReading) => void): Subscription {
    return eventEmitter.addListener('onBloodPressureReading', (data: any) => {
      callback({ ...data, timestamp: new Date(data.timestamp) });
    });
  }

  onBloodGlucoseReading(callback: (reading: BloodGlucoseReading) => void): Subscription {
    return eventEmitter.addListener('onBloodGlucoseReading', (data: any) => {
      callback({ ...data, timestamp: new Date(data.timestamp) });
    });
  }

  onWeightReading(callback: (reading: WeightReading) => void): Subscription {
    return eventEmitter.addListener('onWeightReading', (data: any) => {
      callback({ ...data, timestamp: new Date(data.timestamp) });
    });
  }

  async getBatteryLevel(mac: string): Promise<number> {
    return NativeIHealthDevices.getBatteryLevel(mac);
  }

  removeAllListeners(): void {
    eventEmitter.removeAllListeners('onDeviceFound');
    eventEmitter.removeAllListeners('onScanStateChanged');
    eventEmitter.removeAllListeners('onConnectionStateChanged');
    eventEmitter.removeAllListeners('onBloodPressureReading');
    eventEmitter.removeAllListeners('onBloodGlucoseReading');
    eventEmitter.removeAllListeners('onWeightReading');
  }

  private getConnectionType(deviceType: DeviceType): 'BLE' | 'CLASSIC' {
    return (deviceType === 'BP5' || deviceType === 'BG5') ? 'CLASSIC' : 'BLE';
  }
}

export const iHealthDevices = new IHealthDevicesManager();
export { IHealthDevicesManager };
