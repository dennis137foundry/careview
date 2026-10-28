import type en from "../en/auth";

const ht: Record<keyof typeof en, string> = {
  "auth.subtitle": "Antre nimewo telefòn selilè ou pou w konekte.",
  "auth.phonePlaceholder": "Nimewo selilè",
  "auth.pleaseWait": "Tanpri tann...",
  "auth.requestCode": "Mande kòd",
  "auth.codeNote": "N ap voye yon kòd 6 chif ba ou pou nou verifye se ou.",
  "auth.phoneRequiredTitle": "Nou bezwen nimewo a",
  "auth.phoneRequiredBody": "Tanpri antre nimewo selilè ou.",
  "auth.sendFailed": "Nou pa t ka voye kòd verifikasyon an.",
  "auth.sendFailedRetry": "Nou pa t ka voye kòd la. Tanpri eseye ankò.",

  "auth.verifyTitle": "Antre kòd verifikasyon an",
  "auth.sentCodeTo": "Nou voye yon kòd 6 chif nan",
  "auth.verifying": "N ap verifye...",
  "auth.verify": "Verifye",
  "auth.changeNumber": "Chanje nimewo",
  "auth.resendCode": "Voye kòd la ankò",
  "auth.codeExpiry": "Kòd yo ekspire apre 10 minit.",
  "auth.invalidCodeTitle": "Kòd la pa bon",
  "auth.enterAllDigits": "Tanpri antre tout 6 chif yo.",
  "auth.verifyFailedTitle": "Verifikasyon an pa mache",
  "auth.invalidOrExpired": "Kòd la pa bon oswa li ekspire.",
  "auth.codeIncorrect": "Kòd la pa kòrèk oswa li ekspire.",
  "auth.codeResent": "Nou voye yon nouvo kòd verifikasyon ba ou.",
  "auth.resendFailed": "Nou pa t ka voye kòd verifikasyon an ankò.",
};

export default ht;
