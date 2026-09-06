import {
  AWAY_THRESHOLD_MS,
  clearLoginSession,
  isLoginSession,
  markLoginSession,
  noteAppBackgrounded,
  noteAppForegrounded,
} from "../src/services/urineProteinSession";

describe("urine protein login session", () => {
  const t0 = 1_000_000_000_000;

  beforeEach(() => {
    clearLoginSession();
  });

  it("is off until a login marks it", () => {
    expect(isLoginSession(t0)).toBe(false);
    markLoginSession();
    expect(isLoginSession(t0)).toBe(true);
  });

  it("survives a brief background hop such as a permission dialog", () => {
    markLoginSession();
    noteAppBackgrounded(t0);
    noteAppForegrounded(t0 + 8_000);
    expect(isLoginSession(t0 + 9_000)).toBe(true);
  });

  it("ends once the app has been away for the threshold", () => {
    markLoginSession();
    noteAppBackgrounded(t0);
    noteAppForegrounded(t0 + AWAY_THRESHOLD_MS);
    expect(isLoginSession(t0 + AWAY_THRESHOLD_MS + 1)).toBe(false);
  });

  it("answers correctly even if asked before the foreground note arrives", () => {
    markLoginSession();
    noteAppBackgrounded(t0);
    // Dashboard listener fires first and asks directly.
    expect(isLoginSession(t0 + AWAY_THRESHOLD_MS + 5_000)).toBe(false);
    // The later foreground note must not resurrect it.
    noteAppForegrounded(t0 + AWAY_THRESHOLD_MS + 6_000);
    expect(isLoginSession(t0 + AWAY_THRESHOLD_MS + 7_000)).toBe(false);
  });

  it("a short hop asked about early stays in session", () => {
    markLoginSession();
    noteAppBackgrounded(t0);
    expect(isLoginSession(t0 + 5_000)).toBe(true);
    noteAppForegrounded(t0 + 6_000);
    expect(isLoginSession(t0 + 7_000)).toBe(true);
  });

  it("logout clears it immediately", () => {
    markLoginSession();
    clearLoginSession();
    expect(isLoginSession(t0)).toBe(false);
  });
});
