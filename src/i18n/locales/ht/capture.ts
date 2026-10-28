import type en from "../en/capture";

const ht: Record<keyof typeof en, string> = {
  "capture.captureReading": "Pran mezi",

  // Bluetooth
  "capture.bluetoothNeededTitle": "Ou bezwen Bluetooth",
  "capture.bluetoothNeededMsg":
    "CareView bezwen Bluetooth pou ajoute aparèy epi pran mezi. Limen Bluetooth la oswa bay pèmisyon Bluetooth, epi eseye ankò.",
  "capture.bluetoothNeededMsgBle":
    "CareView bezwen Bluetooth pou pran mezi. Limen Bluetooth la oswa bay pèmisyon Bluetooth, epi eseye ankò.",

  // Ki lè yo pran tès glikoz la (etikèt sèlman)
  "capture.timingOvernight": "Pandan lannwit",
  "capture.timingBeforeBreakfast": "Anvan manje maten",
  "capture.timingAfterBreakfast": "Apre manje maten",
  "capture.timingBeforeLunch": "Anvan manje midi",
  "capture.timingAfterLunch": "Apre manje midi",
  "capture.timingBeforeDinner": "Anvan manje aswè",
  "capture.timingAfterDinner": "Apre manje aswè",
  "capture.timingBedtime": "Lè w pral dòmi",
  "capture.todayAt": "Jodi a {time}",
  "capture.yesterdayAt": "Yè {time}",

  // Enpòte nan glikomèt la
  "capture.meterClockUnknownTitle": "Mezi yo pa gen dat",
  "capture.meterClockUnknownMsg":
    "Kèk mezi nan glikomèt la te pran anvan yo te regle revèy li, epi aplikasyon an pa gen okenn enfòmasyon sou revèy sa a. Nou kite yo nan glikomèt la. Pran yon lòt mezi epi enpòte ankò.",
  "capture.noNewReadingsTitle": "Pa gen nouvo mezi",
  "capture.noNewReadingsMsg":
    "Tout mezi ki nan glikomèt ou a deja anrejistre. Pran yon lòt mezi ak glikomèt la, epi enpòte ankò.",
  "capture.noGlucoseReadingTitle": "Pa gen mezi glikoz",
  "capture.noGlucoseReadingMsg":
    "Glikomèt la konekte, men nou pa jwenn okenn mezi glikoz ladan l. Pran yon mezi ak glikomèt la, epi eseye ankò.",
  "capture.checkingStoredReadings": "N ap tcheke mezi ki nan aparèy la...",
  "capture.finishingImport": "N ap fini enpòte...",
  "capture.readingsImported": "{count} mezi enpòte soti nan glikomèt ou a.",
  "capture.selectSampleWindow": "Chwazi ki lè ou te fè tès la",
  "capture.saveGlucoseFailed": "Nou pa t ka anrejistre mezi glikoz ou a. Tanpri eseye ankò.",
  "capture.glucoseReadErrorTitle": "Erè pou li glikoz la",
  "capture.glucoseReadErrorMsg":
    "Glikomèt la konekte, men aplikasyon an pa t ka li mezi glikoz ki ladan l. Kenbe glikomèt la toupre epi eseye ankò.",
  "capture.glucoseWhenNofM": "Mezi {n} sou {total}: ki lè ou te pran l?",
  "capture.glucoseWhenOne": "Ki lè ou te pran mezi sa a?",
  "capture.skipThisOne": "Sote sa a",
  "capture.stop": "Kanpe",

  // Pandan n ap pran mezi a
  "capture.initializing": "N ap prepare...",
  "capture.findScale": "N ap chèche balans ou...",
  "capture.findGlucoseMeter": "N ap chèche glikomèt ou...",
  "capture.findBPMonitor": "N ap chèche aparèy tansyon ou...",
  "capture.findMonitor": "N ap chèche aparèy ou...",
  "capture.statusDeviceFound": "Nou jwenn aparèy la. N ap konekte...",
  "capture.connecting": "N ap konekte...",
  "capture.stepOnScale": "Monte sou balans lan epi rete san bouje",
  "capture.standStill": "Rete san bouje...",
  "capture.bpMeasurementStarted": "Mezi a kòmanse. Kite bra ou rilaks",
  "capture.keepArmRelaxed": "Kite bra ou rilaks...",
  "capture.readingSaved": "Mezi a anrejistre!",
  "capture.readyToMeasure": "Pare pou pran mezi",
  "capture.syncing": "N ap voye l bay ekip swen ou...",
  "capture.synced": "✓ Voye bay ekip swen ou",
  "capture.pending": "L ap pati lè gen entènèt",

  // Rezilta
  "capture.aboveThresholdBP": "Pi wo pase limit la ({systolic}/{diastolic})",
  "capture.aboveThresholdGlucose": "Pi wo pase limit la ({high})",
  "capture.typeBPMonitor": "Aparèy tansyon",
  "capture.typeSmartScale": "Balans entelijan",
  "capture.typeGlucoseMeter": "Glikomèt",

  // Pwoblèm
  "capture.disconnectedTitle": "Aparèy la dekonekte",
  "capture.disconnectedMsg":
    "Koneksyon an koupe anvan nou resevwa yon mezi. Asire w aparèy ou a toupre, epi eseye ankò.",
  "capture.saveFailed": "Nou pa t ka anrejistre mezi ou a. Tanpri eseye ankò.",
  "capture.deviceErrorTitle": "Erè aparèy",
  "capture.deviceErrorMsg": "Gen yon pwoblèm ki rive pandan mezi a. Tanpri eseye ankò.",
  "capture.deviceNotFound": "Nou pa jwenn aparèy la",
  "capture.nativeModuleMissing": "Modil aparèy yo pa disponib",
  "capture.scanErrorTitle": "Erè nan rechèch la",
  "capture.timeoutTitle": "Tan an fini",
  "capture.timeoutMsg":
    "Nou pa resevwa okenn mezi. Kenbe aparèy la toupre, asire w li gen batri, epi eseye ankò.",
  "capture.goBack": "Retounen",

  // Batri
  "capture.deviceFallback": "aparèy",
  "capture.batteryLowToast":
    "Batri a ba ({level}%). Chaje {device} ou a byento pou w ka jwenn bon mezi.",
  "capture.chargeTitle": "Chaje aparèy ou",
  "capture.chargeMsg":
    "Batri {device} ou a ba ({level}%). Chaje l byento pou w ka jwenn bon mezi. Ou ka eseye kounye a kanmèm.",
  "capture.tryAnyway": "Eseye kanmèm",

  // Tchèk sante chak jou (anvan yon mezi tansyon)
  "capture.healthCheckSaved": "Tchèk sante chak jou a anrejistre",

  // Aparèy tansyon Bluetooth jeneral (A&D)
  "capture.waitingForMonitor": "N ap tann aparèy ou…",
  "capture.searchingForMonitor": "N ap chèche aparèy ou…",
  "capture.monitorFound": "Nou jwenn aparèy la. N ap resevwa mezi ou…",
  "capture.takeReadingNow": "Pran mezi ou kounye a",
  "capture.gettingReading": "N ap resevwa mezi ou...",
  "capture.bleWaitingHint":
    "Peze START sou aparèy ou a epi pran tansyon ou jan ou konn fè l. Mezi a ap rive poukont li.",
  "capture.bleIdleHint":
    "Tape bouton anba a, epi pran tansyon ou. Ou pa bezwen touche telefòn ou ankò.",
  "capture.noReadingReceivedTitle": "Nou pa resevwa mezi",
  "capture.noReadingReceivedMsg":
    "CareView pa t resevwa anyen nan aparèy ou. Mezi ou a toujou anrejistre nan aparèy la. Kòmanse pran mezi ankò, l ap rive.",
  "capture.undatedTitle": "Mezi san dat",
  "capture.undatedMsg":
    "Aparèy la voye {systolic}/{diastolic}, men li pa gen dat (revèy aparèy la pa t regle lè w te pran l).\n\nÈske ou te pran mezi sa a kounye a la a?",
  "capture.undatedMsgPulse":
    "Aparèy la voye {systolic}/{diastolic}, batman kè {pulse}, men li pa gen dat (revèy aparèy la pa t regle lè w te pran l).\n\nÈske ou te pran mezi sa a kounye a la a?",
  "capture.undatedNo": "Non, sote l",
  "capture.undatedYes": "Wi, kounye a",
};

export default ht;
