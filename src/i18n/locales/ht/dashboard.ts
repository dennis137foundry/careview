import type en from "../en/dashboard";

const ht: Record<keyof typeof en, string> = {
  "dashboard.goodMorning": "Bonjou",
  "dashboard.goodAfternoon": "Bon apremidi",
  "dashboard.goodEvening": "Bonswa",
  "dashboard.nameFallback": "Byenveni",
  "dashboard.bellDue": "Li lè pou bay rezilta pwoteyin nan pipi",
  "dashboard.bellNotifications": "Notifikasyon",
  "dashboard.allCaughtUp": "Ou pa gen anyen pou fè kounye a",

  "dashboard.remindersTitle": "Rapèl",
  "dashboard.remindersMessage": "CareView ka fè w sonje lè li lè pou bay rezilta pwoteyin nan pipi. Ou vle pèmèt notifikasyon?",
  "dashboard.allow": "Pèmèt",

  "dashboard.wellnessTitle": "Byennèt manman chak jou",
  "dashboard.afterDelivery": "Apre akouchman",
  "dashboard.weekDay": "Semèn {week} • Jou {day}",
  "dashboard.earlierFacts": "Enfòmasyon anvan yo ›",
  "dashboard.dueDateSaved": "Dat akouchman an anrejistre",
  "dashboard.wellnessBack": "Akèy",
  "dashboard.wellnessBackLabel": "Retounen nan akèy",
  "dashboard.wellnessNoEddTitle": "Poko gen dat akouchman",
  "dashboard.wellnessNoEddText": "Mete dat akouchman ou sou ekran akèy la, epi enfòmasyon chak jou yo ap swiv gwosès ou.",
  "dashboard.wellnessLoadingEarlier": "N ap chaje jou anvan yo…",
  "dashboard.wellnessFirstDay": "Sa se premye jou gwosès ou.",

  "dashboard.urineProtein": "Pwoteyin nan pipi",
  "dashboard.urineResultNeeded": "Bezwen yon rezilta",
  "dashboard.urineNoResultYet": "Poko gen rezilta",
  "dashboard.urineOverdue": "An reta · dènye rezilta {when}",
  "dashboard.urineLast": "Dènye: {result} · {when}",
  "dashboard.urineAlertChip": "ALÈT {result}",
  "dashboard.todayCount": "{count} JODI A",
  "dashboard.recordResult": "Mete rezilta",
  "dashboard.urineSaved": "Rezilta pwoteyin nan pipi anrejistre",
  "dashboard.urineUnableSent": "Nou voye l bay ekip swen ou. N ap tcheke ankò demen.",

  "dashboard.healthEvents": "Evènman sante",
  "dashboard.healthEventsPrompt": "Ou te resevwa swen andeyò lakay ou? Di ekip swen ou sa touswit.",
  "dashboard.wentToHospital": "Mwen te ale lopital",

  "dashboard.latestReadings": "Dènye mezi yo",
  "dashboard.historyLink": "Istorik",
  "dashboard.noRecentReadings": "Pa gen mezi nan dènye 48 èdtan yo",
  "dashboard.bloodPressure": "Tansyon",
  "dashboard.bloodGlucose": "Sik nan san",
  "dashboard.weight": "Pwa",
  "dashboard.aboveRange": "Pi wo pase limit la",
  "dashboard.inRange": "Nan limit la",
  "dashboard.heartRate": "Pou {hr}",
  "dashboard.recorded": "Anrejistre",
  "dashboard.slideCount": "{current} sou {total} · glise · dènye 48 è",
  "dashboard.newReading": "Nouvo mezi",
};

export default ht;
