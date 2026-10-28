// Sign-in screens (AuthScreen, CodeVerifyScreen). The server-mapped error
// messages are thrown already translated by authService (services.auth*);
// the keys here are the screens' own text and fallbacks.
export default {
  "auth.subtitle": "Enter your mobile number to sign in.",
  "auth.phonePlaceholder": "Mobile number",
  "auth.pleaseWait": "Please Wait...",
  "auth.requestCode": "Request Code",
  "auth.codeNote": "We’ll send a 6-digit code to verify you.",
  "auth.phoneRequiredTitle": "Phone required",
  "auth.phoneRequiredBody": "Please enter your mobile number.",
  "auth.sendFailed": "Could not send verification code.",
  "auth.sendFailedRetry": "Failed to send code. Please try again.",

  "auth.verifyTitle": "Enter Verification Code",
  // Followed by the phone number in bold.
  "auth.sentCodeTo": "We sent a 6-digit code to",
  "auth.verifying": "Verifying...",
  "auth.verify": "Verify",
  "auth.changeNumber": "Change number",
  "auth.resendCode": "Resend code",
  "auth.codeExpiry": "Codes expire after 10 minutes.",
  "auth.invalidCodeTitle": "Invalid code",
  "auth.enterAllDigits": "Please enter all 6 digits.",
  "auth.verifyFailedTitle": "Verification failed",
  "auth.invalidOrExpired": "Invalid or expired code.",
  "auth.codeIncorrect": "The code is incorrect or has expired.",
  "auth.codeResent": "A new verification code has been sent.",
  "auth.resendFailed": "Unable to resend verification code.",
} as const;
