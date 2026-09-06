// src/services/urineReminderService.ts
//
// Local (on-device) reminder notifications for the urine protein check.
// Nothing here talks to a server: reminders are scheduled on the phone with
// Notifee at the moment a result (or a can't-test report) is saved, and the
// OS delivers them even if the app is closed.
//
// Schedule: first reminder at last result + 72h, then daily follow-ups for a
// week, all shifted out of the 21:00–08:00 quiet window. Saving a result
// cancels the series and starts a new one. Every call here swallows its own
// errors — a notification problem must never block recording a result.

import { Platform } from "react-native";
import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  TriggerType,
  type TimestampTrigger,
} from "@notifee/react-native";
import { getAppSetting, setAppSetting } from "./sqliteService";
import {
  buildReminderSchedule,
  UNABLE_GRACE_MS,
  URINE_INTERVAL_MS,
} from "./urineProteinLogic";

const CHANNEL_ID = "reminders";
const ID_PREFIX = "urine-reminder-";
const PERMISSION_ASKED_KEY = "urine_reminder_permission_asked";

// Lock-screen copy is deliberately generic; the clinical detail stays in the app.
const TITLE = "Time for your CareView check-in";
const BODY = "Record your urine protein result in the app.";

async function ensureChannel(): Promise<string> {
  if (Platform.OS !== "android") return CHANNEL_ID;
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: "Reminders",
    importance: AndroidImportance.HIGH,
  });
  return CHANNEL_ID;
}

function isAuthorized(status: AuthorizationStatus): boolean {
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

export function wasNotificationPermissionAsked(): boolean {
  return getAppSetting(PERMISSION_ASKED_KEY) === "1";
}

/** "Not now" on our own pre-prompt: remember it without showing the OS dialog. */
export function markNotificationPermissionAsked(): void {
  setAppSetting(PERMISSION_ASKED_KEY, "1");
}

export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const settings = await notifee.getNotificationSettings();
    return isAuthorized(settings.authorizationStatus);
  } catch {
    return false;
  }
}

/**
 * Show the system permission prompt (iOS, and Android 13+). Recorded as
 * asked regardless of the answer so we do not nag on every dashboard visit.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  setAppSetting(PERMISSION_ASKED_KEY, "1");
  try {
    const settings = await notifee.requestPermission();
    return isAuthorized(settings.authorizationStatus);
  } catch (e) {
    console.warn("[UrineReminder] Permission request failed:", e);
    return false;
  }
}

export async function cancelUrineReminders(): Promise<void> {
  try {
    const ids = await notifee.getTriggerNotificationIds();
    await Promise.all(
      ids
        .filter((id) => id.startsWith(ID_PREFIX))
        .map((id) => notifee.cancelTriggerNotification(id))
    );
  } catch (e) {
    console.warn("[UrineReminder] Cancel failed:", e);
  }
}

async function scheduleAt(times: number[]): Promise<void> {
  const channelId = await ensureChannel();
  for (let i = 0; i < times.length; i++) {
    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: times[i],
    };
    await notifee.createTriggerNotification(
      {
        id: `${ID_PREFIX}${i}`,
        title: TITLE,
        body: BODY,
        android: {
          channelId,
          pressAction: { id: "default" },
        },
      },
      trigger
    );
  }
}

/** Called after a result is saved: series restarts from that moment. */
export async function scheduleUrineReminders(anchorMs: number): Promise<void> {
  try {
    await cancelUrineReminders();
    const times = buildReminderSchedule({
      firstAt: anchorMs + URINE_INTERVAL_MS,
      now: Date.now(),
    });
    await scheduleAt(times);
  } catch (e) {
    console.warn("[UrineReminder] Schedule failed:", e);
  }
}

/** Called after a can't-test report: next reminder when the grace ends. */
export async function scheduleUnableFollowUp(unableAtMs: number): Promise<void> {
  try {
    await cancelUrineReminders();
    const times = buildReminderSchedule({
      firstAt: unableAtMs + UNABLE_GRACE_MS,
      now: Date.now(),
    });
    await scheduleAt(times);
  } catch (e) {
    console.warn("[UrineReminder] Follow-up schedule failed:", e);
  }
}

/**
 * On launch: if nothing is pending (fresh install, cleared data, OS purged
 * the triggers) rebuild the series from the last known result. With no
 * result on record there is nothing to anchor to; login schedules that case.
 */
export async function ensureUrineRemindersScheduled(
  lastResultAt: number | null
): Promise<void> {
  try {
    const ids = await notifee.getTriggerNotificationIds();
    if (ids.some((id) => id.startsWith(ID_PREFIX))) return;
    if (lastResultAt === null) return;
    await scheduleUrineReminders(lastResultAt);
  } catch (e) {
    console.warn("[UrineReminder] Ensure failed:", e);
  }
}
