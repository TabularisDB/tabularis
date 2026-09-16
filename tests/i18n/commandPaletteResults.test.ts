import { describe, expect, it } from "vitest";

import de from "../../src/i18n/locales/de.json";
import en from "../../src/i18n/locales/en.json";
import es from "../../src/i18n/locales/es.json";
import fr from "../../src/i18n/locales/fr.json";
import itLocale from "../../src/i18n/locales/it.json";
import ja from "../../src/i18n/locales/ja.json";
import ko from "../../src/i18n/locales/ko.json";
import ptBR from "../../src/i18n/locales/pt-BR.json";
import ru from "../../src/i18n/locales/ru.json";
import tl from "../../src/i18n/locales/tl.json";
import zh from "../../src/i18n/locales/zh.json";

const locales = {
  de,
  en,
  es,
  fr,
  it: itLocale,
  ja,
  ko,
  "pt-BR": ptBR,
  ru,
  tl,
  zh,
};

describe("command palette result translations", () => {
  it("defines every result command label in every locale", () => {
    for (const [locale, translation] of Object.entries(locales)) {
      expect(
        translation.dataGrid.copyColumnValuesIn,
        `${locale} dataGrid.copyColumnValuesIn`,
      ).toBeTruthy();
      expect(
        translation.editor.multiResult.results,
        `${locale} editor.multiResult.results`,
      ).toBeTruthy();
    }
  });
});
