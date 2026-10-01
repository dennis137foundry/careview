/**
 * cgmSyncService.ts — sends Dexcom CGM readings from the phone's health store
 * (Apple Health / Health Connect) to the EMR.
 *
 * Separate from vitalsSyncService on purpose: a sensor gives ~288 readings a
 * day, so they are NOT stored in the local readings table (History would drown)
 * and are sent straight from the health store in large batches. The only local
 * state is a few app_settings keys — wiped with every other patient setting
 * when a different patient signs in (wipeAllPatientData).
 *
 * When it runs: at launch, every return to the foreground, every 15 minutes
 * while the app is open, right after connecting, and on "Send now". It does not
 * run while the app is closed yet (background fetch is a later step).
 */
import { AppState } from "react-native";
import { getAppSetting, setAppSetting, getUser } from "../sqliteService";
import { authedFetch } from "../authToken";
import { isDemoAccount } from "../seedDemoData";
import { getHealthSource } from "./cgmHealthSource";
import {
  CGM_CONFIG,
  chunk,
  cleanSamples,
  newestTs,
  syncWindowStart,
  toPayload,
} from "./cgmLogic";

const VITALS_URL = "https://trinitycareview.com/api/careviewapp/vitals_sync.php";
const REQUEST_TIMEOUT_MS = 30000;

const KEY = {
  connected: "cgm_connected",
  lastSentTs: "cgm_last_sent_ts",
  lastSyncAt: "cgm_last_sync_at",
  lastError: "cgm_last_error",
} as const;

export interface CgmStatus {
  connected: boolean;
  syncing: boolean;
  /** newest Dexcom reading the EMR has (epoch ms) */
  lastReadingTs: number | null;
  /** last time a sync finished (epoch ms) */
  lastSyncAt: number | null;
  lastError: string | null;
  /** readings sent in the last sync */
  lastSent: number;
}

let syncing = false;
let lastSent = 0;
const listeners = new Set<(s: CgmStatus) => void>();

const num = (v: string | null) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function getCgmStatus(): CgmStatus {
  return {
    connected: getAppSetting(KEY.connected) === "1",
    syncing,
    lastReadingTs: num(getAppSetting(KEY.lastSentTs)),
    lastSyncAt: num(getAppSetting(KEY.lastSyncAt)),
    lastError: getAppSetting(KEY.lastError) || null,
    lastSent,
  };
}

export function onCgmStatus(fn: (s: CgmStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  const s = getCgmStatus();
  listeners.forEach((fn) => fn(s));
}

/** Ask for health-store access; on success remember it and send what is there. */
export async function connectCgm(): Promise<boolean> {
  const source = getHealthSource();
  if (!source) return false;
  const ok = await source.requestAccess();
  if (ok) {
    setAppSetting(KEY.connected, "1");
    setAppSetting(KEY.lastError, "");
    emit();
    syncCgm("connect");
  }
  return ok;
}

/** Stop sending. Access in Apple Health / Health Connect stays until the patient removes it there. */
export function disconnectCgm(): void {
  setAppSetting(KEY.connected, "0");
  emit();
}

async function post(body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await authedFetch(VITALS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the new Dexcom readings and send them. Single-flight: a call while one
 * is running returns at once. Never throws.
 */
export async function syncCgm(reason: string = "manual"): Promise<void> {
  if (syncing || getAppSetting(KEY.connected) !== "1") return;
  const source = getHealthSource();
  if (!source) return;

  syncing = true;
  emit();
  try {
    const user = await getUser();
    if (!user?.patientId) return;
    // The App Store reviewer's demo account never reaches the EMR.
    if (user.phone && isDemoAccount(user.phone)) return;

    if ((await source.hasAccess()) === false) {
      setAppSetting(KEY.lastError, `${source.name} access was turned off`);
      return;
    }

    const now = Date.now();
    let sentTs = num(getAppSetting(KEY.lastSentTs));
    const samples = cleanSamples(await source.read(syncWindowStart(sentTs, now), now));
    let sent = 0;

    for (const batch of chunk(samples.map(toPayload), CGM_CONFIG.batchSize)) {
      const res = await post({ patient_id: parseInt(user.patientId, 10), vitals: batch });
      // 200 = all stored or already there; 207 = some refused for good (e.g. a
      // date before her enrollment) — both mean this batch is done.
      if (res.status !== 200 && res.status !== 207) {
        throw new Error(`EMR returned ${res.status}`);
      }
      const json = await res.json().catch(() => null);
      sent += Number(json?.summary?.inserted ?? 0);
      sentTs = newestTs(batch, sentTs);
      setAppSetting(KEY.lastSentTs, String(sentTs));
    }

    lastSent = sent;
    setAppSetting(KEY.lastError, "");
    if (__DEV__) {
      console.log(`[CgmSync] ${reason}: ${samples.length} Dexcom readings read, ${sent} new`);
    }
  } catch (e: any) {
    setAppSetting(KEY.lastError, String(e?.message ?? e));
    if (__DEV__) console.log("[CgmSync] failed:", e?.message ?? e);
  } finally {
    setAppSetting(KEY.lastSyncAt, String(Date.now()));
    syncing = false;
    emit();
  }
}

/** Start the launch / foreground / every-15-minutes runs. Returns cleanup. */
export function initializeCgmSync(): () => void {
  syncCgm("launch");
  let timer: ReturnType<typeof setInterval> | null = setInterval(
    () => syncCgm("timer"),
    CGM_CONFIG.foregroundIntervalMs
  );
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      syncCgm("foreground");
      if (!timer) timer = setInterval(() => syncCgm("timer"), CGM_CONFIG.foregroundIntervalMs);
    } else if (state === "background" && timer) {
      clearInterval(timer);
      timer = null;
    }
  });
  return () => {
    sub.remove();
    if (timer) clearInterval(timer);
  };
}
