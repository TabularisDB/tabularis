import { describe, it, expect } from "vitest";
import {
  resultToCsv,
  resultToJson,
} from "../../src/utils/notebookExport";
import type { QueryResult } from "../../src/types/editor";

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: ["id", "name", "age"],
    rows: [
      [1, "Alice", 30],
      [2, "Bob", 25],
    ],
    affected_rows: 0,
    ...overrides,
  };
}

describe("notebookExport", () => {
  describe("resultToCsv", () => {
    it("should produce header and data rows", () => {
      const csv = resultToCsv(makeResult());
      const lines = csv.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("id,name,age");
      expect(lines[1]).toBe("1,Alice,30");
      expect(lines[2]).toBe("2,Bob,25");
    });

    it("should escape fields containing commas", () => {
      const csv = resultToCsv(
        makeResult({ columns: ["note"], rows: [["hello, world"]] }),
      );
      expect(csv).toBe('note\n"hello, world"');
    });

    it("should escape fields containing double quotes", () => {
      const csv = resultToCsv(
        makeResult({ columns: ["note"], rows: [['say "hi"']] }),
      );
      expect(csv).toBe('note\n"say ""hi"""');
    });

    it("should escape fields containing newlines", () => {
      const csv = resultToCsv(
        makeResult({ columns: ["note"], rows: [["line1\nline2"]] }),
      );
      expect(csv).toBe('note\n"line1\nline2"');
    });

    it("should handle null and undefined values as empty strings", () => {
      const csv = resultToCsv(
        makeResult({ columns: ["a", "b"], rows: [[null, undefined]] }),
      );
      expect(csv).toBe("a,b\n,");
    });

    it("should handle empty result", () => {
      const csv = resultToCsv(
        makeResult({ columns: ["a"], rows: [] }),
      );
      expect(csv).toBe("a");
    });

    it("should handle boolean values", () => {
      const csv = resultToCsv(
        makeResult({ columns: ["active"], rows: [[true], [false]] }),
      );
      expect(csv).toBe("active\ntrue\nfalse");
    });
  });

  describe("resultToJson", () => {
    it("should produce array of objects keyed by column names", () => {
      const json = resultToJson(makeResult());
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ id: 1, name: "Alice", age: 30 });
      expect(parsed[1]).toEqual({ id: 2, name: "Bob", age: 25 });
    });

    it("should handle null values", () => {
      const json = resultToJson(
        makeResult({ columns: ["a"], rows: [[null]] }),
      );
      const parsed = JSON.parse(json);
      expect(parsed[0].a).toBeNull();
    });

    it("should handle empty result", () => {
      const json = resultToJson(
        makeResult({ columns: ["a"], rows: [] }),
      );
      expect(JSON.parse(json)).toEqual([]);
    });

    it("should produce valid indented JSON", () => {
      const json = resultToJson(
        makeResult({ columns: ["x"], rows: [[1]] }),
      );
      expect(json).toContain("\n");
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });
});
