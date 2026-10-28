import type en from "../en/services";

const ht: Record<keyof typeof en, string> = {
  "services.accessRevoked": "Ekip swen ou a fèmen aksè ou nan CareView. Tanpri kontakte yo si ou panse se yon erè.",
  "services.sessionExpired": "Sesyon ou an fini. Tanpri konekte ankò.",

  "services.authNotRegistered": "Nimewo telefòn sa a pa anrejistre. Tanpri kontakte doktè ou.",
  "services.authAccessOff": "Ekip swen ou a fèmen aksè CareView pou nimewo sa a. Tanpri kontakte doktè ou.",
  "services.authSmsFailed": "Nou pa t ka voye mesaj tèks la. Tanpri eseye ankò.",
  "services.authTooManyCodes": "Ou mande twòp kòd. Tanpri tann yon ti moman epi eseye ankò.",
  "services.authSendFailed": "Nou pa t ka voye kòd la",
  "services.authNoConnection": "Nou pa ka jwenn sèvè a. Tanpri tcheke koneksyon entènèt ou epi eseye ankò.",
  "services.authInvalidCode": "Kòd la pa bon oswa li ekspire. Tanpri eseye ankò.",
  "services.authPatientNotFound": "Nou pa jwenn dosye pasyan ou.",
  "services.authVerifyFailed": "Verifikasyon an pa mache",
  "services.authStorageError": "Nou pa t ka fin konekte ou akoz yon erè nan memwa telefòn nan. Tanpri eseye ankò, epi kontakte sèvis sipò si pwoblèm nan kontinye.",
  "services.demoTitle": "Kont demonstrasyon",
  "services.demoMessage": "Èske ou vle mete done egzanp nan aplikasyon an?",

  "services.syncPaused": "Senkronizasyon an kanpe apre plizyè echèk. Peze pou eseye ankò.",
  "services.syncItemsFailed": "{count} bagay pa t ka senkronize",
  "services.requestTimedOut": "Demann lan pran twòp tan",

  "services.cgmAccessOff": "Aksè nan {source} fèmen",
  "services.cgmServerError": "Sèvè a reponn ak yon erè ({status})",
  "services.cgmHealthConnectUnavailable": "Health Connect pa disponib",

  "services.deviceUnavailable": "Aparèy sa a pa disponib pou konekte.",

  "services.btUnsupported": "Telefòn sa a pa ka chèche aparèy Bluetooth.",
  "services.btUnauthorizedAndroid": "CareView pa gen pèmisyon pou itilize Bluetooth. Bay pèmisyon Bluetooth nan Paramèt, epi eseye ankò.",
  "services.btUnauthorizedIos": "CareView pa gen pèmisyon pou itilize Bluetooth. Pèmèt Bluetooth nan Paramèt, epi eseye ankò.",
  "services.btPoweredOff": "Bluetooth fèmen. Limen Bluetooth, epi eseye ankò.",
  "services.btLocationDisabled": "Sou telefòn Android sa a, fòk lokalizasyon an limen pou chèche aparèy Bluetooth.",
  "services.btReady": "Bluetooth pare.",
  "services.btResetting": "Bluetooth ap rekòmanse. Eseye ankò nan yon ti moman.",
  "services.btGettingReady": "Bluetooth ap prepare. Eseye ankò nan yon ti moman.",
  "services.btNotReady": "Bluetooth poko pare.",
  "services.btStatusUnavailable": "Nou pa ka konnen eta Bluetooth la.",

  "services.typeBG5S": "Glikomèt iHealth BG5S",
  "services.typeGattBP": "Aparèy tansyon BLE",
  "services.typeGattScale": "Balans entelijan BLE",
};

export default ht;
