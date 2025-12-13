import { useState, useEffect, useCallback, useRef } from 'react';
import { iHealthDevices } from '../IHealthDevicesManager';
import type { DeviceInfo, DeviceType, MeasurementReading, ConnectOptions } from '../types';

export function useIHealthDevice() {
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [measurementState, setMeasurementState] = useState<'idle' | 'measuring' | 'complete' | 'error'>('idle');
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [lastReading, setLastReading] = useState<MeasurementReading | null>(null);
  const [readings, setReadings] = useState<MeasurementReading[]>([]);
  const [error, setError] = useState<string | null>(null);
  const connectedMac = useRef<string | null>(null);

  useEffect(() => {
    const connSub = iHealthDevices.onConnectionStateChanged((event: any) => {
      if (connectedMac.current && event.mac === connectedMac.current) {
        setConnectionState(event.connected ? 'connected' : 'disconnected');
        if (!event.connected) { setDevice(null); connectedMac.current = null; }
      }
    });
    const bpSub = iHealthDevices.onBloodPressureReading((reading) => {
      if (connectedMac.current && reading.deviceMac === connectedMac.current) {
        setLastReading(reading); setReadings((prev) => [...prev, reading]); setMeasurementState('complete');
      }
    });
    const bgSub = iHealthDevices.onBloodGlucoseReading((reading) => {
      if (connectedMac.current && reading.deviceMac === connectedMac.current) {
        setLastReading(reading); setReadings((prev) => [...prev, reading]); setMeasurementState('complete');
      }
    });
    const wtSub = iHealthDevices.onWeightReading((reading) => {
      if (connectedMac.current && reading.deviceMac === connectedMac.current) {
        setLastReading(reading); setReadings((prev) => [...prev, reading]); setMeasurementState('complete');
      }
    });
    return () => { connSub.remove(); bpSub.remove(); bgSub.remove(); wtSub.remove(); };
  }, []);

  const connect = useCallback(async (mac: string, deviceType: DeviceType, options?: ConnectOptions) => {
    setError(null); setConnectionState('connecting'); connectedMac.current = mac;
    try {
      const success = await iHealthDevices.connect(mac, deviceType, options);
      if (success) {
        setConnectionState('connected');
        setDevice({ mac, name: '', type: deviceType, connectionType: deviceType === 'BP5' || deviceType === 'BG5' ? 'CLASSIC' : 'BLE' });
        iHealthDevices.getBatteryLevel(mac).then(setBatteryLevel).catch(() => {});
      } else { throw new Error('Connection failed'); }
    } catch (e: any) { setConnectionState('error'); setError(e.message); connectedMac.current = null; }
  }, []);

  const disconnect = useCallback(async () => {
    if (connectedMac.current) {
      await iHealthDevices.disconnect(connectedMac.current);
      connectedMac.current = null; setConnectionState('disconnected'); setDevice(null); setBatteryLevel(null);
    }
  }, []);

  const startMeasurement = useCallback(async () => {
    if (!connectedMac.current) throw new Error('No device connected');
    setMeasurementState('measuring');
    await iHealthDevices.startMeasurement(connectedMac.current);
  }, []);

  const stopMeasurement = useCallback(async () => {
    if (connectedMac.current) await iHealthDevices.stopMeasurement(connectedMac.current);
    setMeasurementState('idle');
  }, []);

  const syncOfflineData = useCallback(async () => {
    if (!connectedMac.current) throw new Error('No device connected');
    const data = await iHealthDevices.syncOfflineData(connectedMac.current);
    setReadings((prev) => [...prev, ...data]);
    return data;
  }, []);

  const clearReadings = useCallback(() => { setReadings([]); setLastReading(null); setMeasurementState('idle'); }, []);

  return { connectionState, measurementState, device, batteryLevel, lastReading, readings, error, connect, disconnect, startMeasurement, stopMeasurement, syncOfflineData, clearReadings };
}
