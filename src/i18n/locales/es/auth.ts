import type en from "../en/auth";

const es: Record<keyof typeof en, string> = {
  "auth.subtitle": "Ingrese su número de celular para iniciar sesión.",
  "auth.phonePlaceholder": "Número de celular",
  "auth.pleaseWait": "Espere...",
  "auth.requestCode": "Pedir código",
  "auth.codeNote": "Le enviaremos un código de 6 dígitos para verificar su identidad.",
  "auth.phoneRequiredTitle": "Falta el número",
  "auth.phoneRequiredBody": "Ingrese su número de celular.",
  "auth.sendFailed": "No se pudo enviar el código de verificación.",
  "auth.sendFailedRetry": "No se pudo enviar el código. Inténtelo de nuevo.",

  "auth.verifyTitle": "Ingrese el código de verificación",
  "auth.sentCodeTo": "Enviamos un código de 6 dígitos al",
  "auth.verifying": "Verificando...",
  "auth.verify": "Verificar",
  "auth.changeNumber": "Cambiar número",
  "auth.resendCode": "Reenviar código",
  "auth.codeExpiry": "Los códigos vencen a los 10 minutos.",
  "auth.invalidCodeTitle": "Código no válido",
  "auth.enterAllDigits": "Ingrese los 6 dígitos.",
  "auth.verifyFailedTitle": "No se pudo verificar",
  "auth.invalidOrExpired": "El código no es válido o ya venció.",
  "auth.codeIncorrect": "El código es incorrecto o ya venció.",
  "auth.codeResent": "Le enviamos un nuevo código de verificación.",
  "auth.resendFailed": "No se pudo reenviar el código de verificación.",
};

export default es;
