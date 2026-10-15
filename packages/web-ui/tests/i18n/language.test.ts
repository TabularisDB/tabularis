import { describe, it, expect } from "vitest";
import { getAiExplanationLanguage } from "../../src/i18n/language";
import { SUPPORTED_LANGUAGES } from "../../src/i18n/config";

describe("language", () => {
  describe("getAiExplanationLanguage", () => {
    it("uses the resolved language in auto mode", () => {
      expect(getAiExplanationLanguage("auto", "it")).toBe("Italiano");
    });

    it("maps supported regional locales in auto mode", () => {
      expect(getAiExplanationLanguage("auto", "pt-BR")).toBe("Português (Brasil)");
      expect(getAiExplanationLanguage("auto", "zh-CN")).toBe("中文");
      expect(getAiExplanationLanguage("auto", "it-CH")).toBe("Italiano");
    });

    it("is case- and separator-insensitive", () => {
      expect(getAiExplanationLanguage("auto", "PT_br")).toBe("Português (Brasil)");
    });

    it("falls back to English for unsupported resolved languages", () => {
      expect(getAiExplanationLanguage("auto", "nl")).toBe("English");
      expect(getAiExplanationLanguage("auto", "sv-SE")).toBe("English");
    });

    it("falls back to English when the resolved language is missing", () => {
      expect(getAiExplanationLanguage("auto")).toBe("English");
      expect(getAiExplanationLanguage("auto", undefined)).toBe("English");
      expect(getAiExplanationLanguage("auto", "")).toBe("English");
    });

    it("keeps explicitly selected languages unchanged", () => {
      for (const { id, label } of SUPPORTED_LANGUAGES) {
        expect(getAiExplanationLanguage(id)).toBe(label);
      }
      expect(getAiExplanationLanguage("it", "de")).toBe("Italiano");
    });
  });
});
