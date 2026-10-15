import { describe, it, expect } from "vitest";
import { safeParse, isJsonColumn } from "../../src/utils/jsonTree";

describe("jsonTree", () => {
  describe("safeParse", () => {
    it("parses a valid JSON object", () => {
      const result = safeParse('{"a":1,"b":[2,3]}');
      expect(result.error).toBeUndefined();
      expect(result.value).toEqual({ a: 1, b: [2, 3] });
    });

    it("parses a valid JSON array", () => {
      const result = safeParse("[1,2,3]");
      expect(result.error).toBeUndefined();
      expect(result.value).toEqual([1, 2, 3]);
    });

    it("parses a valid JSON primitive", () => {
      const result = safeParse("42");
      expect(result.error).toBeUndefined();
      expect(result.value).toBe(42);
    });

    it("parses null literal", () => {
      const result = safeParse("null");
      expect(result.error).toBeUndefined();
      expect(result.value).toBeNull();
    });

    it("returns null value with no error for empty input", () => {
      const result = safeParse("");
      expect(result.error).toBeUndefined();
      expect(result.value).toBeNull();
    });

    it("returns null value with no error for whitespace-only input", () => {
      const result = safeParse("   \n\t  ");
      expect(result.error).toBeUndefined();
      expect(result.value).toBeNull();
    });

    it("returns an error message for invalid JSON", () => {
      const result = safeParse("{not valid json");
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.value).toBeNull();
    });

    it("returns an error message for trailing garbage", () => {
      const result = safeParse('{"a":1} extra');
      expect(result.error).toBeDefined();
      expect(result.value).toBeNull();
    });
  });

  describe("isJsonColumn", () => {
    it("matches lowercase json", () => {
      expect(isJsonColumn("json")).toBe(true);
    });

    it("matches lowercase jsonb", () => {
      expect(isJsonColumn("jsonb")).toBe(true);
    });

    it("matches uppercase JSON", () => {
      expect(isJsonColumn("JSON")).toBe(true);
    });

    it("matches uppercase JSONB", () => {
      expect(isJsonColumn("JSONB")).toBe(true);
    });

    it("matches mixed case", () => {
      expect(isJsonColumn("JsonB")).toBe(true);
    });

    it("returns false for unrelated types", () => {
      expect(isJsonColumn("text")).toBe(false);
      expect(isJsonColumn("varchar")).toBe(false);
      expect(isJsonColumn("integer")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isJsonColumn("")).toBe(false);
    });
  });
});
