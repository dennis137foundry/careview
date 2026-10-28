import en from "../src/i18n/locales/en";
import es from "../src/i18n/locales/es";
import ht from "../src/i18n/locales/ht";
import * as factsEn from "../src/constants/pregnancyFacts";
import * as factsEs from "../src/constants/pregnancyFacts.es";
import * as factsHt from "../src/constants/pregnancyFacts.ht";
import { currentLanguage, loadLanguageChoice, setLanguageChoice, setLanguageSaver, t } from "../src/i18n";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join(",");

describe.each([
  ["Spanish", es],
  ["Haitian Creole", ht],
])("%s text", (_name, dict) => {
  const keys = Object.keys(en) as (keyof typeof en)[];

  it("has exactly the English keys", () => {
    expect(Object.keys(dict).sort()).toEqual([...keys].sort());
  });

  it("keeps every {placeholder} of the English", () => {
    const wrong = keys.filter((k) => placeholders(dict[k]) !== placeholders(en[k]));
    expect(wrong).toEqual([]);
  });

  it("has no blank text", () => {
    expect(keys.filter((k) => !dict[k] || !dict[k].trim())).toEqual([]);
  });
});

describe("daily pregnancy facts", () => {
  it.each([
    ["Spanish", factsEs],
    ["Haitian Creole", factsHt],
  ])("%s has one fact per English day", (_name, f) => {
    expect(f.dayFacts.length).toBe(factsEn.dayFacts.length);
    expect(f.postpartumFacts.length).toBe(factsEn.postpartumFacts.length);
    expect([...f.dayFacts, ...f.postpartumFacts].filter((s) => !s || !s.trim())).toEqual([]);
  });
});

describe("t()", () => {
  afterEach(() => loadLanguageChoice("en"));

  it("follows the chosen language and saves the choice", () => {
    const saved: string[] = [];
    setLanguageSaver((c) => saved.push(c));
    setLanguageChoice("es");
    expect(currentLanguage()).toBe("es");
    expect(t("common.cancel")).toBe(es["common.cancel"]);
    setLanguageChoice("ht");
    expect(t("common.cancel")).toBe(ht["common.cancel"]);
    expect(saved).toEqual(["es", "ht"]);
  });

  it("fills placeholders", () => {
    loadLanguageChoice("en");
    expect(t("language.autoDetail", { language: "Español" })).toBe("Currently Español");
  });

  it("treats an unknown stored value as following the phone", () => {
    loadLanguageChoice("fr");
    expect(["en", "es", "ht"]).toContain(currentLanguage());
  });
});
