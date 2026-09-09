import { describe, it, expect } from "vitest";
import {
  extractCellReferences,
  hasCellReferences,
  resolveQueryVariables,
  findUnresolvedDependencies,
} from "../../src/utils/notebookVariables";
import type { NotebookCell } from "../../src/types/notebook";

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
  return {
    id: overrides.id ?? "cell-1",
    type: overrides.type ?? "sql",
    content: overrides.content ?? "",
    result: null,
    error: undefined,
    executionTime: null,
    isLoading: false,
    ...overrides,
  };
}

describe("notebookVariables", () => {
  describe("extractCellReferences", () => {
    it("should extract single cell reference", () => {
      const refs = extractCellReferences("SELECT * FROM {{cell_1}}");
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual({ match: "{{cell_1}}", cellIndex: 0 });
    });

    it("should extract multiple cell references", () => {
      const refs = extractCellReferences(
        "SELECT * FROM {{cell_1}} JOIN {{cell_3}}",
      );
      expect(refs).toHaveLength(2);
      expect(refs[0].cellIndex).toBe(0);
      expect(refs[1].cellIndex).toBe(2);
    });

    it("should return empty array for no references", () => {
      expect(extractCellReferences("SELECT 1")).toEqual([]);
    });

    it("should handle double-digit cell numbers", () => {
      const refs = extractCellReferences("SELECT * FROM {{cell_12}}");
      expect(refs[0].cellIndex).toBe(11);
    });
  });

  describe("hasCellReferences", () => {
    it("should return true when references exist", () => {
      expect(hasCellReferences("SELECT * FROM {{cell_1}}")).toBe(true);
    });

    it("should return false when no references", () => {
      expect(hasCellReferences("SELECT 1")).toBe(false);
    });

    it("should stay consistent across repeated and interleaved calls", () => {
      for (let i = 0; i < 3; i++) {
        expect(hasCellReferences("SELECT * FROM {{cell_1}}")).toBe(true);
        expect(hasCellReferences("SELECT * FROM {{cell_1}}")).toBe(true);
        expect(hasCellReferences("SELECT 1")).toBe(false);
        expect(hasCellReferences("SELECT * FROM {{cell_02}}")).toBe(true);
        expect(hasCellReferences("")).toBe(false);
        expect(hasCellReferences("SELECT * FROM {{cell_1}}")).toBe(true);
      }
    });
  });

  describe("resolveQueryVariables", () => {
    it("should return original SQL when no references", () => {
      const cells = [makeCell()];
      const result = resolveQueryVariables("SELECT 1", cells);
      expect(result.sql).toBe("SELECT 1");
      expect(result.unresolvedRefs).toEqual([]);
    });

    it("should resolve a reference to a cell with results", () => {
      const cells = [
        makeCell({
          id: "c1",
          type: "sql",
          content: "SELECT 1",
          result: { columns: ["id", "name"], rows: [[1, "Alice"]], affected_rows: 0 },
        }),
      ];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result.sql).toContain("WITH cell_1 AS");
      expect(result.sql).toContain("SELECT * FROM cell_1");
      expect(result.unresolvedRefs).toEqual([]);
    });

    it("should mark unresolved refs when cell has no result", () => {
      const cells = [makeCell({ id: "c1", type: "sql" })];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result.unresolvedRefs).toHaveLength(1);
    });

    it("should mark unresolved refs when cell index is out of bounds", () => {
      const result = resolveQueryVariables("SELECT * FROM {{cell_5}}", []);
      expect(result.unresolvedRefs).toHaveLength(1);
    });

    it("should mark unresolved refs when target is a markdown cell", () => {
      const cells = [makeCell({ type: "markdown" })];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result.unresolvedRefs).toHaveLength(1);
    });

    it("should mark unresolved refs when target has error", () => {
      const cells = [
        makeCell({
          type: "sql",
          error: "syntax error",
          result: { columns: ["a"], rows: [[1]], affected_rows: 0 },
        }),
      ];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result.unresolvedRefs).toHaveLength(1);
    });

    it("should handle multiple references", () => {
      const cells = [
        makeCell({
          id: "c1",
          type: "sql",
          result: { columns: ["a"], rows: [[1]], affected_rows: 0 },
        }),
        makeCell({
          id: "c2",
          type: "sql",
          result: { columns: ["b"], rows: [[2]], affected_rows: 0 },
        }),
      ];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}} JOIN {{cell_2}}",
        cells,
      );
      expect(result.sql).toContain("cell_1 AS");
      expect(result.sql).toContain("cell_2 AS");
      expect(result.unresolvedRefs).toEqual([]);
    });

    it("should replace every identical reference with a single CTE", () => {
      const cells = [
        makeCell({
          result: { columns: ["id"], rows: [[1]], affected_rows: 0 },
        }),
      ];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}} a JOIN {{cell_1}} b ON a.id = b.id " +
          "JOIN {{cell_1}} c ON b.id = c.id",
        cells,
      );

      expect(result.sql).toBe(
        'WITH cell_1 AS (\n  SELECT 1 AS "id"\n)\n' +
          "SELECT * FROM cell_1 a JOIN cell_1 b ON a.id = b.id " +
          "JOIN cell_1 c ON b.id = c.id",
      );
      expect(result.unresolvedRefs).toEqual([]);
    });

    it.each([
      "SELECT * FROM {{cell_01}} a JOIN {{cell_2}} b ON a.id = b.id " +
        "JOIN {{cell_1}} c ON b.id = c.id JOIN {{cell_002}} d ON c.id = d.id",
      "SELECT * FROM {{cell_1}} a JOIN {{cell_02}} b ON a.id = b.id " +
        "JOIN {{cell_001}} c ON b.id = c.id JOIN {{cell_2}} d ON c.id = d.id",
    ])("should replace mixed leading-zero references with one CTE per cell: %s", (sql) => {
      const cells = [1, 2].map((id) => makeCell({
        id: `c${id}`,
        result: { columns: ["id"], rows: [[id]], affected_rows: 0 },
      }));
      const result = resolveQueryVariables(sql, cells);

      expect(result.sql).toBe(
        'WITH cell_1 AS (\n  SELECT 1 AS "id"\n),\n' +
          'cell_2 AS (\n  SELECT 2 AS "id"\n)\n' +
          "SELECT * FROM cell_1 a JOIN cell_2 b ON a.id = b.id " +
          "JOIN cell_1 c ON b.id = c.id JOIN cell_2 d ON c.id = d.id",
      );
      expect(result.unresolvedRefs).toEqual([]);
    });

    it.each([
      { reason: "missing result", cells: [makeCell()] },
      { reason: "missing cell", cells: [] },
      { reason: "markdown cell", cells: [makeCell({ type: "markdown" })] },
      {
        reason: "errored cell",
        cells: [makeCell({
          error: "query failed",
          result: { columns: ["id"], rows: [[1]], affected_rows: 0 },
        })],
      },
    ])("should preserve each unresolved occurrence for $reason", ({ cells }) => {
      const sql = "SELECT * FROM {{cell_1}} UNION SELECT * FROM {{cell_01}} " +
        "UNION SELECT * FROM {{cell_3}} UNION SELECT * FROM {{cell_1}}";
      const result = resolveQueryVariables(sql, cells);

      expect(result.sql).toBe(sql);
      expect(result.unresolvedRefs).toEqual([
        { match: "{{cell_1}}", cellIndex: 0 },
        { match: "{{cell_01}}", cellIndex: 0 },
        { match: "{{cell_3}}", cellIndex: 2 },
        { match: "{{cell_1}}", cellIndex: 0 },
      ]);
    });

    it("should replace resolved refs while preserving interleaved unresolved occurrences", () => {
      const cells = [
        makeCell({
          result: { columns: ["id"], rows: [[1]], affected_rows: 0 },
        }),
        makeCell({ id: "c2" }),
      ];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_2}} UNION SELECT * FROM {{cell_01}} " +
          "UNION SELECT * FROM {{cell_02}} UNION SELECT * FROM {{cell_1}} " +
          "UNION SELECT * FROM {{cell_2}}",
        cells,
      );

      expect(result.sql).toBe(
        'WITH cell_1 AS (\n  SELECT 1 AS "id"\n)\n' +
          "SELECT * FROM {{cell_2}} UNION SELECT * FROM cell_1 " +
          "UNION SELECT * FROM {{cell_02}} UNION SELECT * FROM cell_1 " +
          "UNION SELECT * FROM {{cell_2}}",
      );
      expect(result.unresolvedRefs).toEqual([
        { match: "{{cell_2}}", cellIndex: 1 },
        { match: "{{cell_02}}", cellIndex: 1 },
        { match: "{{cell_2}}", cellIndex: 1 },
      ]);
    });

    it("should escape single quotes in string values", () => {
      const cells = [
        makeCell({
          type: "sql",
          result: {
            columns: ["name"],
            rows: [["O'Brien"]],
            affected_rows: 0,
          },
        }),
      ];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result.sql).toContain("O''Brien");
    });

    it("should handle null values in result rows", () => {
      const cells = [
        makeCell({
          type: "sql",
          result: {
            columns: ["a"],
            rows: [[null]],
            affected_rows: 0,
          },
        }),
      ];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result.sql).toContain("NULL AS");
    });

    it("should escape double quotes in column names", () => {
      const cells = [
        makeCell({
          type: "sql",
          result: {
            columns: ['a" FROM x; DROP TABLE y; --'],
            rows: [["v"]],
            affected_rows: 0,
          },
        }),
      ];
      const result = resolveQueryVariables("SELECT * FROM {{cell_1}}", cells);
      expect(result.sql).toContain('AS "a"" FROM x; DROP TABLE y; --"');
      expect(result.sql).not.toContain('AS "a" FROM x');
    });

    it("should leave backslashes untouched by default", () => {
      const cells = [
        makeCell({
          type: "sql",
          result: {
            columns: ["path"],
            rows: [["C:\\temp\\"]],
            affected_rows: 0,
          },
        }),
      ];
      const result = resolveQueryVariables("SELECT * FROM {{cell_1}}", cells);
      expect(result.sql).toContain("'C:\\temp\\'");
    });

    it("should double backslashes when escapeBackslashes is set", () => {
      const cells = [
        makeCell({
          type: "sql",
          result: {
            columns: ["path"],
            rows: [["C:\\temp\\"]],
            affected_rows: 0,
          },
        }),
      ];
      const result = resolveQueryVariables("SELECT * FROM {{cell_1}}", cells, {
        escapeBackslashes: true,
      });
      expect(result.sql).toContain("'C:\\\\temp\\\\'");
    });

    it("should escape a backslash-quote sequence safely for MySQL", () => {
      const cells = [
        makeCell({
          type: "sql",
          result: {
            columns: ["v"],
            rows: [["\\', (SELECT 1)) --"]],
            affected_rows: 0,
          },
        }),
      ];
      const result = resolveQueryVariables("SELECT * FROM {{cell_1}}", cells, {
        escapeBackslashes: true,
      });
      expect(result.sql).toContain("'\\\\'', (SELECT 1)) --'");
    });

    it("should emit non-finite numbers as string literals", () => {
      const cells = [
        makeCell({
          type: "sql",
          result: {
            columns: ["n"],
            rows: [[Number.POSITIVE_INFINITY]],
            affected_rows: 0,
          },
        }),
      ];
      const result = resolveQueryVariables("SELECT * FROM {{cell_1}}", cells);
      expect(result.sql).toContain("'Infinity'");
    });

    it("should handle empty result set", () => {
      const cells = [
        makeCell({
          type: "sql",
          result: {
            columns: ["a", "b"],
            rows: [],
            affected_rows: 0,
          },
        }),
      ];
      const result = resolveQueryVariables(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result.sql).toContain("WHERE 1=0");
    });
  });

  describe("findUnresolvedDependencies", () => {
    it("returns empty array when no references", () => {
      const cells = [makeCell({ content: "SELECT 1" })];
      expect(findUnresolvedDependencies("SELECT 1", cells)).toEqual([]);
    });

    it("returns indices of cells without results", () => {
      const cells = [
        makeCell({ id: "c1", content: "SELECT 1", result: null }),
        makeCell({ id: "c2", content: "SELECT 2", result: null }),
      ];
      const result = findUnresolvedDependencies(
        "SELECT * FROM {{cell_1}} JOIN {{cell_2}}",
        cells,
      );
      expect(result).toEqual([0, 1]);
    });

    it("excludes cells that already have results", () => {
      const cells = [
        makeCell({
          id: "c1",
          content: "SELECT 1",
          result: { columns: ["id"], rows: [[1]], affected_rows: 0 },
        }),
        makeCell({ id: "c2", content: "SELECT 2", result: null }),
      ];
      const result = findUnresolvedDependencies(
        "SELECT * FROM {{cell_1}} JOIN {{cell_2}}",
        cells,
      );
      expect(result).toEqual([1]);
    });

    it("excludes non-SQL cells", () => {
      const cells = [
        makeCell({ id: "c1", type: "markdown", content: "# Title" }),
      ];
      const result = findUnresolvedDependencies(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result).toEqual([]);
    });

    it("includes cells with errors", () => {
      const cells = [
        makeCell({
          id: "c1",
          content: "SELECT bad",
          result: { columns: [], rows: [], affected_rows: 0 },
          error: "syntax error",
        }),
      ];
      const result = findUnresolvedDependencies(
        "SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result).toEqual([0]);
    });

    it("returns sorted indices", () => {
      const cells = [
        makeCell({ id: "c1", content: "SELECT 1" }),
        makeCell({ id: "c2", content: "SELECT 2" }),
        makeCell({ id: "c3", content: "SELECT 3" }),
      ];
      const result = findUnresolvedDependencies(
        "SELECT * FROM {{cell_3}} JOIN {{cell_1}}",
        cells,
      );
      expect(result).toEqual([0, 2]);
    });

    it("deduplicates repeated references", () => {
      const cells = [
        makeCell({ id: "c1", content: "SELECT 1" }),
      ];
      const result = findUnresolvedDependencies(
        "SELECT * FROM {{cell_1}} UNION SELECT * FROM {{cell_1}}",
        cells,
      );
      expect(result).toEqual([0]);
    });
  });
});
