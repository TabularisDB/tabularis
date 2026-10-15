import { describe, it, expect } from "vitest";
import { isLinkString, isColorString } from "../../src/utils/jsonValueDecorators";

describe("jsonValueDecorators", () => {
  describe("isLinkString", () => {
    it("recognizes http and https URLs", () => {
      expect(isLinkString("https://tabularis.dev")).toBe(true);
      expect(isLinkString("http://localhost:3000/api")).toBe(true);
      expect(isLinkString("https://github.com/TabularisDB/tabularis/issues/997")).toBe(true);
      expect(isLinkString("  https://example.com/foo?bar=1#baz  ")).toBe(true);
    });

    it("recognizes mailto links", () => {
      expect(isLinkString("mailto:support@tabularis.dev")).toBe(true);
      expect(isLinkString("mailto:john.doe+tag@example.co.uk")).toBe(true);
    });

    it("rejects non-links", () => {
      expect(isLinkString("hello world")).toBe(false);
      expect(isLinkString("ftp://example.com")).toBe(false);
      expect(isLinkString("javascript:alert(1)")).toBe(false);
      expect(isLinkString("file:///path/to/file")).toBe(false);
      expect(isLinkString("")).toBe(false);
      expect(isLinkString(123)).toBe(false);
      expect(isLinkString(null)).toBe(false);
      expect(isLinkString(undefined)).toBe(false);
    });
  });

  describe("isColorString", () => {
    it("recognizes 3, 4, 6 and 8 digit hex colors", () => {
      expect(isColorString("#fff")).toBe(true);
      expect(isColorString("#FFF")).toBe(true);
      expect(isColorString("#ff0000")).toBe(true);
      expect(isColorString("#1e90ff")).toBe(true);
      expect(isColorString("#1e90ff80")).toBe(true);
      expect(isColorString("#abcd")).toBe(true);
      expect(isColorString("  #1e90ff  ")).toBe(true);
    });

    it("recognizes rgb and rgba colors", () => {
      expect(isColorString("rgb(255, 0, 0)")).toBe(true);
      expect(isColorString("rgba(255, 0, 0, 0.5)")).toBe(true);
      expect(isColorString("rgba(100%, 0%, 0%, 50%)")).toBe(true);
    });

    it("recognizes hsl and hsla colors", () => {
      expect(isColorString("hsl(120, 100%, 50%)")).toBe(true);
      expect(isColorString("hsla(120, 100%, 50%, 0.3)")).toBe(true);
      expect(isColorString("hsl(120deg, 100%, 50%)")).toBe(true);
    });

    it("rejects invalid color formats", () => {
      expect(isColorString("red")).toBe(false);
      expect(isColorString("#12")).toBe(false);
      expect(isColorString("#12345")).toBe(false);
      expect(isColorString("#gggggg")).toBe(false);
      expect(isColorString("not-a-color")).toBe(false);
      expect(isColorString("")).toBe(false);
      expect(isColorString(42)).toBe(false);
    });
  });
});
