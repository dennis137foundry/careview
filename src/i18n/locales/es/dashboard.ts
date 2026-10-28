import type en from "../en/dashboard";

const es: Record<keyof typeof en, string> = {
  "dashboard.goodMorning": "Buenos días",
  "dashboard.goodAfternoon": "Buenas tardes",
  "dashboard.goodEvening": "Buenas noches",
  "dashboard.nameFallback": "Bienvenida",
  "dashboard.bellDue": "Le toca el resultado de proteína en la orina",
  "dashboard.bellNotifications": "Notificaciones",
  "dashboard.allCaughtUp": "No tiene nada pendiente",

  "dashboard.remindersTitle": "Recordatorios",
  "dashboard.remindersMessage": "CareView puede avisarle cuando le toque el resultado de proteína en la orina. ¿Permitir notificaciones?",
  "dashboard.allow": "Permitir",

  "dashboard.wellnessTitle": "Bienestar materno diario",
  "dashboard.afterDelivery": "Después del parto",
  "dashboard.weekDay": "Semana {week} • Día {day}",
  "dashboard.earlierFacts": "Datos anteriores ›",
  "dashboard.dueDateSaved": "Fecha probable de parto guardada",
  "dashboard.wellnessBack": "Inicio",
  "dashboard.wellnessBackLabel": "Volver al inicio",
  "dashboard.wellnessNoEddTitle": "Aún no hay fecha probable de parto",
  "dashboard.wellnessNoEddText": "Agregue su fecha probable de parto en la pantalla de inicio y sus datos diarios irán de acuerdo con su embarazo.",
  "dashboard.wellnessLoadingEarlier": "Cargando días anteriores…",
  "dashboard.wellnessFirstDay": "Ese es el primer día de su embarazo.",

  "dashboard.urineProtein": "Proteína en la orina",
  "dashboard.urineResultNeeded": "Falta un resultado",
  "dashboard.urineNoResultYet": "Aún no hay resultados",
  "dashboard.urineOverdue": "Atrasado · último resultado {when}",
  "dashboard.urineLast": "Último: {result} · {when}",
  "dashboard.urineAlertChip": "ALERTA {result}",
  "dashboard.todayCount": "{count} HOY",
  "dashboard.recordResult": "Anotar resultado",
  "dashboard.urineSaved": "Resultado de proteína en la orina guardado",
  "dashboard.urineUnableSent": "Enviado a su equipo de atención médica. Le volveremos a preguntar mañana.",

  "dashboard.healthEvents": "Eventos de salud",
  "dashboard.healthEventsPrompt": "¿Recibió atención médica fuera de casa? Avísele de inmediato a su equipo de atención médica.",
  "dashboard.wentToHospital": "Fui al hospital",

  "dashboard.latestReadings": "Últimas lecturas",
  "dashboard.historyLink": "Historial",
  "dashboard.noRecentReadings": "No hay lecturas en las últimas 48 horas",
  "dashboard.bloodPressure": "Presión arterial",
  "dashboard.bloodGlucose": "Azúcar en la sangre",
  "dashboard.weight": "Peso",
  "dashboard.aboveRange": "Por encima del rango",
  "dashboard.inRange": "Dentro del rango",
  "dashboard.heartRate": "Pulso {hr}",
  "dashboard.recorded": "Registrado",
  "dashboard.slideCount": "{current} de {total} · deslice · últimas 48 h",
  "dashboard.newReading": "Nueva lectura",
};

export default es;
