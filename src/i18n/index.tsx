// src/i18n/index.tsx
// The app's languages (2026-10-28): English (default), Spanish, Haitian Creole.
//
// Which language: the patient's own choice in the app (Profile → Language,
// or the link on the sign-in screen) when she made one, else the phone's
// language, else English. Haitian Creole is rarely a phone language (iPhone
// only since iOS 26.4; Android not at all), so the in-app choice is what
// reaches most Creole speakers.
//
// Text lives in locales/<lang>/<namespace>.ts under dotted keys
// ("capture.findScale"). English is the source; the Spanish and Creole
// files are typed against it, so a missing or extra key fails the build.
// Only what the patient READS is translated: values that are saved, synced
// to the EMR or compared in code (urine results, glucose timing codes,
// reason codes) stay as they are and are shown through a label.
//
// No database import here, so the logic modules that use t() stay testable;
// App.tsx hands the stored choice in (loadLanguageChoice) and registers how
// to save a new one (setLanguageSaver).

import React, { createContext, useContext, useEffect, useState } from "react";
import { I18nManager, Platform, Settings } from "react-native";
import en, { type TKey } from "./locales/en";
import es from "./locales/es";
import ht from "./locales/ht";

export type { TKey };
export type Lang = "en" | "es" | "ht";
export type LangChoice = Lang | "auto";

const DICTS: Record<Lang, Record<TKey, string>> = { en, es, ht };

/** The choices the Language picker offers, each named in its own language. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: "English",
  es: "Español",
  ht: "Kreyòl ayisyen",
};

let choice: LangChoice = "auto";
let current: Lang = deviceLanguage();
const listeners = new Set<() => void>();
const changeListeners = new Set<(lang: Lang) => void>();
let saver: ((choice: LangChoice) => void) | null = null;

function isLang(v: unknown): v is Lang {
  return v === "en" || v === "es" || v === "ht";
}

/**
 * The phone's language: the first of its preferred languages the app has
 * (iPhone keeps an ordered list; Android reports one), else English.
 */
export function deviceLanguage(): Lang {
  const tags: string[] = [];
  try {
    if (Platform.OS === "ios") {
      const list = Settings.get("AppleLanguages");
      if (Array.isArray(list)) tags.push(...list.map(String));
    } else {
      const id = (I18nManager as any).getConstants?.()?.localeIdentifier;
      if (id) tags.push(String(id));
    }
  } catch {
    // fall through to Intl
  }
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // no Intl: English
  }
  for (const tag of tags) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isLang(primary)) return primary;
  }
  return "en";
}

function apply(next: LangChoice) {
  choice = next;
  current = next === "auto" ? deviceLanguage() : next;
  listeners.forEach((fn) => fn());
}

/** The stored choice ("auto" | "en" | "es" | "ht"), read once at startup. */
export function loadLanguageChoice(stored: string | null | undefined) {
  apply(stored === "auto" || isLang(stored) ? stored : "auto");
}

/** How a new choice is saved (App.tsx: app_settings, kept through a data wipe). */
export function setLanguageSaver(fn: (choice: LangChoice) => void) {
  saver = fn;
}

/** The patient picked a language (or "auto" = follow the phone). */
export function setLanguageChoice(next: LangChoice) {
  const before = current;
  saver?.(next);
  apply(next);
  if (current !== before) changeListeners.forEach((fn) => fn(current));
}

/**
 * Runs when the patient changes the language (not at startup) — e.g. to
 * rewrite notifications already scheduled in the old language.
 */
export function onLanguageChange(fn: (lang: Lang) => void): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

export function currentLanguage(): Lang {
  return current;
}

export function currentChoice(): LangChoice {
  return choice;
}

/**
 * The text for a key in the current language ({name} placeholders filled
 * from params). Falls back to English, then to the key itself.
 */
export function t(key: TKey, params?: Record<string, string | number>): string {
  let s: string = DICTS[current][key] ?? en[key] ?? key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
  }
  return s;
}

// ---------------------------------------------------------------------------
// Dates and times in the app's language (not the phone's): a Spanish choice
// on an English phone shows Spanish dates. Haitian Creole uses the French
// (Haiti) calendar names, which is what dates in Haiti are commonly written in.
// ---------------------------------------------------------------------------

export function localeTag(lang: Lang = current): string {
  return lang === "es" ? "es-US" : lang === "ht" ? "fr-HT" : "en-US";
}

export function fmtDate(d: Date | number, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleDateString(localeTag(), opts);
}

export function fmtTime(
  d: Date | number,
  opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }
): string {
  return new Date(d).toLocaleTimeString(localeTag(), opts);
}

export function fmtDateTime(d: Date | number, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleString(localeTag(), opts);
}

// ---------------------------------------------------------------------------
// React: screens call useT() so they draw again when the language changes.
// ---------------------------------------------------------------------------

type LangState = { lang: Lang; choice: LangChoice };
const LanguageContext = createContext<LangState>({ lang: current, choice });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LangState>({ lang: current, choice });
  useEffect(() => {
    const fn = () => setState({ lang: current, choice });
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return <LanguageContext.Provider value={state}>{children}</LanguageContext.Provider>;
}

/**
 * In a component: `const { t, lang } = useT();`. Put `lang` in the deps of any
 * useMemo / useCallback that builds text, so it is rebuilt on a change.
 */
export function useT() {
  const { lang, choice: ch } = useContext(LanguageContext);
  return { t, lang, choice: ch, setLanguageChoice, fmtDate, fmtTime, fmtDateTime };
}
