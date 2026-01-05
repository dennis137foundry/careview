import { NativeModules, NativeEventEmitter } from 'react-native';

const { IHealthDevices } = NativeModules;
const emitter = new NativeEventEmitter(IHealthDevices);

export type DeviceType = 'BP' | 'SCALE' | 'BG';
export type Device = { id: string; name: string; type: DeviceType; mac?: string; image?: any };

export type ReadingPayload =
  | { type: 'BP'; systolic: number; diastolic: number; heartRate: number; unit: 'mmHg' }
  | { type: 'SCALE'; value: number; unit: 'lb' }
  | { type: 'BG'; value: number; unit: 'mg/dL' };

const img = {
  BP3L: require('../assets/bp3l.png'),
  BP5: require('../assets/bp3l.png'),
  BP5S: require('../assets/bp3l.png'),
  HS2S: require('../assets/hs5s.png'),
  BG5: require('../assets/bg5.png'),
  BG5S: require('../assets/bg5.png'),
};

function mapIHealthType(type: string): DeviceType {
  if (type.startsWith('BP')) return 'BP';
  if (type.startsWith('HS')) return 'SCALE';
  if (type.startsWith('BG')) return 'BG';
  return 'BP';
}

function getImage(type: string) {
  return img[type as keyof typeof img] || img.BP3L;
}

class deviceService {
  devices: Device[] = [];
  private authenticated = false;
  private scanSubscription: any = null;

  async authenticate(): Promise<boolean> {
    if (this.authenticated) return true;
    try {
      await IHealthDevices.authenticate('license.pem');
      this.authenticated = true;
      return true;
    } catch (e) {
      console.error('iHealth auth failed:', e);
      return false;
    }
  }

  async scan(timeoutMs = 12000): Promise<Device[]> {
    // Authenticate first if needed
    if (!this.authenticated) {
      const ok = await this.authenticate();
      if (!ok) {
        console.warn('Auth failed, returning empty device list');
        return [];
      }
    }

    this.devices = [];

    return new Promise((resolve) => {
      // Listen for discovered devices
      this.scanSubscription = emitter.addListener('onDeviceFound', (device) => {
        const exists = this.devices.find(d => d.mac === device.mac);
        if (!exists) {
          this.devices.push({
            id: device.mac,
            mac: device.mac,
            name: device.name || device.type,
            type: mapIHealthType(device.type),
            image: getImage(device.type),
          });
        }
      });

      // Start scanning for all supported device types
      IHealthDevices.startScan(['BP3L', 'BP5', 'BP5S', 'BG5', 'BG5S', 'HS2S']);

      // Stop after timeout
      setTimeout(async () => {
        await IHealthDevices.stopScan();
        this.scanSubscription?.remove();
        resolve(this.devices);
      }, timeoutMs);
    });
  }

  async connect(id: string, timeoutMs = 10000): Promise<boolean> {
    const device = this.devices.find(d => d.id === id || d.mac === id);
    if (!device) return false;

    // Determine iHealth device type from our device
    let iHealthType = 'BP3L';
    if (device.name.includes('BP5S')) iHealthType = 'BP5S';
    else if (device.name.includes('BP5')) iHealthType = 'BP5';
    else if (device.name.includes('BP3L')) iHealthType = 'BP3L';
    else if (device.name.includes('BG5S')) iHealthType = 'BG5S';
    else if (device.name.includes('BG5')) iHealthType = 'BG5';
    else if (device.name.includes('HS2S')) iHealthType = 'HS2S';

    return new Promise((resolve) => {
      const sub = emitter.addListener('onConnectionStateChanged', (event) => {
        if (event.mac === device.mac) {
          sub.remove();
          resolve(event.connected);
        }
      });

      IHealthDevices.connectDevice(device.mac, iHealthType);

      // Timeout
      setTimeout(() => {
        sub.remove();
        resolve(false);
      }, timeoutMs);
    });
  }

  async measure(device: Device): Promise<ReadingPayload> {
    return new Promise((resolve, reject) => {
      let sub: any;

      if (device.type === 'BP') {
        sub = emitter.addListener('onBloodPressureReading', (reading) => {
          if (reading.mac === device.mac || reading.mac === device.id) {
            sub.remove();
            resolve({
              type: 'BP',
              systolic: reading.systolic,
              diastolic: reading.diastolic,
              heartRate: reading.pulse,
              unit: 'mmHg',
            });
          }
        });
      } else if (device.type === 'BG') {
        sub = emitter.addListener('onBloodGlucoseReading', (reading) => {
          if (reading.mac === device.mac || reading.mac === device.id) {
            sub.remove();
            resolve({
              type: 'BG',
              value: reading.value,
              unit: 'mg/dL',
            });
          }
        });
      } else if (device.type === 'SCALE') {
        sub = emitter.addListener('onWeightReading', (reading) => {
          if (reading.mac === device.mac || reading.mac === device.id) {
            sub.remove();
            resolve({
              type: 'SCALE',
              value: reading.weight * 2.205, // kg to lb
              unit: 'lb',
            });
          }
        });
      }

      // Start measurement
      IHealthDevices.startMeasurement(device.mac || device.id);

      // Timeout after 60 seconds (measurements can take a while)
      setTimeout(() => {
        sub?.remove();
        reject(new Error('Measurement timeout'));
      }, 60000);
    });
  }

  async disconnect(id: string): Promise<void> {
    await IHealthDevices.disconnectDevice(id);
  }
}

const service = new deviceService();
export default service;