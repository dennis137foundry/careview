import type en from "../en/urine";

const es: Record<keyof typeof en, string> = {
  // Picker
  "urine.title": "Prueba de proteína en la orina",
  "urine.subtitleHold": "Han pasado más de {hours} horas desde su último resultado. Por favor, registre uno para continuar.",
  "urine.subtitle": "Por favor, registre el resultado de su prueba de proteína en la orina más reciente.",
  "urine.info": "Esto ayuda a su equipo de atención médica a vigilar señales de preeclampsia. Las tiras reactivas vienen en su kit.",
  "urine.selected": "Su selección:",
  "urine.saveResult": "Guardar resultado",
  "urine.cantTestNow": "No puedo hacer la prueba ahora",
  "urine.reminderNote": "Puede registrar un resultado cuando quiera. Si pasan {hours} horas sin un resultado, le pediremos que lo ingrese antes de continuar.",
  "urine.unableInfo": "Dígale a su equipo de atención médica por qué. Lo verán en su expediente y mañana le volveremos a preguntar.",
  "urine.sendToCareTeam": "Enviar a su equipo médico",
  "urine.backToResults": "Volver a los resultados",
  "urine.couldntSaveTitle": "No se pudo guardar",
  "urine.resultNotSaved": "Su resultado no se guardó. Por favor, inténtelo de nuevo.",
  "urine.reportNotSaved": "Su reporte no se guardó. Por favor, inténtelo de nuevo.",
  "urine.recordAnotherTitle": "¿Registrar otro resultado?",
  "urine.recordAnotherBody": "Usted registró {result} {when}. ¿Guardar este también?",
  "urine.aResult": "un resultado",

  // Result labels
  "urine.resultNegative": "Negativo",
  "urine.resultTrace": "Trazas",

  // "I can't test right now" reasons
  "urine.reasonOutOfStrips": "Se me acabaron las tiras reactivas",
  "urine.reasonNoKit": "No tengo mi kit conmigo",
  "urine.reasonOther": "Otra razón",
  "urine.couldntTest": "No se pudo hacer la prueba",

  // describeRelative
  "urine.justNow": "hace un momento",
  "urine.minAgo": "hace {n} min",
  "urine.hoursAgoOne": "hace {n} hora",
  "urine.hoursAgoOther": "hace {n} horas",
  "urine.yesterday": "ayer",
  "urine.daysAgo": "hace {n} días",

  // Reminder notifications
  "urine.reminderTitle": "Es hora de su registro en CareView",
  "urine.reminderBody": "Registre su resultado de proteína en la orina en la aplicación.",
  "urine.reminderChannel": "Recordatorios",
};

export default es;
