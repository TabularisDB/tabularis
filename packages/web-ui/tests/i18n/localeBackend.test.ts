import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import { localeBackend } from "../../src/i18n/localeBackend";
import en from "../../src/i18n/locales/en.json";
import itLocale from "../../src/i18n/locales/it.json";
import tl from "../../src/i18n/locales/tl.json";
import ptBR from "../../src/i18n/locales/pt-BR.json";

describe("bundled locale backend", () => {
  it("loads selected languages and Filipino aliases while retaining English fallback", async () => {
    const i18n = createInstance();
    await i18n.use(localeBackend).init({
      lng: "en", fallbackLng: "en", resources: { en: { translation: en } }, partialBundledLanguages: true,
    });
    expect(i18n.hasResourceBundle("it", "translation")).toBe(false);
    for (const [language, dictionary] of [["it", itLocale], ["fil", tl], ["pt-BR", ptBR]] as const) {
      await i18n.changeLanguage(language);
      expect(i18n.t("common.cancel")).toBe(dictionary.common.cancel);
    }
    await i18n.changeLanguage("unknown");
    expect(i18n.t("common.cancel")).toBe(en.common.cancel);
  });
});
