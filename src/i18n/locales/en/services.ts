export default {
  "services.accessRevoked": "Your CareView access has been turned off by your care team. Please contact them if you think this is a mistake.",
  "services.sessionExpired": "Your session expired. Please sign in again.",

  // Sign-in errors (authService) — shown in the sign-in / code screens.
  "services.authNotRegistered": "Phone number not registered. Please contact your provider.",
  "services.authAccessOff": "CareView access for this number has been turned off by your care team. Please contact your provider.",
  "services.authSmsFailed": "Failed to send SMS. Please try again.",
  "services.authTooManyCodes": "Too many code requests. Please wait a bit and try again.",
  "services.authSendFailed": "Failed to send code",
  "services.authNoConnection": "Unable to reach the server. Please check your internet connection and try again.",
  "services.authInvalidCode": "Invalid or expired code. Please try again.",
  "services.authPatientNotFound": "Patient record not found.",
  "services.authVerifyFailed": "Verification failed",
  "services.authStorageError": "Unable to complete sign-in due to a local storage error. Please try again, and contact support if the problem persists.",
  "services.demoTitle": "Demo Account Detected",
  "services.demoMessage": "Would you like to seed the app with sample data?",

  // Sync status (vitalsSyncService) — the line under "Sync error" in the sync badge.
  "services.syncPaused": "Sync paused after repeated failures. Tap to retry.",
  "services.syncItemsFailed": "{count} items failed to sync",
  "services.requestTimedOut": "Request timed out",

  // Dexcom (cgmSyncService / cgmHealthSource) — "Last try didn't finish: …" on the Devices card.
  "services.cgmAccessOff": "{source} access was turned off",
  "services.cgmServerError": "EMR returned {status}",
  "services.cgmHealthConnectUnavailable": "Health Connect is not available",

  // Device registration (deviceRegistrationService) — "Device Not Available" alert.
  "services.deviceUnavailable": "Device is not available for pairing.",

  // Bluetooth status (deviceService). The native module reports these English
  // sentences; each key's English is the native text, matched exactly.
  "services.btUnsupported": "This device does not support Bluetooth scanning.",
  "services.btUnauthorizedAndroid": "Bluetooth permission is off for CareView. Allow Bluetooth permissions in Settings, then try again.",
  "services.btUnauthorizedIos": "Bluetooth permission is off for CareView. Allow Bluetooth in Settings, then try again.",
  "services.btPoweredOff": "Bluetooth is off. Turn on Bluetooth, then try again.",
  "services.btLocationDisabled": "Location Services must be on for Bluetooth scanning on this Android device.",
  "services.btReady": "Bluetooth is ready.",
  "services.btResetting": "Bluetooth is resetting. Try again in a moment.",
  "services.btGettingReady": "Bluetooth is getting ready. Try again in a moment.",
  "services.btNotReady": "Bluetooth is not ready.",
  "services.btStatusUnavailable": "Bluetooth status is unavailable.",

  // Device type labels shown on screen (deviceService.getFriendlyTypeLabel).
  "services.typeBG5S": "iHealth BG5S Glucose Meter",
  "services.typeGattBP": "BLE Blood Pressure Monitor",
  "services.typeGattScale": "BLE Smart Scale",
} as const;
