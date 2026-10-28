import type en from "../en/urine";

const ht: Record<keyof typeof en, string> = {
  // Picker
  "urine.title": "Tès pwoteyin nan pipi",
  "urine.subtitleHold": "Sa fè plis pase {hours} èdtan depi dènye rezilta ou. Tanpri anrejistre youn pou ou ka kontinye.",
  "urine.subtitle": "Tanpri anrejistre rezilta dènye tès pwoteyin nan pipi ou te fè a.",
  "urine.info": "Sa ede ekip swen ou siveye siy preeklanpsi. Bann tès yo nan twous ou a.",
  "urine.selected": "Ou chwazi:",
  "urine.saveResult": "Anrejistre rezilta a",
  "urine.cantTestNow": "Mwen pa ka fè tès la kounye a",
  "urine.reminderNote": "Ou ka anrejistre yon rezilta nenpòt lè. Si {hours} èdtan pase san rezilta, n ap mande ou antre l anvan ou kontinye.",
  "urine.unableInfo": "Fè ekip swen ou konnen poukisa. Y ap wè sa nan dosye ou, epi n ap mande ou ankò demen.",
  "urine.sendToCareTeam": "Voye bay ekip swen ou",
  "urine.backToResults": "Retounen nan rezilta yo",
  "urine.couldntSaveTitle": "Pa t ka anrejistre",
  "urine.resultNotSaved": "Rezilta ou a pa t anrejistre. Tanpri eseye ankò.",
  "urine.reportNotSaved": "Rapò ou a pa t anrejistre. Tanpri eseye ankò.",
  "urine.recordAnotherTitle": "Anrejistre yon lòt rezilta?",
  "urine.recordAnotherBody": "Ou te anrejistre {result} {when}. Ou vle anrejistre sa a tou?",
  "urine.aResult": "yon rezilta",

  // Result labels
  "urine.resultNegative": "Negatif",
  "urine.resultTrace": "Tras",

  // "I can't test right now" reasons
  "urine.reasonOutOfStrips": "Mwen pa gen bann tès ankò",
  "urine.reasonNoKit": "Mwen pa gen twous mwen avè m",
  "urine.reasonOther": "Yon lòt rezon",
  "urine.couldntTest": "Pa t ka fè tès la",

  // describeRelative
  "urine.justNow": "fèk kounye a",
  "urine.minAgo": "gen {n} minit",
  "urine.hoursAgoOne": "gen {n} èdtan",
  "urine.hoursAgoOther": "gen {n} èdtan",
  "urine.yesterday": "yè",
  "urine.daysAgo": "gen {n} jou",

  // Reminder notifications
  "urine.reminderTitle": "Li lè pou tchèk CareView ou",
  "urine.reminderBody": "Anrejistre rezilta pwoteyin nan pipi ou nan aplikasyon an.",
  "urine.reminderChannel": "Rapèl",
};

export default ht;
