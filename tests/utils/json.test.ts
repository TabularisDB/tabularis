import { describe, it, expect } from "vitest";
import {
  isJsonColumn,
  isJsonContent,
  formatJsonForEditor,
  validateJson,
  parseJsonEditorValue,
} from "../../src/utils/json";

describe("json", () => {
  describe("isJsonColumn", () => {
    it("matches JSON (uppercase)", () => {
      expect(isJsonColumn("JSON")).toBe(true);
    });

    it("matches JSONB (uppercase)", () => {
      expect(isJsonColumn("JSONB")).toBe(true);
    });

    it("matches lowercase variants", () => {
      expect(isJsonColumn("json")).toBe(true);
      expect(isJsonColumn("jsonb")).toBe(true);
    });

    it("matches mixed-case variants", () => {
      expect(isJsonColumn("JsonB")).toBe(true);
      expect(isJsonColumn("Json")).toBe(true);
    });

    it("returns false for non-JSON types", () => {
      expect(isJsonColumn("TEXT")).toBe(false);
      expect(isJsonColumn("VARCHAR")).toBe(false);
      expect(isJsonColumn("INTEGER")).toBe(false);
    });

    it("returns false for empty input", () => {
      expect(isJsonColumn("")).toBe(false);
    });
  });

  describe("formatJsonForEditor", () => {
    it("returns empty string for null", () => {
      expect(formatJsonForEditor(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(formatJsonForEditor(undefined)).toBe("");
    });

    it("pretty-prints object values", () => {
      const result = formatJsonForEditor({ a: 1, b: 2 });
      expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
    });

    it("pretty-prints array values", () => {
      const result = formatJsonForEditor([1, 2, 3]);
      expect(result).toBe("[\n  1,\n  2,\n  3\n]");
    });

    it("pretty-prints a JSON string by re-parsing", () => {
      const result = formatJsonForEditor('{"a":1}');
      expect(result).toBe('{\n  "a": 1\n}');
    });

    it("returns plain strings as-is when not valid JSON", () => {
      expect(formatJsonForEditor("hello world")).toBe("hello world");
    });

    it("returns numeric primitives as strings", () => {
      expect(formatJsonForEditor(42)).toBe("42");
      expect(formatJsonForEditor(3.14)).toBe("3.14");
    });

    it("returns boolean primitives as strings", () => {
      expect(formatJsonForEditor(true)).toBe("true");
      expect(formatJsonForEditor(false)).toBe("false");
    });
  });

  describe("validateJson", () => {
    it("returns null for valid JSON object", () => {
      expect(validateJson('{"a":1}')).toBeNull();
    });

    it("returns null for valid JSON array", () => {
      expect(validateJson("[1,2,3]")).toBeNull();
    });

    it("returns null for valid JSON primitives", () => {
      expect(validateJson("42")).toBeNull();
      expect(validateJson('"hello"')).toBeNull();
      expect(validateJson("true")).toBeNull();
      expect(validateJson("null")).toBeNull();
    });

    it("returns null for empty/whitespace input", () => {
      expect(validateJson("")).toBeNull();
      expect(validateJson("   ")).toBeNull();
      expect(validateJson("\n\t  ")).toBeNull();
    });

    it("returns an error message for invalid JSON", () => {
      const err = validateJson("{not valid");
      expect(err).not.toBeNull();
      expect(typeof err).toBe("string");
    });

    it("returns an error message for trailing garbage", () => {
      const err = validateJson('{"a":1} extra');
      expect(err).not.toBeNull();
    });
  });

  describe("parseJsonEditorValue", () => {
    it("parses a valid JSON object", () => {
      expect(parseJsonEditorValue('{"a":1}')).toEqual({ a: 1 });
    });

    it("parses a valid JSON array", () => {
      expect(parseJsonEditorValue("[1,2,3]")).toEqual([1, 2, 3]);
    });

    it("parses primitives", () => {
      expect(parseJsonEditorValue("42")).toBe(42);
      expect(parseJsonEditorValue("true")).toBe(true);
      expect(parseJsonEditorValue('"hello"')).toBe("hello");
    });

    it("returns null for empty input", () => {
      expect(parseJsonEditorValue("")).toBeNull();
      expect(parseJsonEditorValue("   ")).toBeNull();
    });

    it("parses null literal", () => {
      expect(parseJsonEditorValue("null")).toBeNull();
    });

    it("returns raw text when parsing fails", () => {
      expect(parseJsonEditorValue("not valid json")).toBe("not valid json");
    });
  });

  describe("formatJsonForEditor -> parseJsonEditorValue round-trip", () => {
    it("preserves a nested object structure", () => {
      const original = {
        user: { id: 1, name: "Alice", roles: ["admin", "editor"] },
        meta: { active: true, score: 99.5 },
      };
      const text = formatJsonForEditor(original);
      expect(parseJsonEditorValue(text)).toEqual(original);
    });

    it("preserves an array of mixed types", () => {
      const original = [
        1,
        "two",
        true,
        null,
        { nested: "object" },
        [10, 20, 30],
        false,
        3.14,
      ];
      const text = formatJsonForEditor(original);
      expect(parseJsonEditorValue(text)).toEqual(original);
    });

    it("preserves deeply nested structures with nulls", () => {
      const original = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: null,
                neighbours: [null, { a: null }, [null, null]],
              },
            },
            optional: null,
          },
          list: [{ id: 1, parent: null }, { id: 2, parent: null }],
        },
      };
      const text = formatJsonForEditor(original);
      expect(parseJsonEditorValue(text)).toEqual(original);
    });

    it("preserves an empty object", () => {
      const text = formatJsonForEditor({});
      expect(parseJsonEditorValue(text)).toEqual({});
    });

    it("preserves an empty array", () => {
      const text = formatJsonForEditor([]);
      expect(parseJsonEditorValue(text)).toEqual([]);
    });

    it("preserves objects containing arrays of objects with null fields", () => {
      const original = {
        items: [
          { id: 1, label: "a", parent_id: null },
          { id: 2, label: "b", parent_id: 1 },
          { id: 3, label: null, parent_id: null },
        ],
      };
      const text = formatJsonForEditor(original);
      expect(parseJsonEditorValue(text)).toEqual(original);
    });

    it("preserves a JSON string value via re-parse and serialise", () => {
      const stored = '{"a":1,"b":[2,3]}';
      const text = formatJsonForEditor(stored);
      expect(parseJsonEditorValue(text)).toEqual({ a: 1, b: [2, 3] });
    });

    it("treats null and undefined inputs as empty string round-tripping to null", () => {
      expect(parseJsonEditorValue(formatJsonForEditor(null))).toBeNull();
      expect(parseJsonEditorValue(formatJsonForEditor(undefined))).toBeNull();
    });

    it("preserves unicode and special characters in strings", () => {
      const original = {
        name: "héllo wörld",
        emoji: "🚀✨",
        quote: 'He said "hi"',
        newline: "line1\nline2",
        tab: "col1\tcol2",
      };
      const text = formatJsonForEditor(original);
      expect(parseJsonEditorValue(text)).toEqual(original);
    });
  });

  describe("isJsonContent", () => {
    it("returns true for a JSON object string", () => {
      expect(isJsonContent('{"a":1}')).toBe(true);
    });

    it("returns true for a JSON array string", () => {
      expect(isJsonContent("[1,2,3]")).toBe(true);
    });

    it("returns true for nested object with whitespace prefix", () => {
      expect(isJsonContent('   {"a":{"b":2}}   ')).toBe(true);
    });

    it("returns false for plain text", () => {
      expect(isJsonContent("hello world")).toBe(false);
    });

    it("returns false for a JSON scalar string (no object/array brace)", () => {
      expect(isJsonContent('"42"')).toBe(false);
      expect(isJsonContent("42")).toBe(false);
      expect(isJsonContent("true")).toBe(false);
      expect(isJsonContent("null")).toBe(false);
    });

    it("returns false for malformed JSON starting with {", () => {
      expect(isJsonContent("{broken")).toBe(false);
    });

    it("returns false for empty string and whitespace-only", () => {
      expect(isJsonContent("")).toBe(false);
      expect(isJsonContent("   ")).toBe(false);
    });

    it("returns false for non-string types", () => {
      expect(isJsonContent(null)).toBe(false);
      expect(isJsonContent(undefined)).toBe(false);
      expect(isJsonContent(42)).toBe(false);
      expect(isJsonContent({ a: 1 })).toBe(false);
      expect(isJsonContent([1, 2])).toBe(false);
      expect(isJsonContent(true)).toBe(false);
    });
  });
});
