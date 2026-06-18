import i18n, { type ReadCallback } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ChainedBackend from 'i18next-chained-backend';
import HttpBackend from 'i18next-http-backend';
import LocalStorageBackend from 'i18next-localstorage-backend';
import resourcesToBackend from 'i18next-resources-to-backend';

import en from './locales/en.json';
import it from './locales/it.json';
import es from './locales/es.json';
import zh from './locales/zh.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ja from './locales/ja.json';
import ru from './locales/ru.json';

/**
 * Single source of truth for supported languages.
 * To add a new language: import the locale above, then add an entry here.
 */
export const SUPPORTED_LANGUAGES = [
  { id: "en", label: "English", translation: en },
  { id: "it", label: "Italiano", translation: it },
  { id: "es", label: "Español", translation: es },
  { id: "zh", label: "中文", translation: zh },
  { id: "fr", label: "Français", translation: fr },
  { id: "de", label: "Deutsch", translation: de },
  { id: "ja", label: "日本語", translation: ja },
  { id: "ru", label: "Русский", translation: ru },
] as const;

export type AppLanguage = "auto" | (typeof SUPPORTED_LANGUAGES)[number]["id"];

// Tolgee Content Delivery (public CDN) — serves <base>/<lng>.json
const TOLGEE_CDN_BASE = "https://cdn.tolg.ee/04ebb496deb39eaaf4703e8565ff6e62";

const bundledResources: Record<string, (typeof SUPPORTED_LANGUAGES)[number]["translation"]> =
  Object.fromEntries(SUPPORTED_LANGUAGES.map(({ id, translation }) => [id, translation]));

export const OTA_ENABLED_KEY = "tabularis.i18n.otaEnabled";
export const OTA_INTERVAL_MIN_KEY = "tabularis.i18n.otaIntervalMinutes";
const DEFAULT_OTA_INTERVAL_MIN = 15;

function readOtaEnabled(): boolean {
  try {
    return localStorage.getItem(OTA_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

function readOtaIntervalMs(): number {
  try {
    const raw = Number(localStorage.getItem(OTA_INTERVAL_MIN_KEY));
    const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OTA_INTERVAL_MIN;
    return minutes * 60 * 1000;
  } catch {
    return DEFAULT_OTA_INTERVAL_MIN * 60 * 1000;
  }
}

function bundledLoader(
  language: string,
  _namespace: string,
  callback: ReadCallback,
): void {
  const resources = bundledResources[language];
  if (resources) callback(null, resources);
  else callback(new Error(`no bundled translations for "${language}"`), null);
}

const otaEnabled = readOtaEnabled();

// Backend precedence (first to resolve wins; CDN results are cached back into localStorage):
// localStorage cache -> Tolgee CDN -> bundled JSON. CDN thus overrides the bundle when reachable.
const backends = otaEnabled
  ? [LocalStorageBackend, HttpBackend, resourcesToBackend(bundledLoader)]
  : [resourcesToBackend(bundledLoader)];
const backendOptions = otaEnabled
  ? [
      { expirationTime: readOtaIntervalMs(), defaultVersion: "v1" },
      { loadPath: `${TOLGEE_CDN_BASE}/{{lng}}.json` },
      {},
    ]
  : [{}];

i18n
  .use(LanguageDetector)
  .use(ChainedBackend)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map(({ id }) => id),
    load: "languageOnly", // "de-DE" -> "de": the CDN only has "de.json"
    nonExplicitSupportedLngs: true,
    returnEmptyString: false, // empty translation -> fall back to en, not blank
    interpolation: {
      escapeValue: false,
    },
    backend: {
      backends,
      backendOptions,
    },
    detection: {
      order: ['querystring', 'cookie', 'localStorage', 'navigator', 'htmlTag', 'path', 'subdomain'],
      caches: ['localStorage', 'cookie'],
    },
    react: {
      useSuspense: false,
    },
  });

export async function refreshTranslationsFromCdn(): Promise<void> {
  if (!otaEnabled) return;
  try {
    localStorage.removeItem(`i18next_res_${i18n.language}-translation`);
  } catch {
    /* ignore */
  }
  await i18n.reloadResources();
}

export default i18n;
