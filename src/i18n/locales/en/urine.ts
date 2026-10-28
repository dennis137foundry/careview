// Urine protein: the picker (UrineProteinModal), the labels and relative times
// from urineProteinLogic.ts, and the reminder notifications.
// The result VALUES ("Negative", "Trace", "+1".."+4") and the reason CODES are
// saved and synced; only these display labels are translated.
export default {
  // Picker
  "urine.title": "Urine Protein Check",
  "urine.subtitleHold": "It's been more than {hours} hours since your last result. Please record one to continue.",
  "urine.subtitle": "Please record your most recent urine protein test result.",
  "urine.info": "This helps your care team monitor for signs of preeclampsia. Test strips are included in your kit.",
  "urine.selected": "Selected:",
  "urine.saveResult": "Save Result",
  "urine.cantTestNow": "I can't test right now",
  "urine.reminderNote": "You can record a result any time. If {hours} hours pass without one, we'll ask you to enter it before continuing.",
  "urine.unableInfo": "Let your care team know why. They'll see this on your chart, and we'll check back with you tomorrow.",
  "urine.sendToCareTeam": "Send to care team",
  "urine.backToResults": "Back to results",
  "urine.couldntSaveTitle": "Couldn't save",
  "urine.resultNotSaved": "Your result was not saved. Please try again.",
  "urine.reportNotSaved": "Your report was not saved. Please try again.",
  "urine.recordAnotherTitle": "Record another result?",
  "urine.recordAnotherBody": "You recorded {result} {when}. Save this one too?",
  "urine.aResult": "a result",

  // Result labels (the stored value stays "Negative" / "Trace"; +1..+4 are shown as is)
  "urine.resultNegative": "Negative",
  "urine.resultTrace": "Trace",

  // "I can't test right now" reasons (stored as codes: out_of_strips, no_kit, other)
  "urine.reasonOutOfStrips": "I'm out of test strips",
  "urine.reasonNoKit": "I don't have my kit with me",
  "urine.reasonOther": "Another reason",
  "urine.couldntTest": "Couldn't test",

  // describeRelative (used mid-sentence, hence lower case)
  "urine.justNow": "just now",
  "urine.minAgo": "{n} min ago",
  "urine.hoursAgoOne": "{n} hour ago",
  "urine.hoursAgoOther": "{n} hours ago",
  "urine.yesterday": "yesterday",
  "urine.daysAgo": "{n} days ago",

  // Reminder notifications (lock screen: deliberately generic)
  "urine.reminderTitle": "Time for your CareView check-in",
  "urine.reminderBody": "Record your urine protein result in the app.",
  "urine.reminderChannel": "Reminders",
} as const;
