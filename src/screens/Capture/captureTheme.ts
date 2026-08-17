/**
 * captureTheme.ts
 *
 * The visual language of the capture flow: dark gradient, orbiting ring,
 * device portrait, reading card.
 *
 * These styles are a VERBATIM copy of the StyleSheet in CaptureScreen.tsx.
 * They live here so BleCaptureScreen can look identical to the iHealth capture
 * screen without editing CaptureScreen.tsx at all — that file drives every
 * shipping iHealth device (BP3L, BP5, BP5S, HS2, HS2S, HS4S, BG5S) and is
 * deliberately left untouched.
 *
 * The duplication is intentional and temporary. Post-launch, CaptureScreen can
 * import from here and delete its local copy — a one-line change. Until then,
 * a visual tweak meant for both screens has to be made in both places.
 */
import { Dimensions, StyleSheet } from "react-native";
import { BTN } from "../../constants/buttons";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Uniform capture accent for ALL device types — the app's teal primary.
// (Per-device color themes were removed on purpose: one look everywhere.)
export const CAPTURE_ACCENT = BTN.primary;
export const CAPTURE_ACCENT_SOFT = "#7fd6de";

// Full-screen backdrop behind every capture screen.
export const CAPTURE_GRADIENT = ["#1a1a2e", "#16213e", "#0f0f23"];

export const captureStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnSpacer: {
    width: 44,
    height: 44,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  scrollContentSuccess: {
    justifyContent: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  contentSuccess: {
    paddingHorizontal: 20,
    paddingTop: 0,
  },
  deviceSection: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  deviceSectionSuccess: {
    width: 124,
    height: 124,
    marginBottom: 6,
  },
  deviceRing: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderStyle: "dashed",
    opacity: 0.5,
  },
  deviceRingSuccess: {
    width: 124,
    height: 124,
    borderRadius: 62,
  },
  ringDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  ringDot1: {
    top: -6,
    left: "50%",
    marginLeft: -6,
  },
  ringDot2: {
    bottom: -6,
    left: "50%",
    marginLeft: -6,
  },
  deviceImageContainer: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  deviceImageContainerSuccess: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  deviceImage: {
    width: 75,
    height: 75,
    resizeMode: "contain",
  },
  deviceImageSuccess: {
    width: 58,
    height: 58,
  },
  successBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#1a1a2e",
  },
  successBadgeSuccess: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
  },
  successRing: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
  },
  successRingSuccess: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  deviceName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 2,
    textAlign: "center",
  },
  deviceNameSuccess: {
    fontSize: 18,
  },
  deviceType: {
    fontSize: 13,
    color: "#888",
    marginBottom: 20,
    textAlign: "center",
  },
  deviceTypeSuccess: {
    marginBottom: 8,
  },
  statusSection: {
    alignItems: "center",
    minHeight: 80,
    justifyContent: "center",
  },
  statusText: {
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 8,
  },
  statusTextIdle: {
    color: "#888",
  },
  statusSubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  readingContainer: {
    alignItems: "center",
    marginVertical: 10,
  },
  readingContainerSuccess: {
    marginVertical: 0,
  },
  bpReading: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  bpValue: {
    fontSize: 64,
    fontWeight: "300",
    color: "#fff",
  },
  bpValueSuccess: {
    fontSize: 52,
  },
  bpValueHigh: {
    color: "#FF5252",
  },
  bpSeparator: {
    fontSize: 48,
    fontWeight: "200",
    color: "#666",
    marginHorizontal: 4,
  },
  bpSeparatorSuccess: {
    fontSize: 38,
  },
  readingUnit: {
    fontSize: 18,
    color: "#888",
    marginTop: 4,
  },
  readingUnitSuccess: {
    fontSize: 15,
    marginTop: 0,
  },
  highBPBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(255, 82, 82, 0.15)",
    borderRadius: 20,
    gap: 6,
  },
  highBPBadgeSuccess: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  highBPText: {
    fontSize: 14,
    color: "#FF8A80",
    fontWeight: "500",
  },
  highBPTextSuccess: {
    fontSize: 12,
  },
  pulseContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 20,
  },
  pulseContainerSuccess: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pulseText: {
    fontSize: 16,
    color: "#fff",
    marginLeft: 8,
  },
  pulseTextSuccess: {
    fontSize: 14,
  },
  weightValue: {
    fontSize: 72,
    fontWeight: "200",
    color: "#fff",
  },
  weightValueSuccess: {
    fontSize: 56,
  },
  subReading: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
  },
  subReadingSuccess: {
    fontSize: 14,
    marginTop: 4,
  },
  syncStatusText: {
    fontSize: 14,
    color: "#888",
    marginTop: 16,
  },
  syncStatusTextSuccess: {
    fontSize: 13,
    marginTop: 8,
  },
  syncStatusSynced: {
    color: "#4caf50",
  },
  syncStatusPending: {
    color: "#ffc107",
  },
  progressContainer: {
    width: "80%",
    height: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    marginTop: 24,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 2,
  },
  buttonContainer: {
    width: "100%",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 10,
  },
  buttonContainerSuccess: {
    marginTop: 10,
    marginBottom: 0,
  },
  primaryButton: {
    width: SCREEN_WIDTH - 48,
    height: 56,
    borderRadius: BTN.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CAPTURE_ACCENT,
  },
  primaryButtonSuccess: {
    height: 50,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  // Red while the capture process is active — clear stop affordance.
  cancelButton: {
    width: SCREEN_WIDTH - 48,
    height: 56,
    borderRadius: BTN.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BTN.destructive,
  },
  cancelButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  glucoseTimingModal: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#152238",
    borderRadius: 8,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  glucoseTimingTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  glucoseTimingValue: {
    color: "#A5D6A7",
    fontSize: 28,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 18,
  },
  glucoseTimingGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  glucoseTimingOption: {
    width: "48%",
    minHeight: 48,
    borderRadius: BTN.radius,
    backgroundColor: "rgba(67,160,71,0.18)",
    borderWidth: 1,
    borderColor: "rgba(165,214,167,0.35)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  glucoseTimingOptionText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  glucoseTimingCancel: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  glucoseTimingCancelText: {
    color: "#b0bec5",
    fontSize: 15,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 18,
    color: "#ff5252",
    textAlign: "center",
    marginBottom: 20,
  },
  backButtonAlt: {
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
  },
});
