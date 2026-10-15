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

const locales = { de, en, es, fr, it: itLocale, ja, ko, "pt-BR": ptBR, ru, tl, zh };

// Export Logs writes a file, so its confirmation must not claim a clipboard copy (#907).
const CLIPBOARD =
  /clipboard|zwischenablage|portapapeles|presse-papiers|appunti|クリップボード|클립보드|área de transferência|буфер обмена|剪贴板/i;

describe("Export Logs confirmation", () => {
  it.each(Object.entries(locales))("does not mention the clipboard in %s", (_, translation) => {
    expect(translation.settings.exportLogsSuccess).toBeTruthy();
    expect(translation.settings.exportLogsSuccess).not.toMatch(CLIPBOARD);
  });
});
