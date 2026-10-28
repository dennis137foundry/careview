// Home tab (DashboardScreen) and the Maternal Wellness Daily history
// (WellnessHistoryScreen). The daily facts themselves come from
// getDailyFact in the app's language; only the text around them is here.
export default {
  "dashboard.goodMorning": "Good morning",
  "dashboard.goodAfternoon": "Good afternoon",
  "dashboard.goodEvening": "Good evening",
  "dashboard.nameFallback": "there",
  "dashboard.bellDue": "Urine protein result due",
  "dashboard.bellNotifications": "Notifications",
  "dashboard.allCaughtUp": "You're all caught up",

  // Notification pre-prompt
  "dashboard.remindersTitle": "Reminders",
  "dashboard.remindersMessage": "CareView can remind you when a urine protein result is due. Allow notifications?",
  "dashboard.allow": "Allow",

  // Maternal Wellness Daily (hero card + history screen)
  "dashboard.wellnessTitle": "Maternal Wellness Daily",
  "dashboard.afterDelivery": "After Delivery",
  "dashboard.weekDay": "Week {week} • Day {day}",
  "dashboard.earlierFacts": "Earlier facts ›",
  "dashboard.dueDateSaved": "Due date saved",
  "dashboard.wellnessBack": "Home",
  "dashboard.wellnessBackLabel": "Back to home",
  "dashboard.wellnessNoEddTitle": "No due date yet",
  "dashboard.wellnessNoEddText": "Add your due date on the home screen and your daily facts will line up with your pregnancy.",
  "dashboard.wellnessLoadingEarlier": "Loading earlier days…",
  "dashboard.wellnessFirstDay": "That's the first day of your pregnancy.",

  // Urine protein tile
  "dashboard.urineProtein": "Urine protein",
  "dashboard.urineResultNeeded": "Result needed",
  "dashboard.urineNoResultYet": "No result recorded yet",
  "dashboard.urineOverdue": "Overdue · last result {when}",
  "dashboard.urineLast": "Last: {result} · {when}",
  "dashboard.urineAlertChip": "ALERT {result}",
  "dashboard.todayCount": "{count} TODAY",
  "dashboard.recordResult": "Record result",
  "dashboard.urineSaved": "Urine protein result saved",
  "dashboard.urineUnableSent": "Sent to your care team. We'll check back tomorrow.",

  // Health events tile
  "dashboard.healthEvents": "Health events",
  "dashboard.healthEventsPrompt": "Received care outside the home? Tell your care team right away.",
  "dashboard.wentToHospital": "I went to the hospital",

  // Latest readings
  "dashboard.latestReadings": "Latest readings",
  "dashboard.historyLink": "History",
  "dashboard.noRecentReadings": "No readings in the last 48 hours",
  "dashboard.bloodPressure": "Blood pressure",
  "dashboard.bloodGlucose": "Blood glucose",
  "dashboard.weight": "Weight",
  "dashboard.aboveRange": "Above range",
  "dashboard.inRange": "In range",
  "dashboard.heartRate": "HR {hr}",
  "dashboard.recorded": "Recorded",
  "dashboard.slideCount": "{current} of {total} · swipe · last 48 hrs",
  "dashboard.newReading": "New Reading",
} as const;
