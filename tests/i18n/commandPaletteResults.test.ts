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

const assertTranslation = (
  locale: string,
  key: string,
  value: unknown,
  englishValue: string,
) => {
  expect(typeof value, `${locale} ${key}`).toBe("string");
  expect((value as string).trim(), `${locale} ${key}`).not.toBe("");
  if (locale !== "en") {
    expect(value, `${locale} ${key} uses the English fallback`).not.toBe(
      englishValue,
    );
  }
};

describe("command palette result translations", () => {
  it("defines every result command label in every locale", () => {
    for (const [locale, translation] of Object.entries(locales)) {
      const resultLabels = {
        "dataGrid.copyCells": translation.dataGrid.copyCells,
        "dataGrid.copyRows": translation.dataGrid.copyRows,
        "dataGrid.copySelectedColumns":
          translation.dataGrid.copySelectedColumns,
        "dataGrid.copyColumnValuesIn":
          translation.dataGrid.copyColumnValuesIn,
        "dataGrid.copyAll": translation.dataGrid.copyAll,
        "dataGrid.copyAllRows": translation.dataGrid.copyAllRows,
        "editor.multiResult.results": translation.editor.multiResult.results,
      };

      for (const [key, value] of Object.entries(resultLabels)) {
        const [section, ...path] = key.split(".");
        const englishValue = path.reduce<unknown>(
          (current, segment) =>
            (current as Record<string, unknown>)[segment],
          en[section as keyof typeof en],
        );
        assertTranslation(locale, key, value, englishValue as string);
      }
    }
  });

});
