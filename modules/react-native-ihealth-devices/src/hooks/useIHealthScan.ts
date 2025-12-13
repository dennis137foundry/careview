import { useState, useEffect, useCallback } from 'react';
import { iHealthDevices } from '../IHealthDevicesManager';
import type { DeviceInfo, ScanOptions } from '../types';

export function useIHealthScan() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const deviceSub = iHealthDevices.onDeviceFound((device) => {
      setDevices((prev) => {
        const exists = prev.some((d) => d.mac === device.mac);
        if (exists) return prev.map((d) => (d.mac === device.mac ? device : d));
        return [...prev, device];
      });
    });

    const stateSub = iHealthDevices.onScanStateChanged((scanning) => {
      setIsScanning(scanning);
    });

    return () => {
      deviceSub.remove();
      stateSub.remove();
    };
  }, []);

  const startScan = useCallback(async (options?: ScanOptions) => {
    setError(null);
    try {
      await iHealthDevices.startScan(options);
      setIsScanning(true);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const stopScan = useCallback(async () => {
    try {
      await iHealthDevices.stopScan();
      setIsScanning(false);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const clearDevices = useCallback(() => setDevices([]), []);

  return { devices, isScanning, error, startScan, stopScan, clearDevices };
}
