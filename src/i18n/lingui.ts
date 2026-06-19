import { i18n } from "@lingui/core";
import type { useLingui } from "@lingui/react/macro";

export { i18n };

/** The `t` macro function returned by `useLingui()` (tagged template + descriptor). */
export type LinguiT = ReturnType<typeof useLingui>["t"];

export const SUPPORTED_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "it", label: "Italiano" },
  { id: "es", label: "Español" },
  { id: "zh", label: "中文" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "ja", label: "日本語" },
  { id: "ru", label: "Русский" },
] as const;

export type AppLanguage = "auto" | (typeof SUPPORTED_LANGUAGES)[number]["id"];

const STORAGE_KEY = "tabularis.language";

/** Persisted choice, else the browser language, else English. */
export function detectLocale(): string {
  const saved = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  const cand = saved ?? navigator.language.split("-")[0];
  return SUPPORTED_LANGUAGES.some((l) => l.id === cand) ? cand : "en";
}

export async function dynamicActivate(locale: string): Promise<void> {
  const { messages } = await import(`../locales/${locale}/messages.ts`);
  i18n.load(locale, messages);
  i18n.activate(locale);
}
