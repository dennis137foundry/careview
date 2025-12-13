export type DeviceType = 
  | 'BP3L' | 'BP5' | 'BP5S'
  | 'BG5' | 'BG5S'
  | 'HS2S';

export type ConnectionType = 'BLE' | 'CLASSIC';

export interface DeviceInfo {
  mac: string;
  name: string;
  type: DeviceType;
  connectionType: ConnectionType;
  rssi?: number;
}

export interface BloodPressureReading {
  systolic: number;
  diastolic: number;
  pulse: number;
  irregularHeartbeat: boolean;
  timestamp: Date;
  deviceMac: string;
}

export interface BloodGlucoseReading {
  value: number;
  mealFlag?: 'before' | 'after' | 'fasting' | 'random';
  timestamp: Date;
  deviceMac: string;
}

export interface WeightReading {
  weight: number;
  bmi?: number;
  bodyFat?: number;
  timestamp: Date;
  deviceMac: string;
}

export type MeasurementReading = BloodPressureReading | BloodGlucoseReading | WeightReading;

export interface AuthResult {
  success: boolean;
  error?: string;
  authorizedDevices?: DeviceType[];
}

export interface ScanOptions {
  deviceTypes?: DeviceType[];
  timeout?: number;
}

export interface ConnectOptions {
  timeout?: number;
  autoSync?: boolean;
}
