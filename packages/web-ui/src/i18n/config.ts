import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { localeBackend } from './localeBackend';

import en from './locales/en.json';

/**
 * Single source of truth for supported languages.
 * Dictionaries are loaded separately by localeBackend when selected.
 */
export const SUPPORTED_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "it", label: "Italiano" },
  { id: "es", label: "Español" },
  { id: "zh", label: "中文" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "ja", label: "日本語" },
  { id: "ru", label: "Русский" },
  { id: "ko", label: "한국어" },
  { id: "tl", label: "Tagalog" },
  { id: "pt-BR", label: "Português (Brasil)" },
] as const;

export type AppLanguage = "auto" | (typeof SUPPORTED_LANGUAGES)[number]["id"];

i18n
  .use(localeBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    fallbackLng: {
      fil: ['tl', 'en'],
      default: ['en'],
    },
    supportedLngs: [...SUPPORTED_LANGUAGES.map((l) => l.id), 'fil'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['querystring', 'cookie', 'localStorage', 'navigator', 'htmlTag', 'path', 'subdomain'],
      caches: ['localStorage', 'cookie'],
    },
  });
