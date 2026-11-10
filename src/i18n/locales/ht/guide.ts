import type en from "../en/guide";

const ht: Record<keyof typeof en, string> = {
  // Pou tout aparèy
  "guide.stepOf": "Etap {n} sou {total}",
  "guide.skipToMeasure": "Ale dirèk nan mezi a",
  "guide.startMeasuring": "Kòmanse mezi a",
  "guide.notFoundTitle": "Nou pa jwenn aparèy ou a",
  "guide.noReadingTitle": "Nou pa resevwa okenn mezi",

  // Manchèt tansyon iHealth BP3L
  "guide.bp3lSitTitle": "Chita epi repoze w",
  "guide.bp3lSitBody":
    "Chita ak do w apiye, pye w plat atè, epi pa kwaze janm ou. Respire dousman epi repoze w anvan ou kòmanse.",
  "guide.bp3lCuffTitle": "Mete manchèt la",
  "guide.bp3lCuffBody":
    "Vlope manchèt la sou anwo bra ou, sou po w, 1 a 2 cm (apeprè ½ pous) anwo koud ou, ak tib la sou anndan bra ou. Li dwe sere men pou l konfòtab: yon dwèt dwe ka glise anba rebò a.",
  "guide.bp3lArmTitle": "Apiye bra ou",
  "guide.bp3lArmBody":
    "Apiye bra ou sou tab la, pla men w anlè, pou manchèt la rive menm wotè ak kè w. Pa apiye sou tib la.",
  "guide.bp3lConnectTitle": "N ap konekte ak manchèt ou a…",
  "guide.bp3lConnectBody":
    "Kite bra ou apiye menm wotè ak kè w. CareView kòmanse mezi a pou kont li.",
  "guide.bp3lMeasureTitle": "N ap mezire…",
  "guide.bp3lMeasureBody": "Rete san bouje epi pa pale jiskaske manchèt la lage.",
  "guide.bpPressureLabel": "Presyon manchèt la",
  "guide.bpErrTitle": "Manchèt la sispann mezi a",
  "guide.bpErrMove":
    "Bra ou te bouje pandan mezi a. Apiye bra ou sou tab la, rete san bouje epi pa pale, epi eseye ankò.",
  "guide.bpErrNoPulse":
    "Manchèt la pa t ka li tansyon ou. Verifye li sou anwo bra ou, sou po w, menm wotè ak kè w, rete san bouje, epi eseye ankò.",
  "guide.bpErrTight":
    "Manchèt la ka twò sere, oswa tib la pliye oswa bouche. Lage manchèt la pou yon dwèt ka glise anba rebò a, verifye tib la, epi eseye ankò.",
  "guide.bpErrLoose":
    "Manchèt la twò lach oswa l ap pèdi lè. Vlope l byen pou se yon sèl dwèt ki ka glise anba rebò a, epi eseye ankò.",
  "guide.bpErrPressure":
    "Manchèt la sispann paske presyon an monte twò wo. Repoze w kèk minit, verifye manchèt la, epi eseye ankò.",
  "guide.bpErrBattery": "Batri manchèt la ba. Chaje l, epi eseye ankò.",
  "guide.bpErrRangeHigh":
    "Tansyon ou te pi wo pase sa manchèt la ka mezire. Repoze w trankil pandan 5 minit epi mezire ankò. Si sa rive ankò, kontakte founisè swen sante ou touswit.",
  "guide.bpErrRangeLow":
    "Tansyon ou te pi ba pase sa manchèt la ka mezire. Repoze w epi mezire ankò. Si sa rive ankò, kontakte founisè swen sante ou touswit.",
  "guide.bpErrRepeat":
    "Manchèt la pa t ka fini mezi a. Repoze w yon minit, rete san bouje epi pa pale, epi eseye ankò.",

  // Balans iHealth HS2S
  "guide.hs2sStepOnTitle": "Monte sou balans lan",
  "guide.hs2sStepOnBody":
    "Kanpe nan mitan balans lan ak pye atè. Li limen epi li konekte pou kont li.",
  "guide.hs2sStandTitle": "Rete san bouje…",
  "guide.hs2sStandBody": "Kite bra ou rilaks jiskaske nou pran pwa ou.",

  // Glikomèt iHealth BG5S
  "guide.bgTestNow": "Fè tès la kounye a, etap pa etap",
  "guide.importReading": "Enpòte mezi mwen an",
  "guide.bgReadyTitle": "Prepare w",
  "guide.bgReadyBody":
    "Mete yon lansèt nèf nan aparèy pou pike a epi chwazi pwofondè a. Lave men w ak dlo tyèd ak savon epi seche yo byen.",
  "guide.bgStripTitle": "Mete yon bandlèt tès",
  "guide.bgStripBody":
    "Kenbe yon bandlèt nèf nan mitan, flèch la vire bò glikomèt la, epi glise l nan twou bandlèt la. Pa manyen bout ki pran san an. Lè siy gout san an ap limen-tenn, glikomèt la pare. Mete san an nan mwens pase 3 minit, sinon glikomèt la ap etenn.",
  "guide.bgLanceTitle": "Pike pwent dwèt ou",
  "guide.bgLanceBody":
    "Peze aparèy pou pike a sou kote pwent dwèt ou epi peze bouton an pou l pike.",
  "guide.bgDropTitle": "Kite yon gout fòme",
  "guide.bgDropBody":
    "Masaje dwèt ou dousman jiskaske yon ti gout san fòme. Pa peze kote ou pike a.",
  "guide.bgApplyTitle": "Touche bandlèt la ak gout la",
  "guide.bgApplyBody":
    "Touche gout la sou pwent bandlèt la touswit epi kite ti fenèt la plen nèt. Si li pa plen, pa mete plis san: pran yon lòt bandlèt nèf.",
  "guide.bgWaitTitle": "Tann rezilta ou",
  "guide.bgWaitBody": "Glikomèt la konte soti 5 rive 1, epi li montre rezilta ou.",
  "guide.bgDoneTitle": "Jete bandlèt la ak lansèt la",
  "guide.bgDoneBody":
    "Peze bouton pou ejekte a dèyè glikomèt la pou bandlèt la tonbe nan yon resipyan apwopriye. Remete lansèt la nan kouvèti li anvan ou jete l, epi lave men w.",
  "guide.bgFindTitle": "N ap chèche glikomèt ou a…",
  "guide.bgImportTitle": "N ap pran mezi yo nan glikomèt ou a…",
  "guide.bgNearBody": "Kenbe glikomèt la toupre telefòn ou.",
  "guide.bgLiveFinding": "N ap chèche glikomèt ou a. Lè ou mete bandlèt la, li limen.",
  "guide.bgLiveConnecting": "Nou jwenn glikomèt la. N ap prepare l…",
  "guide.bgLiveWaitingBlood": "Glikomèt la ap tann san an.",
  "guide.bgLiveStripOut": "Bandlèt la soti. Mete yon bandlèt pou kontinye.",
  "guide.bgLiveNotFoundBody":
    "Asire w gen yon bandlèt nan glikomèt la, epi glikomèt la limen e li toupre telefòn ou, epi eseye ankò.",
  "guide.bgLiveOffTitle": "Glikomèt la etenn",
  "guide.bgLiveOffBody":
    "Sa rive lè ou pa mete san nan 3 minit apre ou mete bandlèt la, oswa lè bandlèt la soti. Retire bandlèt la epi rekòmanse. Pran yon bandlèt nèf si gen san sou li deja.",
  "guide.bgLiveNoResultBody":
    "Glikomèt la pa voye okenn rezilta. Si li montre youn, peze Enpòte mezi mwen an pou mete l. Sinon, rekòmanse ak yon bandlèt nèf.",
  "guide.bgErrTitle": "Glikomèt la sispann tès la",
  "guide.bgErrLowBattery": "Batri glikomèt la ba. Chaje l, epi fè tès la ankò.",
  "guide.bgErrStripOut": "Bandlèt la soti pandan tès la. Fè tès la ankò ak yon bandlèt nèf.",
  "guide.bgErrUsedStrip":
    "Bandlèt sa a deja sèvi oswa li mouye. Jete l epi fè tès la ankò ak yon bandlèt nèf.",
  "guide.bgErrTemperature":
    "Glikomèt la twò frèt oswa twò cho. Kite l nan tanperati chanm nan pandan omwen 30 minit, epi fè tès la ankò.",
  "guide.bgErrRepeat": "Glikomèt la pa t ka fini tès la. Fè l ankò ak yon bandlèt nèf.",
  "guide.bgErrLoTitle": "Pi ba pase sa glikomèt la ka mezire (LO)",
  "guide.bgErrLoBody":
    "Sik nan san ou pi ba pase sa glikomèt la ka mezire. Fè tès la ankò ak yon bandlèt nèf. Si ou jwenn rezilta sa a ankò, kontakte founisè swen sante ou touswit.",
  "guide.bgErrHiTitle": "Pi wo pase sa glikomèt la ka mezire (HI)",
  "guide.bgErrHiBody":
    "Sik nan san ou pi wo pase sa glikomèt la ka mezire. Fè tès la ankò ak yon bandlèt nèf. Si ou jwenn rezilta sa a ankò, kontakte founisè swen sante ou touswit.",

  // Manchèt A&D UA-651BLE ak aparèy li
  "guide.andCuffTitle": "Mete manchèt la",
  "guide.andCuffBody":
    "Apiye bra goch ou sou tab la, pla men w anlè. Vlope manchèt la sou anwo bra ou, sou po w, 1 a 2 cm (apeprè ½ pous) anwo pli koud ou. Tache l pou de dwèt ka glise anba l.",
  "guide.andStartTitle": "Peze START",
  "guide.andStartBody":
    "Chita ak do w apiye, pye w plat atè, san kwaze janm, bra ou apiye menm wotè ak kè w. Apre sa, peze START yon sèl fwa sou aparèy la.",
  "guide.andPressedStart": "Mwen peze START",
  "guide.andMeasureTitle": "N ap mezire…",
  "guide.andMeasureBody":
    "Rete trankil epi pa pale pandan manchèt la ap sere epi lage. Kenbe telefòn ou omwen 30 cm (1 pye) lwen aparèy la.",
  "guide.andItsDone": "Li fini",
  "guide.andNearTitle": "N ap voye mezi ou a…",
  "guide.andNearBody":
    "Kite CareView louvri ak telefòn ou toupre. Mezi ou a ap rive nan apeprè yon minit.",
  "guide.andPairShow": "Montre m kijan",
  "guide.andPairHide": "Kache",
};

export default ht;
