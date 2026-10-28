// History tab (HistoryScreen), plus the labels for the stored glucose sample
// windows that the History and Home screens both show. Urine protein results
// and can't-test reasons are labelled by urineProteinLogic (urine.* keys).
// The History CSV export is NOT here: it stays English.
const history = {
  "history.title": "History",
  "history.export": "Export",

  // Section tabs (a device's own name is used when it has one)
  "history.tabBloodPressure": "Blood Pressure",
  "history.tabWeight": "Weight",
  "history.tabGlucose": "Glucose",
  "history.tabDailyHealth": "Daily Health",
  "history.tabUrineProtein": "Urine Protein",
  "history.tabNoHistory": "No History",

  // The app's fixed default device names (stored as is; only shown translated)
  "history.deviceBpMonitor": "BP Monitor",
  "history.deviceBloodPressureMonitor": "Blood Pressure Monitor",
  "history.deviceScale": "Scale",
  "history.deviceSmartScale": "Smart Scale",
  "history.deviceGlucoseMeter": "Glucose Meter",

  // Sync
  "history.syncCompleteTitle": "Sync Complete",
  "history.syncCompleteOne": "{count} item synced to EMR.",
  "history.syncCompleteOther": "{count} items synced to EMR.",
  "history.syncIncompleteTitle": "Sync Incomplete",
  "history.syncIncompleteOne": "{count} item still pending. Will retry automatically.",
  "history.syncIncompleteOther": "{count} items still pending. Will retry automatically.",
  "history.syncErrorTitle": "Sync Error",
  "history.syncErrorMessage": "Unable to sync readings. Please try again.",
  "history.itemsPendingOne": "{count} item pending",
  "history.itemsPendingOther": "{count} items pending",
  "history.offline": "Offline",
  "history.syncing": "Syncing...",
  "history.syncNow": "Sync Now",
  "history.pendingCount": "{count} pending",

  // Export
  "history.noDataTitle": "No data",
  "history.noDataMessage": "There is no history to export.",
  "history.exportFailedTitle": "Export failed",
  "history.exportFailedMessage": "Unable to export readings.",

  // Empty states
  "history.emptyTitle": "No Readings Yet",
  "history.emptySubtitle": "Take a measurement or answer a health check to see history here",
  "history.noReadingsForDevice": "No readings for this device",
  "history.noAnswersYet": "No answers yet",

  // Reading summary and list
  "history.statHigh": "High",
  "history.statAvg": "Avg",
  "history.statLow": "Low",
  "history.statAvgHr": "Avg HR",
  "history.statElevated": "Elevated",
  "history.badgeHigh": "HIGH",
  "history.systolic": "Systolic",
  "history.diastolic": "Diastolic",
  "history.dateAtTime": "{date} at {time}",
  "history.readingsOne": "{count} reading",
  "history.readingsOther": "{count} readings",
  "history.oldestFirst": "Oldest first",
  "history.newestFirst": "Newest first",

  // Screening summary and list (daily health check, urine protein)
  "history.statTotal": "Total",
  "history.statSymptoms": "Symptoms",
  "history.statClear": "Clear",
  "history.statResults": "Results",
  "history.statHighest24h": "Highest 24h",
  "history.statAlerts": "Alerts",
  "history.symptomsReported": "Symptoms Reported",
  "history.noSymptoms": "No Symptoms",
  "history.urineProteinValue": "Urine Protein: {result}",
  "history.badgeYes": "YES",
  "history.badgeAlert": "ALERT",
  "history.headacheAnswer": "Headache: {answer}",
  "history.visionAnswer": "Vision: {answer}",
  "history.notAnswered": "Not answered",
  "history.checksOne": "{count} check",
  "history.checksOther": "{count} checks",
  "history.recordsOne": "{count} record",
  "history.recordsOther": "{count} records",

  // Glucose sample windows (labels for the stored values; see below)
  "history.timingOvernight": "overnight",
  "history.timingBeforeBreakfast": "before breakfast",
  "history.timingAfterBreakfast": "after breakfast",
  "history.timingBeforeLunch": "before lunch",
  "history.timingAfterLunch": "after lunch",
  "history.timingBeforeDinner": "before dinner",
  "history.timingAfterDinner": "after dinner",
  "history.timingBedtime": "bedtime",
} as const;

export default history;

type HistoryKey = keyof typeof history;

/**
 * Glucose sample window as stored on a reading (CaptureScreen's
 * GLUCOSE_TIMING_OPTIONS values, synced to the EMR as measurement_condition)
 * → its label key. Looked up lower-cased (the demo seed stores "Before
 * breakfast"); a value not listed here is shown as stored.
 */
export const GLUCOSE_TIMING_LABEL_KEYS: { readonly [stored: string]: HistoryKey | undefined } = {
  overnight: "history.timingOvernight",
  "before breakfast": "history.timingBeforeBreakfast",
  "after breakfast": "history.timingAfterBreakfast",
  "before lunch": "history.timingBeforeLunch",
  "after lunch": "history.timingAfterLunch",
  "before dinner": "history.timingBeforeDinner",
  "after dinner": "history.timingAfterDinner",
  bedtime: "history.timingBedtime",
};
