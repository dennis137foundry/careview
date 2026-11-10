import type en from "../en/guide";

const es: Record<keyof typeof en, string> = {
  // Compartido
  "guide.stepOf": "Paso {n} de {total}",
  "guide.skipToMeasure": "Ir directo a la medición",
  "guide.startMeasuring": "Empezar a medir",
  "guide.notFoundTitle": "No encontramos su dispositivo",
  "guide.noReadingTitle": "No se recibió ninguna lectura",

  // Brazalete de presión arterial iHealth BP3L
  "guide.bp3lSitTitle": "Siéntese y descanse",
  "guide.bp3lSitBody":
    "Siéntese con la espalda apoyada, los pies planos en el suelo y las piernas sin cruzar. Respire con calma y descanse antes de empezar.",
  "guide.bp3lCuffTitle": "Póngase el brazalete",
  "guide.bp3lCuffBody":
    "Coloque el brazalete en la parte superior del brazo, sobre la piel, de 1 a 2 cm (aproximadamente ½ pulgada) por encima del codo, con el tubo hacia la parte interior del brazo. Debe quedar ajustado pero cómodo: un dedo debe caber debajo del borde.",
  "guide.bp3lArmTitle": "Apoye el brazo",
  "guide.bp3lArmBody":
    "Apoye el brazo sobre la mesa, con la palma hacia arriba, de modo que el brazalete quede a la altura del corazón. No se apoye sobre el tubo.",
  "guide.bp3lConnectTitle": "Conectando con su brazalete…",
  "guide.bp3lConnectBody":
    "Mantenga el brazo apoyado a la altura del corazón. CareView inicia la medición automáticamente.",
  "guide.bp3lMeasureTitle": "Midiendo…",
  "guide.bp3lMeasureBody": "Quédese quieta y no hable hasta que el brazalete se afloje.",

  // Báscula iHealth HS2S
  "guide.hs2sStepOnTitle": "Súbase a la báscula",
  "guide.hs2sStepOnBody":
    "Párese descalza en el centro de la báscula. Se enciende y se conecta sola.",
  "guide.hs2sStandTitle": "Quédese quieta…",
  "guide.hs2sStandBody": "Mantenga los brazos relajados hasta que se registre su peso.",

  // Glucómetro iHealth BG5S
  "guide.howToTest": "Cómo hacer la prueba",
  "guide.importReading": "Importar mi lectura",
  "guide.bgReadyTitle": "Prepárese",
  "guide.bgReadyBody":
    "Ponga una lanceta nueva en el dispositivo de punción y ajuste la profundidad. Lávese las manos con agua tibia y jabón y séqueselas bien.",
  "guide.bgStripTitle": "Inserte una tira reactiva",
  "guide.bgStripBody":
    "Tome una tira nueva por el centro, con la flecha hacia el glucómetro, e insértela en la ranura para tiras. No toque el extremo que recibe la sangre. Cuando parpadee el símbolo de la gota de sangre, el glucómetro está listo. Aplique la sangre en menos de 3 minutos o el glucómetro se apagará.",
  "guide.bgLanceTitle": "Pínchese la yema del dedo",
  "guide.bgLanceBody":
    "Presione el dispositivo de punción contra el costado de la yema del dedo y presione el botón de disparo.",
  "guide.bgDropTitle": "Deje que se forme una gota",
  "guide.bgDropBody":
    "Masajee el dedo suavemente hasta que se forme una pequeña gota de sangre. No apriete el lugar donde se pinchó.",
  "guide.bgApplyTitle": "Toque la tira con la gota",
  "guide.bgApplyBody":
    "Acerque enseguida la gota a la punta de la tira y deje que la ventanilla se llene por completo. Si no se llena, no agregue más sangre: use una tira nueva.",
  "guide.bgWaitTitle": "Espere su resultado",
  "guide.bgWaitBody": "El glucómetro cuenta de 5 a 1 y luego muestra su resultado.",
  "guide.bgDoneTitle": "Deseche la tira y la lanceta",
  "guide.bgDoneBody":
    "Presione el botón de expulsión en la parte de atrás del glucómetro para dejar caer la tira en un recipiente adecuado. Vuelva a poner la lanceta en su tapa antes de desecharla y luego lávese las manos.",
  "guide.bgFindTitle": "Buscando su glucómetro…",
  "guide.bgImportTitle": "Obteniendo las lecturas de su glucómetro…",
  "guide.bgNearBody": "Mantenga el glucómetro cerca de su teléfono.",

  // Brazalete A&D UA-651BLE con monitor
  "guide.andCuffTitle": "Póngase el brazalete",
  "guide.andCuffBody":
    "Apoye el brazo izquierdo sobre la mesa, con la palma hacia arriba. Coloque el brazalete en la parte superior del brazo, sobre la piel, de 1 a 2 cm (aproximadamente ½ pulgada) por encima de la parte interior del codo. Ajústelo de modo que quepan dos dedos debajo.",
  "guide.andStartTitle": "Presione START",
  "guide.andStartBody":
    "Siéntese con la espalda apoyada, los pies planos y las piernas sin cruzar, con el brazo apoyado a la altura del corazón. Luego presione START una vez en el monitor.",
  "guide.andPressedStart": "Ya presioné START",
  "guide.andMeasureTitle": "Midiendo…",
  "guide.andMeasureBody":
    "Quédese quieta y no hable mientras el brazalete se aprieta y se afloja. Mantenga su teléfono a por lo menos 30 cm (1 pie) del monitor.",
  "guide.andItsDone": "Ya terminó",
  "guide.andNearTitle": "Enviando su lectura…",
  "guide.andNearBody":
    "Mantenga CareView abierta y su teléfono cerca. Su lectura llegará en aproximadamente un minuto.",
  "guide.andPairShow": "Mostrarme cómo",
  "guide.andPairHide": "Ocultar",
};

export default es;
