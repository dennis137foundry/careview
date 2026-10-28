// Capture screens (iHealth CaptureScreen + generic-BLE BleCaptureScreen).
export default {
  "capture.captureReading": "Capture Reading",

  // Bluetooth
  "capture.bluetoothNeededTitle": "Bluetooth Needed",
  "capture.bluetoothNeededMsg":
    "CareView needs Bluetooth to add devices and capture readings. Turn Bluetooth on or allow Bluetooth permission, then try again.",
  "capture.bluetoothNeededMsgBle":
    "CareView needs Bluetooth to capture readings. Turn Bluetooth on or allow Bluetooth permission, then try again.",

  // Glucose sample windows (labels only; the saved value stays English)
  "capture.timingOvernight": "Overnight",
  "capture.timingBeforeBreakfast": "Before breakfast",
  "capture.timingAfterBreakfast": "After breakfast",
  "capture.timingBeforeLunch": "Before lunch",
  "capture.timingAfterLunch": "After lunch",
  "capture.timingBeforeDinner": "Before dinner",
  "capture.timingAfterDinner": "After dinner",
  "capture.timingBedtime": "Bedtime",
  "capture.todayAt": "Today {time}",
  "capture.yesterdayAt": "Yesterday {time}",

  // Glucose import
  "capture.meterClockUnknownTitle": "Readings Could Not Be Dated",
  "capture.meterClockUnknownMsg":
    "Some readings on the meter were taken before its clock was set, and this app has no record of that clock. They were left on the meter. Take a new reading and import again.",
  "capture.noNewReadingsTitle": "No New Readings",
  "capture.noNewReadingsMsg":
    "Every reading stored on your meter has already been captured. Take a new reading on the meter, then capture again.",
  "capture.noGlucoseReadingTitle": "No Glucose Reading",
  "capture.noGlucoseReadingMsg":
    "The meter connected, but no stored glucose reading was found. Take a reading on the meter, then try capture again.",
  "capture.checkingStoredReadings": "Checking stored readings...",
  "capture.finishingImport": "Finishing import...",
  "capture.readingsImported": "{count} readings imported from your meter.",
  "capture.selectSampleWindow": "Select sample window",
  "capture.saveGlucoseFailed": "Couldn't save your glucose reading. Please try again.",
  "capture.glucoseReadErrorTitle": "Glucose Read Error",
  "capture.glucoseReadErrorMsg":
    "The meter connected, but the app could not read its stored glucose data. Keep the meter nearby and try again.",
  "capture.glucoseWhenNofM": "Reading {n} of {total} — when was it taken?",
  "capture.glucoseWhenOne": "When was this reading taken?",
  "capture.skipThisOne": "Skip this one",
  "capture.stop": "Stop",

  // Status while capturing
  "capture.initializing": "Initializing...",
  "capture.findScale": "Finding your scale...",
  "capture.findGlucoseMeter": "Finding your glucose meter...",
  "capture.findBPMonitor": "Finding your blood pressure monitor...",
  "capture.findMonitor": "Finding your monitor...",
  "capture.statusDeviceFound": "Device found. Connecting...",
  "capture.connecting": "Connecting...",
  "capture.stepOnScale": "Step on the scale and stand still",
  "capture.standStill": "Stand still...",
  "capture.bpMeasurementStarted": "Measurement started. Keep your arm relaxed",
  "capture.keepArmRelaxed": "Keep your arm relaxed...",
  "capture.readingSaved": "Reading saved!",
  "capture.readyToMeasure": "Ready to measure",
  "capture.syncing": "Syncing to care team...",
  "capture.synced": "✓ Sent to care team",
  "capture.pending": "Will send when online",

  // Result
  "capture.aboveThresholdBP": "Above threshold ({systolic}/{diastolic})",
  "capture.aboveThresholdGlucose": "Above threshold ({high})",
  "capture.typeBPMonitor": "Blood Pressure Monitor",
  "capture.typeSmartScale": "Smart Scale",
  "capture.typeGlucoseMeter": "Glucose Meter",

  // Problems
  "capture.disconnectedTitle": "Device Disconnected",
  "capture.disconnectedMsg":
    "The connection was lost before a reading was received. Make sure your device is nearby and try again.",
  "capture.saveFailed": "Couldn't save your reading. Please try again.",
  "capture.deviceErrorTitle": "Device Error",
  "capture.deviceErrorMsg": "Something went wrong during the reading. Please try again.",
  "capture.deviceNotFound": "Device not found",
  "capture.nativeModuleMissing": "Native module not available",
  "capture.scanErrorTitle": "Scan Error",
  "capture.timeoutTitle": "Timeout",
  "capture.timeoutMsg":
    "No reading was received. Keep the device nearby, make sure it has battery, and try again.",
  "capture.goBack": "Go Back",

  // Battery
  "capture.deviceFallback": "device",
  "capture.batteryLowToast":
    "Battery is low ({level}%). Charge your {device} soon for reliable readings.",
  "capture.chargeTitle": "Charge Your Device",
  "capture.chargeMsg":
    "Your {device} battery is low ({level}%). Charge it soon for reliable readings. You can still try now.",
  "capture.tryAnyway": "Try Anyway",

  // Daily health check (asked before a blood pressure reading)
  "capture.healthCheckSaved": "Daily health check saved",

  // Generic Bluetooth blood pressure monitor (A&D)
  "capture.waitingForMonitor": "Waiting for your monitor…",
  "capture.searchingForMonitor": "Searching for your monitor…",
  "capture.monitorFound": "Monitor found. Collecting your reading…",
  "capture.takeReadingNow": "Take your reading now",
  "capture.gettingReading": "Getting your reading...",
  "capture.bleWaitingHint":
    "Press START on your monitor and take your blood pressure as normal. The reading arrives on its own.",
  "capture.bleIdleHint":
    "Tap below, then take your blood pressure. You do not need to touch your phone again.",
  "capture.noReadingReceivedTitle": "No Reading Received",
  "capture.noReadingReceivedMsg":
    "CareView didn't hear from your monitor. Your reading is still saved on the device — start capture again and it will be picked up.",
  "capture.undatedTitle": "Reading without a date",
  "capture.undatedMsg":
    "The monitor sent {systolic}/{diastolic}, but it has no date (the monitor's clock was not set when it was taken).\n\nDid you take this reading just now?",
  "capture.undatedMsgPulse":
    "The monitor sent {systolic}/{diastolic}, pulse {pulse}, but it has no date (the monitor's clock was not set when it was taken).\n\nDid you take this reading just now?",
  "capture.undatedNo": "No, skip it",
  "capture.undatedYes": "Yes, just now",
} as const;
