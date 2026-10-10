import { describe, it, expect } from "vitest";
import { toRegistryLocale } from "../../src/i18n/registryLocale";

describe("registryLocale", () => {
  describe("toRegistryLocale", () => {
    it("passes registry-supported languages through", () => {
      expect(toRegistryLocale("en")).toBe("en");
      expect(toRegistryLocale("it")).toBe("it");
      expect(toRegistryLocale("de")).toBe("de");
      expect(toRegistryLocale("es")).toBe("es");
      expect(toRegistryLocale("fr")).toBe("fr");
    });

    it("maps Chinese variants to zh-CN", () => {
      expect(toRegistryLocale("zh")).toBe("zh-CN");
      expect(toRegistryLocale("zh-CN")).toBe("zh-CN");
      expect(toRegistryLocale("zh-TW")).toBe("zh-CN");
    });

    it("maps regional variants to their base language", () => {
      expect(toRegistryLocale("it-CH")).toBe("it");
      expect(toRegistryLocale("de-AT")).toBe("de");
    });

    it("is case-insensitive", () => {
      expect(toRegistryLocale("IT")).toBe("it");
      expect(toRegistryLocale("ZH-cn")).toBe("zh-CN");
    });

    it("falls back to English for unsupported languages", () => {
      expect(toRegistryLocale("ja")).toBe("en");
      expect(toRegistryLocale("ru")).toBe("en");
      expect(toRegistryLocale("ko")).toBe("en");
      expect(toRegistryLocale("tl")).toBe("en");
      expect(toRegistryLocale("pt-BR")).toBe("en");
    });

    it("falls back to English when the language is missing", () => {
      expect(toRegistryLocale(undefined)).toBe("en");
      expect(toRegistryLocale("")).toBe("en");
    });
  });
});
