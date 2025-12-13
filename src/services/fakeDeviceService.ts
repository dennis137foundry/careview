// Simulates iHealth devices reliably (no native code)
export type DeviceType = 'BP' | 'SCALE' | 'BG';
export type Device = { id: string; name: string; type: DeviceType; image?: any };

export type ReadingPayload =
  | { type: 'BP'; systolic: number; diastolic: number; heartRate: number; unit: 'mmHg' }
  | { type: 'SCALE'; value: number; unit: 'lb' }
  | { type: 'BG'; value: number; unit: 'mg/dL' };

const img = {
  BP3L: require('../assets/bp3l.png'),
  HS5S: require('../assets/hs5s.png'),
  BG5S: require('../assets/bg5.png'),
};

class FakeDeviceService {
  devices: Device[] = [
    { id: 'BP3L-001', name: 'Blood Pressure Monitor', type: 'BP', image: img.BP3L },
    { id: 'HS5S-001', name: 'Scale', type: 'SCALE', image: img.HS5S },
    { id: 'BG5S-001', name: 'Glucose Monitor', type: 'BG', image: img.BG5S },
  ];

  async scan(timeoutMs = 900): Promise<Device[]> {
    await new Promise<void>(r => setTimeout(r, timeoutMs));
    return this.devices;
  }

  async connect(_id: string, timeoutMs = 1200): Promise<boolean> {
    await new Promise<void>(r => setTimeout(r, timeoutMs));
    return true;
  }

  async measure(device: Device): Promise<ReadingPayload> {
    // simulate measuring delay
    await new Promise<void>(r => setTimeout(r, 1500));

    if (device.type === 'BP') {
      const systolic = Math.round(110 + Math.random() * 30);   // 110–140
      const diastolic = Math.round(70 + Math.random() * 20);   // 70–90
      const heartRate = Math.round(60 + Math.random() * 30);   // 60–90
      return { type: 'BP', systolic, diastolic, heartRate, unit: 'mmHg' };
    }
    if (device.type === 'SCALE') {
      const value = Math.round((130 + Math.random() * 80) * 10) / 10; // 130–210 lb
      return { type: 'SCALE', value, unit: 'lb' };
    }
    // BG
    const value = Math.round(85 + Math.random() * 75); // 85–160 mg/dL
    return { type: 'BG', value, unit: 'mg/dL' };
  }
}

const service = new FakeDeviceService();
export default service;