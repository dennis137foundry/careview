import type en from "../en/capture";

const es: Record<keyof typeof en, string> = {
  "capture.captureReading": "Tomar lectura",

  // Bluetooth
  "capture.bluetoothNeededTitle": "Se necesita Bluetooth",
  "capture.bluetoothNeededMsg":
    "CareView necesita Bluetooth para agregar dispositivos y tomar lecturas. Active el Bluetooth o permita el acceso a Bluetooth y vuelva a intentarlo.",
  "capture.bluetoothNeededMsgBle":
    "CareView necesita Bluetooth para tomar lecturas. Active el Bluetooth o permita el acceso a Bluetooth y vuelva a intentarlo.",

  // Momentos de la prueba de glucosa (solo etiquetas)
  "capture.timingOvernight": "Durante la noche",
  "capture.timingBeforeBreakfast": "Antes del desayuno",
  "capture.timingAfterBreakfast": "Después del desayuno",
  "capture.timingBeforeLunch": "Antes del almuerzo",
  "capture.timingAfterLunch": "Después del almuerzo",
  "capture.timingBeforeDinner": "Antes de la cena",
  "capture.timingAfterDinner": "Después de la cena",
  "capture.timingBedtime": "Al acostarse",
  "capture.todayAt": "Hoy {time}",
  "capture.yesterdayAt": "Ayer {time}",

  // Importación del glucómetro
  "capture.meterClockUnknownTitle": "Lecturas sin fecha",
  "capture.meterClockUnknownMsg":
    "Algunas lecturas del glucómetro se tomaron antes de que se ajustara su reloj, y esta aplicación no tiene registro de ese reloj. Se dejaron en el glucómetro. Tome una nueva lectura y vuelva a importar.",
  "capture.noNewReadingsTitle": "No hay lecturas nuevas",
  "capture.noNewReadingsMsg":
    "Todas las lecturas guardadas en su glucómetro ya se registraron. Tome una nueva lectura con el glucómetro y luego vuelva a importar.",
  "capture.noGlucoseReadingTitle": "No hay lectura de glucosa",
  "capture.noGlucoseReadingMsg":
    "El glucómetro se conectó, pero no se encontró ninguna lectura de glucosa guardada. Tome una lectura con el glucómetro y vuelva a intentarlo.",
  "capture.checkingStoredReadings": "Revisando las lecturas guardadas...",
  "capture.finishingImport": "Terminando la importación...",
  "capture.readingsImported": "Se importaron {count} lecturas de su glucómetro.",
  "capture.selectSampleWindow": "Elija el momento de la prueba",
  "capture.saveGlucoseFailed": "No se pudo guardar su lectura de glucosa. Vuelva a intentarlo.",
  "capture.glucoseReadErrorTitle": "Error al leer la glucosa",
  "capture.glucoseReadErrorMsg":
    "El glucómetro se conectó, pero la aplicación no pudo leer los datos de glucosa guardados. Mantenga el glucómetro cerca y vuelva a intentarlo.",
  "capture.glucoseWhenNofM": "Lectura {n} de {total}: ¿cuándo se tomó?",
  "capture.glucoseWhenOne": "¿Cuándo se tomó esta lectura?",
  "capture.skipThisOne": "Omitir esta",
  "capture.stop": "Detener",

  // Estado durante la lectura
  "capture.initializing": "Iniciando...",
  "capture.findScale": "Buscando su báscula...",
  "capture.findGlucoseMeter": "Buscando su glucómetro...",
  "capture.findBPMonitor": "Buscando su monitor de presión arterial...",
  "capture.findMonitor": "Buscando su monitor...",
  "capture.statusDeviceFound": "Dispositivo encontrado. Conectando...",
  "capture.connecting": "Conectando...",
  "capture.stepOnScale": "Súbase a la báscula y quédese quieta",
  "capture.standStill": "Quédese quieta...",
  "capture.bpMeasurementStarted": "Medición iniciada. Mantenga el brazo relajado",
  "capture.keepArmRelaxed": "Mantenga el brazo relajado...",
  "capture.readingSaved": "¡Lectura guardada!",
  "capture.readyToMeasure": "Todo listo para medir",
  "capture.syncing": "Enviando a su equipo de atención médica...",
  "capture.synced": "✓ Enviado a su equipo de atención médica",
  "capture.pending": "Se enviará cuando haya conexión",

  // Resultado
  "capture.aboveThresholdBP": "Por encima del límite ({systolic}/{diastolic})",
  "capture.aboveThresholdGlucose": "Por encima del límite ({high})",
  "capture.typeBPMonitor": "Monitor de presión arterial",
  "capture.typeSmartScale": "Báscula inteligente",
  "capture.typeGlucoseMeter": "Glucómetro",

  // Problemas
  "capture.disconnectedTitle": "Dispositivo desconectado",
  "capture.disconnectedMsg":
    "Se perdió la conexión antes de recibir una lectura. Asegúrese de que su dispositivo esté cerca y vuelva a intentarlo.",
  "capture.saveFailed": "No se pudo guardar su lectura. Vuelva a intentarlo.",
  "capture.deviceErrorTitle": "Error del dispositivo",
  "capture.deviceErrorMsg": "Algo salió mal durante la lectura. Vuelva a intentarlo.",
  "capture.deviceNotFound": "No se encontró el dispositivo",
  "capture.nativeModuleMissing": "El módulo de dispositivos no está disponible",
  "capture.scanErrorTitle": "Error de búsqueda",
  "capture.timeoutTitle": "Tiempo agotado",
  "capture.timeoutMsg":
    "No se recibió ninguna lectura. Mantenga el dispositivo cerca, asegúrese de que tenga batería y vuelva a intentarlo.",
  "capture.goBack": "Volver",

  // Batería
  "capture.deviceFallback": "dispositivo",
  "capture.batteryLowToast":
    "Batería baja ({level}%). Cargue su {device} pronto para obtener lecturas confiables.",
  "capture.chargeTitle": "Cargue su dispositivo",
  "capture.chargeMsg":
    "La batería de su {device} está baja ({level}%). Cárguela pronto para obtener lecturas confiables. Puede intentarlo ahora de todos modos.",
  "capture.tryAnyway": "Intentar igual",

  // Control de salud diario (antes de una lectura de presión arterial)
  "capture.healthCheckSaved": "Revisión diaria de salud guardada",

  // Monitor de presión arterial Bluetooth genérico (A&D)
  "capture.waitingForMonitor": "Esperando su monitor…",
  "capture.searchingForMonitor": "Buscando su monitor…",
  "capture.monitorFound": "Monitor encontrado. Recibiendo su lectura…",
  "capture.takeReadingNow": "Tome su lectura ahora",
  "capture.gettingReading": "Recibiendo su lectura...",
  "capture.bleWaitingHint":
    "Presione START en su monitor y tómese la presión arterial como siempre. La lectura llegará sola.",
  "capture.bleIdleHint":
    "Toque el botón de abajo y luego tómese la presión arterial. No necesita volver a tocar el teléfono.",
  "capture.noReadingReceivedTitle": "No se recibió ninguna lectura",
  "capture.noReadingReceivedMsg":
    "CareView no recibió nada de su monitor. Su lectura sigue guardada en el dispositivo: vuelva a tomar lectura y se recibirá.",
  "capture.undatedTitle": "Lectura sin fecha",
  "capture.undatedMsg":
    "El monitor envió {systolic}/{diastolic}, pero no tiene fecha (el reloj del monitor no estaba configurado cuando se tomó).\n\n¿Tomó esta lectura hace un momento?",
  "capture.undatedMsgPulse":
    "El monitor envió {systolic}/{diastolic}, pulso {pulse}, pero no tiene fecha (el reloj del monitor no estaba configurado cuando se tomó).\n\n¿Tomó esta lectura hace un momento?",
  "capture.undatedNo": "No, omitirla",
  "capture.undatedYes": "Sí, ahora mismo",
};

export default es;
