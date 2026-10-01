/**
 * iPhone health source: our own CgmBackground native module (HealthKit).
 * History: 2.5 build 15 crashed on the Devices screen (react-native-health read
 * as `.default`); build 16 showed no Dexcom card (that library never answered
 * under the new architecture). Both libraries' problems are gone; these load
 * cgmHealthSource against the native module's real method shapes.
 */
import { NativeModules, Platform } from "react-native";

const sample = {
  id: "8F2C-UUID",
  value: 131,
  ts: 1790877900000,
  sourceId: "com.dexcom.G7",
  sourceName: "Dexcom G7",
};

function loadWith(nativeModule: unknown) {
  jest.resetModules();
  Object.defineProperty(Platform, "OS", { get: () => "ios", configurable: true });
  (NativeModules as any).CgmBackground = nativeModule;
  return require("../src/services/cgm/cgmHealthSource") as typeof import("../src/services/cgm/cgmHealthSource");
}

const native = {
  isAvailable: jest.fn(async () => true),
  requestAccess: jest.fn(async () => true),
  readGlucose: jest.fn(async (_s: number, _e: number) => [sample]),
  enable: jest.fn(),
  disable: jest.fn(),
  finished: jest.fn(),
};

describe("cgmHealthSource on iPhone (CgmBackground native module)", () => {
  it("reports Apple Health available, asks for access and reads samples as returned", async () => {
    const { getHealthSource } = loadWith(native);
    const source = getHealthSource();
    expect(source?.name).toBe("Apple Health");
    await expect(source!.availability()).resolves.toBe("available");
    await expect(source!.requestAccess()).resolves.toBe(true);
    await expect(source!.read(1000, 2000)).resolves.toEqual([sample]);
    expect(native.readGlucose).toHaveBeenCalledWith(1000, 2000);
  });

  it("says unsupported where HealthKit is not available (most iPads)", async () => {
    const { getHealthSource } = loadWith({ ...native, isAvailable: async () => false });
    await expect(getHealthSource()!.availability()).resolves.toBe("unsupported");
  });

  it("never throws when the native module is missing; the card shows the reason", () => {
    const { getHealthSource, healthSourceProblem } = loadWith(undefined);
    expect(() => getHealthSource()).not.toThrow();
    expect(getHealthSource()).toBeNull();
    expect(healthSourceProblem()).toMatch(/not found in this build/);
  });
});
