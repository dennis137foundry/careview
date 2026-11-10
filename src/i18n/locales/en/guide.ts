// Guided measurements: the words under each step-by-step animation.
//
// The animations have no words in them, so this text carries every
// instruction. It follows each manufacturer's own guide (iHealth BP3L and BG5S
// quick start guides; A&D UA-651BLE quick start guide and manual). Keep it
// that way: a change here is a change to patient instructions.
export default {
  // Shared
  "guide.stepOf": "Step {n} of {total}",
  "guide.skipToMeasure": "Skip to measurement",
  "guide.startMeasuring": "Start measuring",
  "guide.notFoundTitle": "We couldn't find your device",
  "guide.noReadingTitle": "No reading received",

  // iHealth BP3L blood pressure cuff
  "guide.bp3lSitTitle": "Sit and rest",
  "guide.bp3lSitBody":
    "Sit with your back supported, feet flat on the floor and legs uncrossed. Breathe calmly and rest before you start.",
  "guide.bp3lCuffTitle": "Put on the cuff",
  "guide.bp3lCuffBody":
    "Wrap the cuff on your bare upper arm, 1–2 cm (about ½ inch) above the elbow, with the tube on the inside of your arm. It should be snug but comfortable: one finger should slide under the edge.",
  "guide.bp3lArmTitle": "Rest your arm",
  "guide.bp3lArmBody":
    "Rest your arm on the table, palm up, so the cuff is at the level of your heart. Don't lean on the tube.",
  "guide.bp3lConnectTitle": "Connecting to your cuff…",
  "guide.bp3lConnectBody":
    "Keep your arm resting at heart level. CareView starts the measurement by itself.",
  "guide.bp3lMeasureTitle": "Measuring…",
  "guide.bp3lMeasureBody": "Stay still and don't talk until the cuff loosens.",

  // iHealth HS2S scale
  "guide.hs2sStepOnTitle": "Step onto the scale",
  "guide.hs2sStepOnBody":
    "Stand in the center of the scale with bare feet. It turns on and connects by itself.",
  "guide.hs2sStandTitle": "Stand still…",
  "guide.hs2sStandBody": "Keep your arms relaxed until your weight is captured.",

  // iHealth BG5S glucose meter ("How to test" walkthrough, then the import)
  "guide.howToTest": "How to test",
  "guide.importReading": "Import my reading",
  "guide.bgReadyTitle": "Get ready",
  "guide.bgReadyBody":
    "Put a new lancet in your lancing device and set the depth. Wash your hands with warm, soapy water and dry them well.",
  "guide.bgStripTitle": "Insert a test strip",
  "guide.bgStripBody":
    "Hold a new strip by the middle, arrow toward the meter, and slide it into the strip port. Don't touch the end that takes the blood. When the blood-drop symbol flashes, the meter is ready. Add blood within 3 minutes, or the meter turns off.",
  "guide.bgLanceTitle": "Prick your fingertip",
  "guide.bgLanceBody":
    "Press the lancing device against the side of your fingertip and press the release button.",
  "guide.bgDropTitle": "Let a drop form",
  "guide.bgDropBody":
    "Massage your finger gently until a small drop of blood forms. Don't squeeze the spot you pricked.",
  "guide.bgApplyTitle": "Touch the drop to the strip",
  "guide.bgApplyBody":
    "Touch the drop to the tip of the strip right away and let the window fill completely. If it doesn't fill, don't add more blood: use a new strip.",
  "guide.bgWaitTitle": "Wait for your result",
  "guide.bgWaitBody": "The meter counts down from 5, then shows your result.",
  "guide.bgDoneTitle": "Throw away the strip and lancet",
  "guide.bgDoneBody":
    "Push the eject button on the back of the meter to drop the strip into a proper container. Put the lancet back in its cover before you throw it away, then wash your hands.",
  "guide.bgFindTitle": "Finding your meter…",
  "guide.bgImportTitle": "Getting readings from your meter…",
  "guide.bgNearBody": "Keep the meter close to your phone.",

  // A&D UA-651BLE cuff with its own monitor
  "guide.andCuffTitle": "Put on the cuff",
  "guide.andCuffBody":
    "Rest your left arm on the table, palm up. Wrap the cuff on your bare upper arm, 1–2 cm (about ½ inch) above the inside of your elbow. Fasten it so two fingers slide underneath.",
  "guide.andStartTitle": "Press START",
  "guide.andStartBody":
    "Sit back with your feet flat and legs uncrossed, arm resting at heart level. Then press START once on the monitor.",
  "guide.andPressedStart": "I pressed START",
  "guide.andMeasureTitle": "Measuring…",
  "guide.andMeasureBody":
    "Sit quietly and don't talk while the cuff tightens and loosens. Keep your phone at least 30 cm (1 foot) from the monitor.",
  "guide.andItsDone": "It's done",
  "guide.andNearTitle": "Sending your reading…",
  "guide.andNearBody":
    "Keep CareView open with your phone nearby. Your reading arrives within about a minute.",
  "guide.andPairShow": "Show me how",
  "guide.andPairHide": "Hide",
} as const;
