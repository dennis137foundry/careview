// src/services/batteryRefreshService.ts
//
// Best-effort refresh of every registered iHealth device's battery level.
//
// The Devices screen and the low-battery warning before a capture both read
// devices.lastBattery, which is only ever updated when a device connects.
// Without this, a monitor charged overnight still showed last night's 11%
// the next morning and the app warned the patient to charge a full device.
//
// Runs at app start and on foreground (throttled). It scans briefly for the
// models the patient has registered and, for each registered device that
// answers, opens the battery-only connection (never a measurement) that the
// add-device flow already uses. A device that is asleep is simply not found
// and keeps its last reading and timestamp — the warning logic treats an old
// reading as unknown rather than as current.
//
// The iHealth SDK is a singleton: this must never overlap a capture or an
// add-device scan. Both call cancelBatteryRefresh() before they start.

import { Platform } from "react-native";
import type { EmitterSubscription } from "react-native";
import deviceService from "./deviceService";
import { getDevices, type DeviceRecord } from "./sqliteService";

// Models whose battery the SDK can report over a battery-only connection.
// HS4S has no battery API; generic-BLE devices report battery on their own
// connections and are never scanned here.
const BATTERY_MODELS = new Set(["BP3L", "BP5", "BP5S", "HS2", "HS2S", "BG5S"]);

const THROTTLE_MS = 10 * 60 * 1000; // at most one refresh per 10 minutes
const SCAN_WINDOW_MS = 12_000; // how long to listen for registered devices
const PER_DEVICE_TIMEOUT_MS = 6_000; // how long to wait for one battery read

let running = false;
let lastRunAt = 0;
let cancelled = false;
let subs: EmitterSubscription[] = [];
let timers: ReturnType<typeof setTimeout>[] = [];

function clearAll(): void {
  subs.forEach((s) => s.remove());
  subs = [];
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}

function later(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    timers.push(t);
  });
}

/** Stop a refresh in progress (capture / add-device is about to use the SDK). */
export function cancelBatteryRefresh(): void {
  if (!running) return;
  cancelled = true;
  clearAll();
  deviceService.stopScan().catch(() => {});
  running = false;
}

export function isBatteryRefreshRunning(): boolean {
  return running;
}

/**
 * Refresh battery levels for every registered iHealth device that is awake.
 * Silent on every failure — Bluetooth off, permission missing, nothing found.
 */
export async function refreshDeviceBatteries(opts: { force?: boolean } = {}): Promise<void> {
  if (running) return;
  if (!opts.force && Date.now() - lastRunAt < THROTTLE_MS) return;

  const targets: DeviceRecord[] = getDevices().filter(
    (d) => (d.source ?? "iHealthSDK") === "iHealthSDK" && !!d.model && BATTERY_MODELS.has(d.model)
  );
  if (targets.length === 0) return;

  try {
    const status = await deviceService.getBluetoothStatus();
    if (!status.ready) return;
  } catch {
    return;
  }

  running = true;
  cancelled = false;
  lastRunAt = Date.now();

  // The SDK must be authenticated before it will scan; the capture and
  // add-device flows do this too. Idempotent.
  try {
    await deviceService.authenticate();
  } catch {
    // authenticate() already swallows and reports; scanning may still work.
  }
  if (cancelled) {
    running = false;
    return;
  }

  const byMac = new Map<string, DeviceRecord>();
  targets.forEach((d) => byMac.set(d.mac.toUpperCase(), d));
  const found = new Map<string, DeviceRecord>();

  try {
    // 1. Scan for the models on file until every registered device has been
    //    seen or the window closes.
    await new Promise<void>((resolve) => {
      subs.push(
        deviceService.onDeviceFound((dev) => {
          const key = String(dev.mac || "").toUpperCase();
          const registered = byMac.get(key);
          if (!registered || found.has(key)) return;
          found.set(key, registered);
          if (found.size === byMac.size) resolve();
        })
      );
      timers.push(setTimeout(resolve, SCAN_WINDOW_MS));

      const models = Array.from(new Set(targets.map((d) => d.model as string)));
      const sdkTypes = models.filter((m) => m !== "BG5S" || Platform.OS === "android");
      const scans: Promise<unknown>[] = [];
      if (sdkTypes.length > 0) scans.push(deviceService.startScan(sdkTypes));
      // iOS discovers the BG5S through its own additive scan path.
      if (Platform.OS === "ios" && models.includes("BG5S")) {
        scans.push(deviceService.startBG5SScan());
      }
      Promise.all(scans).catch(() => resolve());
    });

    if (cancelled) return;
    clearAll();
    await deviceService.stopScan().catch(() => {});
    if (found.size === 0) return;

    // 2. One battery-only connection per device, in turn. The result lands
    //    via the app-level onBatteryLevel listener (App.tsx); here we only
    //    wait for it — or a timeout — before moving to the next device.
    for (const device of found.values()) {
      if (cancelled) return;
      await new Promise<void>((resolve) => {
        const sub = deviceService.onBatteryLevel(({ mac }) => {
          if (String(mac || "").toUpperCase() === device.mac.toUpperCase()) {
            sub.remove();
            resolve();
          }
        });
        subs.push(sub);
        timers.push(setTimeout(resolve, PER_DEVICE_TIMEOUT_MS));
        deviceService.connectForBattery(device.mac, device.model as string).catch(() => resolve());
      });
      // Let the SDK finish its own disconnect before the next connect.
      await later(800);
    }
  } catch (e) {
    console.warn("[BatteryRefresh] Failed:", e);
  } finally {
    clearAll();
    if (!cancelled) {
      deviceService.stopScan().catch(() => {});
    }
    running = false;
  }
}
