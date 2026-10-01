/**
 * cgmHealthSource.ts — reads glucose samples from the phone's health store.
 *
 * iPhone: Apple Health (HealthKit) via react-native-health. iOS never says
 *   whether READ permission was granted (privacy): a denied read simply returns
 *   no samples. So "connected" is remembered locally once the permission sheet
 *   has been answered, and "no Dexcom readings found" is shown when none arrive.
 * Android: Health Connect via react-native-health-connect (Android 8+; built in
 *   from Android 14, an app from Google Play before that). Permission state is
 *   known exactly.
 *
 * Every sample is returned with the app that wrote it; cgmLogic keeps only the
 * Dexcom ones.
 */
import { Linking, Platform } from "react-native";
import type { CgmSample } from "./cgmLogic";

export type HealthAvailability =
  | "available"
  /** Android: Health Connect missing or out of date — it must be installed/updated from Google Play */
  | "needs_install"
  /** Device cannot do it at all (iPad without Health, Android 7) */
  | "unsupported";

export interface HealthSource {
  /** "Apple Health" / "Health Connect" — said to the patient */
  name: string;
  availability(): Promise<HealthAvailability>;
  /** Shows the system permission sheet. Resolves true when it was answered (iOS) / granted (Android). */
  requestAccess(): Promise<boolean>;
  /** Android: is read access still granted? iOS: always null (cannot be known). */
  hasAccess(): Promise<boolean | null>;
  read(startMs: number, endMs: number): Promise<CgmSample[]>;
  /** Where the patient goes to install/manage the store */
  openSettings(): void;
}

// ---------------------------------------------------------------------------
// iPhone — Apple Health
// ---------------------------------------------------------------------------

function appleHealth(): HealthSource {
  // Required lazily: the module does not exist in the Android build.
  const AppleHealthKit = require("react-native-health").default;
  const permissions = {
    permissions: {
      read: [AppleHealthKit.Constants.Permissions.BloodGlucose],
      write: [],
    },
  };

  return {
    name: "Apple Health",
    availability: () =>
      new Promise((resolve) =>
        AppleHealthKit.isAvailable((_err: unknown, ok: boolean) =>
          resolve(ok ? "available" : "unsupported")
        )
      ),
    requestAccess: () =>
      new Promise((resolve) =>
        AppleHealthKit.initHealthKit(permissions, (err: string) => resolve(!err))
      ),
    hasAccess: async () => null,
    read: (startMs, endMs) =>
      new Promise((resolve, reject) => {
        // initHealthKit is a no-op sheet-wise once answered, but must run in
        // every app session before a query.
        AppleHealthKit.initHealthKit(permissions, (initErr: string) => {
          if (initErr) {
            reject(new Error(String(initErr)));
            return;
          }
          AppleHealthKit.getBloodGlucoseSamples(
            {
              startDate: new Date(startMs).toISOString(),
              endDate: new Date(endMs).toISOString(),
              ascending: true,
              unit: "mgPerdL",
            },
            (err: string, results: any[]) => {
              if (err) {
                reject(new Error(String(err)));
                return;
              }
              resolve(
                (results ?? []).map((r) => ({
                  id: String(r.id ?? ""),
                  value: Number(r.value),
                  ts: Date.parse(r.startDate),
                  sourceId: String(r.sourceId ?? ""),
                  sourceName: String(r.sourceName ?? ""),
                }))
              );
            }
          );
        });
      }),
    openSettings: () => {
      Linking.openURL("x-apple-health://").catch(() => Linking.openSettings());
    },
  };
}

// ---------------------------------------------------------------------------
// Android — Health Connect
// ---------------------------------------------------------------------------

function healthConnect(): HealthSource {
  const HC = require("react-native-health-connect");
  const READ = [{ accessType: "read", recordType: "BloodGlucose" }];
  let ready = false;
  const init = async () => {
    if (!ready) {
      ready = await HC.initialize();
    }
    return ready;
  };
  const granted = async () => {
    const list: Array<{ accessType: string; recordType: string }> = await HC.getGrantedPermissions();
    return list.some((p) => p.accessType === "read" && p.recordType === "BloodGlucose");
  };

  return {
    name: "Health Connect",
    availability: async () => {
      if (Platform.OS !== "android" || (Platform.Version as number) < 26) {
        return "unsupported";
      }
      try {
        const status: number = await HC.getSdkStatus();
        if (status === HC.SdkAvailabilityStatus.SDK_AVAILABLE) return "available";
        if (status === HC.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "needs_install";
        // SDK_UNAVAILABLE: on Android 8–13 Health Connect is a Play Store app
        return (Platform.Version as number) < 34 ? "needs_install" : "unsupported";
      } catch {
        return "unsupported";
      }
    },
    requestAccess: async () => {
      if (!(await init())) return false;
      await HC.requestPermission(READ);
      return granted();
    },
    hasAccess: async () => {
      try {
        return (await init()) ? await granted() : false;
      } catch {
        return false;
      }
    },
    read: async (startMs, endMs) => {
      if (!(await init())) {
        throw new Error("Health Connect is not available");
      }
      const out: CgmSample[] = [];
      let pageToken: string | undefined;
      do {
        const res = await HC.readRecords("BloodGlucose", {
          timeRangeFilter: {
            operator: "between",
            startTime: new Date(startMs).toISOString(),
            endTime: new Date(endMs).toISOString(),
          },
          ascendingOrder: true,
          pageSize: 1000,
          pageToken,
        });
        for (const r of res.records ?? []) {
          out.push({
            id: String(r.metadata?.id ?? ""),
            value: Number(r.level?.inMilligramsPerDeciliter),
            ts: Date.parse(r.time),
            sourceId: String(r.metadata?.dataOrigin ?? ""),
          });
        }
        pageToken = res.pageToken || undefined;
      } while (pageToken);
      return out;
    },
    openSettings: () => {
      try {
        HC.openHealthConnectSettings();
      } catch {
        Linking.openURL(
          "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata"
        );
      }
    },
  };
}

let source: HealthSource | null = null;

/** The phone's health store, or null on a platform without one. */
export function getHealthSource(): HealthSource | null {
  if (source) return source;
  if (Platform.OS === "ios") source = appleHealth();
  else if (Platform.OS === "android") source = healthConnect();
  return source;
}

/** Google Play page for Health Connect (Android 8–13). */
export const HEALTH_CONNECT_PLAY_URL =
  "market://details?id=com.google.android.apps.healthdata";
