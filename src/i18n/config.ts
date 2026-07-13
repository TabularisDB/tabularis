import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import it from './locales/it.json';
import es from './locales/es.json';
import zh from './locales/zh.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ja from './locales/ja.json';
import ru from './locales/ru.json';
import tl from './locales/tl.json';

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
  { id: "tl", label: "Tagalog", translation: tl },
] as const;

export type AppLanguage = "auto" | (typeof SUPPORTED_LANGUAGES)[number]["id"];

const resources = {
  ...Object.fromEntries(
    SUPPORTED_LANGUAGES.map(({ id, translation }) => [id, { translation }]),
  ),
  // Browser auto-detection often reports fil / fil-PH
  fil: { translation: tl },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: {
      fil: ['tl', 'en'],
      default: ['en'],
    },
    supportedLngs: [...SUPPORTED_LANGUAGES.map((l) => l.id), 'fil'],
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['querystring', 'cookie', 'localStorage', 'navigator', 'htmlTag', 'path', 'subdomain'],
      caches: ['localStorage', 'cookie'],
    },
  });
