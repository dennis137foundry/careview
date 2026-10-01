/**
 * The 2.5 TestFlight build crashed on the Devices screen: react-native-health is
 * a CommonJS export (module.exports = HealthKit) and the code read `.default`.
 * These load cgmHealthSource with the module shaped as it really ships.
 */
import { Platform } from "react-native";

const glucoseSample = {
  id: "8F2C-UUID",
  value: 131,
  sourceId: "com.dexcom.G7",
  sourceName: "Dexcom G7",
  startDate: "2026-10-01T14:05:00.000-0400",
  endDate: "2026-10-01T14:05:00.000-0400",
};

function loadWith(healthKitModule: unknown) {
  jest.resetModules();
  jest.doMock("react-native-health", () => healthKitModule);
  Object.defineProperty(Platform, "OS", { get: () => "ios", configurable: true });
  return require("../src/services/cgm/cgmHealthSource") as typeof import("../src/services/cgm/cgmHealthSource");
}

const realShape = {
  // module.exports = HealthKit — no `default`
  Constants: { Permissions: { BloodGlucose: "BloodGlucose" } },
  isAvailable: (cb: (e: unknown, ok: boolean) => void) => cb(null, true),
  initHealthKit: (_p: unknown, cb: (e: string | null) => void) => cb(null),
  getBloodGlucoseSamples: (_o: unknown, cb: (e: string | null, r: unknown[]) => void) => cb(null, [glucoseSample]),
};

describe("cgmHealthSource on iPhone", () => {
  it("works with react-native-health's CommonJS export (the 2.5 crash)", async () => {
    const { getHealthSource } = loadWith(realShape);
    const source = getHealthSource();
    expect(source?.name).toBe("Apple Health");
    await expect(source!.availability()).resolves.toBe("available");
    await expect(source!.read(0, Date.now())).resolves.toEqual([
      {
        id: "8F2C-UUID",
        value: 131,
        ts: Date.parse(glucoseSample.startDate),
        sourceId: "com.dexcom.G7",
        sourceName: "Dexcom G7",
      },
    ]);
  });

  it("also accepts an ES-module default export", () => {
    const { getHealthSource } = loadWith({ __esModule: true, default: realShape });
    expect(getHealthSource()?.name).toBe("Apple Health");
  });

  it("never throws when the native module is missing — the card just hides", () => {
    const { getHealthSource } = loadWith({ Constants: undefined });
    expect(() => getHealthSource()).not.toThrow();
    expect(getHealthSource()).toBeNull();
  });
});
