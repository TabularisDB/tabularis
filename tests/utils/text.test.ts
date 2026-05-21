import { describe, it, expect } from "vitest";
import {
  LONG_TEXT_THRESHOLD,
  formatTextForEditor,
  isLongTextCellTarget,
  isLongTextValue,
  isTextColumn,
} from "../../src/utils/text";

describe("text", () => {
  describe("isTextColumn", () => {
    it("matches common text aliases case-insensitively", () => {
      expect(isTextColumn("TEXT")).toBe(true);
      expect(isTextColumn("text")).toBe(true);
      expect(isTextColumn("LongText")).toBe(true);
      expect(isTextColumn("MEDIUMTEXT")).toBe(true);
      expect(isTextColumn("TINYTEXT")).toBe(true);
      expect(isTextColumn("NTEXT")).toBe(true);
      expect(isTextColumn("CLOB")).toBe(true);
      expect(isTextColumn("STRING")).toBe(true);
    });

    it("matches parameterised varchar / character varying", () => {
      expect(isTextColumn("VARCHAR(255)")).toBe(true);
      expect(isTextColumn("varchar(50)")).toBe(true);
      expect(isTextColumn("character varying(100)")).toBe(true);
      expect(isTextColumn("NVARCHAR(MAX)")).toBe(true);
      expect(isTextColumn("CHAR(36)")).toBe(true);
      expect(isTextColumn("NCHAR(10)")).toBe(true);
    });

    it("returns false for non-text types", () => {
      expect(isTextColumn("INTEGER")).toBe(false);
      expect(isTextColumn("BIGINT")).toBe(false);
      expect(isTextColumn("BOOLEAN")).toBe(false);
      expect(isTextColumn("JSON")).toBe(false);
      expect(isTextColumn("JSONB")).toBe(false);
      expect(isTextColumn("BLOB")).toBe(false);
      expect(isTextColumn("BYTEA")).toBe(false);
      expect(isTextColumn("DATE")).toBe(false);
      expect(isTextColumn("TIMESTAMP")).toBe(false);
    });

    it("returns false for missing or empty type", () => {
      expect(isTextColumn(undefined)).toBe(false);
      expect(isTextColumn("")).toBe(false);
    });
  });

  describe("isLongTextValue", () => {
    it("returns false for non-string values", () => {
      expect(isLongTextValue(null)).toBe(false);
      expect(isLongTextValue(undefined)).toBe(false);
      expect(isLongTextValue(123)).toBe(false);
      expect(isLongTextValue(true)).toBe(false);
      expect(isLongTextValue(["a"])) .toBe(false);
      expect(isLongTextValue({ a: 1 })).toBe(false);
    });

    it("returns false for short single-line strings", () => {
      expect(isLongTextValue("")).toBe(false);
      expect(isLongTextValue("hello")).toBe(false);
      expect(isLongTextValue("a".repeat(LONG_TEXT_THRESHOLD))).toBe(false);
    });

    it("returns true for strings beyond the threshold", () => {
      expect(isLongTextValue("a".repeat(LONG_TEXT_THRESHOLD + 1))).toBe(true);
    });

    it("returns true for strings containing a newline regardless of length", () => {
      expect(isLongTextValue("a\nb")).toBe(true);
      expect(isLongTextValue("line1\nline2")).toBe(true);
    });
  });

  describe("isLongTextCellTarget", () => {
    it("requires both a text column AND a long value", () => {
      expect(isLongTextCellTarget("TEXT", "short")).toBe(false);
      expect(
        isLongTextCellTarget("TEXT", "a".repeat(LONG_TEXT_THRESHOLD + 1)),
      ).toBe(true);
      expect(isLongTextCellTarget("VARCHAR(255)", "line1\nline2")).toBe(true);
    });

    it("returns false for non-text columns even with long values", () => {
      expect(
        isLongTextCellTarget("INTEGER", "a".repeat(LONG_TEXT_THRESHOLD + 1)),
      ).toBe(false);
      expect(isLongTextCellTarget("JSON", "very long string\nwith newlines")).toBe(
        false,
      );
      expect(isLongTextCellTarget("BLOB", "x".repeat(200))).toBe(false);
    });

    it("returns false when the column type is missing", () => {
      expect(isLongTextCellTarget(undefined, "x".repeat(200))).toBe(false);
    });

    it("returns false for null / non-string values regardless of column", () => {
      expect(isLongTextCellTarget("TEXT", null)).toBe(false);
      expect(isLongTextCellTarget("TEXT", undefined)).toBe(false);
      expect(isLongTextCellTarget("TEXT", 12345)).toBe(false);
    });
  });

  describe("formatTextForEditor", () => {
    it("returns empty string for null and undefined", () => {
      expect(formatTextForEditor(null)).toBe("");
      expect(formatTextForEditor(undefined)).toBe("");
    });

    it("returns strings unchanged", () => {
      expect(formatTextForEditor("hello")).toBe("hello");
      expect(formatTextForEditor("line1\nline2")).toBe("line1\nline2");
    });

    it("stringifies primitives", () => {
      expect(formatTextForEditor(42)).toBe("42");
      expect(formatTextForEditor(true)).toBe("true");
    });
  });
});
