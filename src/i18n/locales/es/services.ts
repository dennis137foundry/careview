import type en from "../en/services";

const es: Record<keyof typeof en, string> = {
  "services.accessRevoked": "Su equipo de atención médica desactivó su acceso a CareView. Comuníquese con ellos si cree que es un error.",
  "services.sessionExpired": "Su sesión expiró. Inicie sesión de nuevo.",

  "services.authNotRegistered": "Este número de teléfono no está registrado. Comuníquese con su médico.",
  "services.authAccessOff": "Su equipo de atención médica desactivó el acceso a CareView para este número. Comuníquese con su médico.",
  "services.authSmsFailed": "No se pudo enviar el mensaje de texto. Inténtelo de nuevo.",
  "services.authTooManyCodes": "Ha pedido demasiados códigos. Espere un momento e inténtelo de nuevo.",
  "services.authSendFailed": "No se pudo enviar el código",
  "services.authNoConnection": "No se pudo conectar con el servidor. Revise su conexión a internet e inténtelo de nuevo.",
  "services.authInvalidCode": "El código no es válido o ya venció. Inténtelo de nuevo.",
  "services.authPatientNotFound": "No se encontró su expediente de paciente.",
  "services.authVerifyFailed": "No se pudo verificar",
  "services.authStorageError": "No se pudo completar el inicio de sesión por un error de almacenamiento en el teléfono. Inténtelo de nuevo y, si el problema continúa, comuníquese con soporte.",
  "services.demoTitle": "Cuenta de demostración",
  "services.demoMessage": "¿Desea cargar la aplicación con datos de ejemplo?",

  "services.syncPaused": "Sincronización en pausa después de varios errores. Toque para reintentar.",
  "services.syncItemsFailed": "Elementos sin sincronizar: {count}",
  "services.requestTimedOut": "Se agotó el tiempo de espera",

  "services.cgmAccessOff": "Se desactivó el acceso a {source}",
  "services.cgmServerError": "El servidor respondió con un error ({status})",
  "services.cgmHealthConnectUnavailable": "Health Connect no está disponible",

  "services.deviceUnavailable": "Este dispositivo no está disponible para vincularse.",

  "services.btUnsupported": "Este teléfono no puede buscar dispositivos Bluetooth.",
  "services.btUnauthorizedAndroid": "CareView no tiene permiso para usar Bluetooth. Permita el acceso a Bluetooth en Configuración e inténtelo de nuevo.",
  "services.btUnauthorizedIos": "CareView no tiene permiso para usar Bluetooth. Permita Bluetooth en Configuración e inténtelo de nuevo.",
  "services.btPoweredOff": "Bluetooth está apagado. Encienda Bluetooth e inténtelo de nuevo.",
  "services.btLocationDisabled": "En este teléfono Android, la ubicación debe estar activada para buscar dispositivos Bluetooth.",
  "services.btReady": "Bluetooth está listo.",
  "services.btResetting": "Bluetooth se está reiniciando. Inténtelo de nuevo en un momento.",
  "services.btGettingReady": "Bluetooth se está preparando. Inténtelo de nuevo en un momento.",
  "services.btNotReady": "Bluetooth no está listo.",
  "services.btStatusUnavailable": "No se puede saber el estado de Bluetooth.",

  "services.typeBG5S": "Glucómetro iHealth BG5S",
  "services.typeGattBP": "Monitor de presión arterial BLE",
  "services.typeGattScale": "Báscula inteligente BLE",
};

export default es;
