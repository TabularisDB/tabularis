import { describe, expect, it } from "vitest";
import de from "../../src/i18n/locales/de.json";
import en from "../../src/i18n/locales/en.json";
import es from "../../src/i18n/locales/es.json";
import fr from "../../src/i18n/locales/fr.json";
import itLocale from "../../src/i18n/locales/it.json";
import ja from "../../src/i18n/locales/ja.json";
import ko from "../../src/i18n/locales/ko.json";
import ru from "../../src/i18n/locales/ru.json";
import tl from "../../src/i18n/locales/tl.json";
import zh from "../../src/i18n/locales/zh.json";

const locales = { de, en, es, fr, it: itLocale, ja, ko, ru, tl, zh };

describe("SQLite database creation translations", () => {
  it("defines every required string in each supported locale", () => {
    for (const translation of Object.values(locales)) {
      expect(translation.connections.newSqliteDatabase.menuLabel).toBeTruthy();
      expect(translation.connections.newSqliteDatabase.dialogTitle).toBeTruthy();
      expect(translation.connections.newSqliteDatabase.fileType).toBeTruthy();
      expect(translation.connections.newSqliteDatabase.error).toBeTruthy();
    }
  });
});
