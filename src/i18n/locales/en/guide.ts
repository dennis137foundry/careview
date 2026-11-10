// Guided measurements: the words under each step-by-step animation.
//
// The animations have no words in them, so this text carries every
// instruction. It follows each manufacturer's own guide (iHealth BP3L and BG5S
// quick start guides; A&D UA-651BLE quick start guide and manual). The error
// texts (guide.bpErr*, guide.bgErr*) follow what iHealth's SDK documents for
// each device error code. Keep it that way: a change here is a change to
// patient instructions.
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
  "guide.bpPressureLabel": "Cuff pressure",
  // Cuff error codes (iHealth BP error numbers), in plain words.
  "guide.bpErrTitle": "The cuff stopped the measurement",
  "guide.bpErrMove":
    "Your arm moved during the measurement. Rest your arm on the table, stay still and quiet, and try again.",
  "guide.bpErrNoPulse":
    "The cuff couldn't read your blood pressure. Check that it is on your bare upper arm at heart level, stay still, and try again.",
  "guide.bpErrTight":
    "The cuff may be too tight, or the tube is bent or blocked. Loosen the cuff so one finger slides under the edge, check the tube, and try again.",
  "guide.bpErrLoose":
    "The cuff is too loose or is losing air. Wrap it snugly so only one finger slides under the edge, and try again.",
  "guide.bpErrPressure":
    "The cuff stopped because the pressure went too high. Rest for a few minutes, check the cuff, and try again.",
  "guide.bpErrBattery": "The cuff's battery is low. Charge it, then try again.",
  "guide.bpErrRangeHigh":
    "Your blood pressure was higher than the cuff can measure. Rest quietly for 5 minutes and measure again. If this happens again, contact your healthcare provider right away.",
  "guide.bpErrRangeLow":
    "Your blood pressure was lower than the cuff can measure. Rest and measure again. If this happens again, contact your healthcare provider right away.",
  "guide.bpErrRepeat":
    "The cuff couldn't finish the measurement. Rest for a minute, stay still and quiet, and try again.",

  // iHealth HS2S scale
  "guide.hs2sStepOnTitle": "Step onto the scale",
  "guide.hs2sStepOnBody":
    "Stand in the center of the scale with bare feet. It turns on and connects by itself.",
  "guide.hs2sStandTitle": "Stand still…",
  "guide.hs2sStandBody": "Keep your arms relaxed until your weight is captured.",

  // iHealth BG5S glucose meter (live test step by step; the import stays)
  "guide.bgTestNow": "Test now, step by step",
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
  // Live test: what the meter is doing, under the step.
  "guide.bgLiveFinding": "Looking for your meter. Inserting the strip turns it on.",
  "guide.bgLiveConnecting": "Meter found. Getting it ready…",
  "guide.bgLiveWaitingBlood": "The meter is waiting for blood.",
  "guide.bgLiveStripOut": "The strip came out. Insert a strip to continue.",
  "guide.bgLiveNotFoundBody":
    "Make sure a strip is in the meter and the meter is on and close to your phone, then try again.",
  "guide.bgLiveOffTitle": "The meter turned off",
  "guide.bgLiveOffBody":
    "This happens when blood isn't added within 3 minutes of inserting the strip, or when the strip comes out. Take the strip out and start again. Use a new strip if it already has blood on it.",
  "guide.bgLiveNoResultBody":
    "The meter didn't send a result. If it shows one, tap Import my reading to bring it in. Otherwise start again with a new strip.",
  // Meter error codes (iHealth BG5S error numbers), in plain words.
  "guide.bgErrTitle": "The meter stopped the test",
  "guide.bgErrLowBattery": "The meter's battery is low. Charge it, then test again.",
  "guide.bgErrStripOut": "The strip came out during the test. Test again with a new strip.",
  "guide.bgErrUsedStrip":
    "This strip is used or wet. Throw it away and test again with a new strip.",
  "guide.bgErrTemperature":
    "The meter is too cold or too hot. Leave it at room temperature for at least 30 minutes, then test again.",
  "guide.bgErrRepeat": "The meter couldn't finish the test. Test again with a new strip.",
  "guide.bgErrLoTitle": "Below the meter's range (LO)",
  "guide.bgErrLoBody":
    "Your glucose is lower than the meter can measure. Test again with a new strip. If you get this result again, contact your healthcare provider right away.",
  "guide.bgErrHiTitle": "Above the meter's range (HI)",
  "guide.bgErrHiBody":
    "Your glucose is higher than the meter can measure. Test again with a new strip. If you get this result again, contact your healthcare provider right away.",

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
