import type { BackendModule } from "i18next";

const locales = {
  it: () => import("./locales/it.json"),
  es: () => import("./locales/es.json"),
  zh: () => import("./locales/zh.json"),
  fr: () => import("./locales/fr.json"),
  de: () => import("./locales/de.json"),
  ja: () => import("./locales/ja.json"),
  ru: () => import("./locales/ru.json"),
  ko: () => import("./locales/ko.json"),
  tl: () => import("./locales/tl.json"),
  "pt-BR": () => import("./locales/pt-BR.json"),
};

/** Bundled language chunks, including the browser's Filipino alias. No CDN. */
export const localeBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    const key = language === "fil" ? "tl" : language;
    const load = Object.hasOwn(locales, key) ? locales[key as keyof typeof locales] : undefined;
    if (!load) {
      callback(null, {});
      return;
    }
    load().then((module) => callback(null, module.default)).catch((error: unknown) => {
      callback(error instanceof Error ? error : new Error(String(error)), false);
    });
  },
};
