import { describe, it, expect } from "vitest";
import {
  createResultEntries,
  updateResultEntry,
  findActiveEntry,
  countSucceeded,
  countFailed,
  totalExecutionTime,
  removeResultEntry,
  removeOtherEntries,
  removeEntriesToRight,
  removeEntriesToLeft,
  getEntryDisplayLabel,
  getStackedGridHeight,
} from "../../src/utils/multiResult";
import type { QueryResultEntry } from "../../src/types/editor";

function makeEntry(overrides: Partial<QueryResultEntry> = {}): QueryResultEntry {
  return {
    id: "tab1-result-0",
    queryIndex: 0,
    query: "SELECT 1",
    result: null,
    error: "",
    executionTime: null,
    isLoading: true,
    page: 1,
    activeTable: null,
    pkColumns: null,
    ...overrides,
  };
}

describe("multiResult", () => {
  describe("createResultEntries", () => {
    it("should create entries from queries with correct ids", () => {
      const entries = createResultEntries("tab-1", [
        "SELECT 1",
        "SELECT 2",
        "SELECT 3",
      ]);
      expect(entries).toHaveLength(3);
      expect(entries[0].id).toBe("tab-1-result-0");
      expect(entries[1].id).toBe("tab-1-result-1");
      expect(entries[2].id).toBe("tab-1-result-2");
    });

    it("should set correct queryIndex for each entry", () => {
      const entries = createResultEntries("t", ["A", "B"]);
      expect(entries[0].queryIndex).toBe(0);
      expect(entries[1].queryIndex).toBe(1);
    });

    it("should preserve the original query text", () => {
      const entries = createResultEntries("t", ["SELECT * FROM users"]);
      expect(entries[0].query).toBe("SELECT * FROM users");
    });

    it("should set all entries to loading state", () => {
      const entries = createResultEntries("t", ["SELECT 1", "SELECT 2"]);
      for (const entry of entries) {
        expect(entry.isLoading).toBe(true);
        expect(entry.result).toBeNull();
        expect(entry.error).toBe("");
        expect(entry.executionTime).toBeNull();
        expect(entry.page).toBe(1);
        expect(entry.activeTable).toBeNull();
        expect(entry.pkColumns).toBeNull();
      }
    });

    it("should handle single query", () => {
      const entries = createResultEntries("t", ["SELECT 1"]);
      expect(entries).toHaveLength(1);
    });

    it("should handle empty queries array", () => {
      const entries = createResultEntries("t", []);
      expect(entries).toHaveLength(0);
    });
  });

  describe("updateResultEntry", () => {
    it("should update the matching entry", () => {
      const entries = [
        makeEntry({ id: "a", isLoading: true }),
        makeEntry({ id: "b", isLoading: true }),
      ];
      const result = updateResultEntry(entries, "a", { isLoading: false });
      expect(result[0].isLoading).toBe(false);
      expect(result[1].isLoading).toBe(true);
    });

    it("should not mutate the original array", () => {
      const entries = [makeEntry({ id: "a", error: "" })];
      const result = updateResultEntry(entries, "a", { error: "fail" });
      expect(entries[0].error).toBe("");
      expect(result[0].error).toBe("fail");
    });

    it("should return unchanged array when id not found", () => {
      const entries = [makeEntry({ id: "a" })];
      const result = updateResultEntry(entries, "nonexistent", {
        isLoading: false,
      });
      expect(result).toEqual(entries);
    });

    it("should merge partial updates correctly", () => {
      const entries = [
        makeEntry({ id: "x", isLoading: true, error: "", executionTime: null }),
      ];
      const result = updateResultEntry(entries, "x", {
        isLoading: false,
        executionTime: 42,
      });
      expect(result[0].isLoading).toBe(false);
      expect(result[0].executionTime).toBe(42);
      expect(result[0].error).toBe("");
    });
  });

  describe("findActiveEntry", () => {
    const entries = [
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
      makeEntry({ id: "c" }),
    ];

    it("should find entry by activeResultId", () => {
      const active = findActiveEntry(entries, "b");
      expect(active?.id).toBe("b");
    });

    it("should fall back to first entry when id not found", () => {
      const active = findActiveEntry(entries, "nonexistent");
      expect(active?.id).toBe("a");
    });

    it("should fall back to first entry when activeResultId is undefined", () => {
      const active = findActiveEntry(entries, undefined);
      expect(active?.id).toBe("a");
    });

    it("should return undefined for empty array", () => {
      const active = findActiveEntry([], "a");
      expect(active).toBeUndefined();
    });
  });

  describe("countSucceeded", () => {
    it("should count entries with result and no error", () => {
      const entries = [
        makeEntry({
          id: "a",
          isLoading: false,
          error: "",
          result: { columns: [], rows: [], affected_rows: 0 },
        }),
        makeEntry({
          id: "b",
          isLoading: false,
          error: "",
          result: { columns: [], rows: [], affected_rows: 0 },
        }),
        makeEntry({ id: "c", isLoading: false, error: "fail", result: null }),
      ];
      expect(countSucceeded(entries)).toBe(2);
    });

    it("should not count loading entries", () => {
      const entries = [
        makeEntry({
          id: "a",
          isLoading: true,
          result: { columns: [], rows: [], affected_rows: 0 },
        }),
      ];
      expect(countSucceeded(entries)).toBe(0);
    });

    it("should return 0 for empty array", () => {
      expect(countSucceeded([])).toBe(0);
    });
  });

  describe("countFailed", () => {
    it("should count entries with error", () => {
      const entries = [
        makeEntry({ id: "a", isLoading: false, error: "err1" }),
        makeEntry({ id: "b", isLoading: false, error: "" }),
        makeEntry({ id: "c", isLoading: false, error: "err2" }),
      ];
      expect(countFailed(entries)).toBe(2);
    });

    it("should not count loading entries with error", () => {
      const entries = [
        makeEntry({ id: "a", isLoading: true, error: "err" }),
      ];
      expect(countFailed(entries)).toBe(0);
    });

    it("should return 0 for empty array", () => {
      expect(countFailed([])).toBe(0);
    });
  });

  describe("totalExecutionTime", () => {
    it("should sum execution times", () => {
      const entries = [
        makeEntry({ id: "a", executionTime: 100 }),
        makeEntry({ id: "b", executionTime: 200 }),
        makeEntry({ id: "c", executionTime: 50 }),
      ];
      expect(totalExecutionTime(entries)).toBe(350);
    });

    it("should treat null execution times as 0", () => {
      const entries = [
        makeEntry({ id: "a", executionTime: 100 }),
        makeEntry({ id: "b", executionTime: null }),
      ];
      expect(totalExecutionTime(entries)).toBe(100);
    });

    it("should return 0 for empty array", () => {
      expect(totalExecutionTime([])).toBe(0);
    });

    it("should return 0 when all times are null", () => {
      const entries = [
        makeEntry({ id: "a", executionTime: null }),
        makeEntry({ id: "b", executionTime: null }),
      ];
      expect(totalExecutionTime(entries)).toBe(0);
    });
  });

  describe("removeResultEntry", () => {
    it("should remove the matching entry", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { results } = removeResultEntry(entries, "b", "a");
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id)).toEqual(["a", "c"]);
    });

    it("should keep activeResultId if not removed", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
      ];
      const { nextActiveId } = removeResultEntry(entries, "b", "a");
      expect(nextActiveId).toBe("a");
    });

    it("should select next sibling when active entry is removed", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { nextActiveId } = removeResultEntry(entries, "b", "b");
      expect(nextActiveId).toBe("c");
    });

    it("should select previous when last entry is removed", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
      ];
      const { nextActiveId } = removeResultEntry(entries, "b", "b");
      expect(nextActiveId).toBe("a");
    });

    it("should return undefined activeId when all removed", () => {
      const entries = [makeEntry({ id: "a" })];
      const { results, nextActiveId } = removeResultEntry(entries, "a", "a");
      expect(results).toHaveLength(0);
      expect(nextActiveId).toBeUndefined();
    });

    it("should be a no-op when id not found", () => {
      const entries = [makeEntry({ id: "a" })];
      const { results, nextActiveId } = removeResultEntry(
        entries,
        "nonexistent",
        "a",
      );
      expect(results).toEqual(entries);
      expect(nextActiveId).toBe("a");
    });
  });

  describe("removeOtherEntries", () => {
    it("should keep only the specified entry", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { results, nextActiveId } = removeOtherEntries(entries, "b");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("b");
      expect(nextActiveId).toBe("b");
    });
  });

  describe("removeEntriesToRight", () => {
    it("should remove entries after the specified one", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { results } = removeEntriesToRight(entries, "a", "a");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a");
    });

    it("should update activeId if active was removed", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { nextActiveId } = removeEntriesToRight(entries, "a", "c");
      expect(nextActiveId).toBe("a");
    });

    it("should keep activeId if still present", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { nextActiveId } = removeEntriesToRight(entries, "b", "a");
      expect(nextActiveId).toBe("a");
    });
  });

  describe("removeEntriesToLeft", () => {
    it("should remove entries before the specified one", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { results } = removeEntriesToLeft(entries, "c", "c");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("c");
    });

    it("should update activeId if active was removed", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { nextActiveId } = removeEntriesToLeft(entries, "c", "a");
      expect(nextActiveId).toBe("c");
    });

    it("should keep activeId if still present", () => {
      const entries = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      const { nextActiveId } = removeEntriesToLeft(entries, "b", "c");
      expect(nextActiveId).toBe("c");
    });
  });

  describe("getEntryDisplayLabel", () => {
    it("should return custom label when set", () => {
      const entry = makeEntry({ label: "Users query" });
      expect(getEntryDisplayLabel(entry, "Query")).toBe("Users query");
    });

    it("should return fallback with queryIndex + 1 when no label", () => {
      const entry = makeEntry({ queryIndex: 0 });
      expect(getEntryDisplayLabel(entry, "Query")).toBe("Query 1");
    });

    it("should use correct index for non-zero queryIndex", () => {
      const entry = makeEntry({ queryIndex: 4 });
      expect(getEntryDisplayLabel(entry, "Query")).toBe("Query 5");
    });

    it("should work with different prefix strings", () => {
      const entry = makeEntry({ queryIndex: 2 });
      expect(getEntryDisplayLabel(entry, "Consulta")).toBe("Consulta 3");
    });

    it("should prefer label over fallback", () => {
      const entry = makeEntry({ queryIndex: 0, label: "My Label" });
      expect(getEntryDisplayLabel(entry, "Query")).toBe("My Label");
    });

    it("should use fallback for empty string label", () => {
      const entry = makeEntry({ queryIndex: 0, label: "" });
      expect(getEntryDisplayLabel(entry, "Query")).toBe("Query 1");
    });
  });

  describe("getStackedGridHeight", () => {
    it("should compute height for a single row", () => {
      // header (35) + 1 row (35) = 70
      expect(getStackedGridHeight(1)).toBe(70);
    });

    it("should compute height for multiple rows", () => {
      // header (35) + 5 rows (175) = 210
      expect(getStackedGridHeight(5)).toBe(210);
    });

    it("should cap at default maxHeight of 400", () => {
      expect(getStackedGridHeight(20)).toBe(400);
    });

    it("should cap at custom maxHeight", () => {
      expect(getStackedGridHeight(20, 250)).toBe(250);
    });

    it("should return header height for zero rows", () => {
      expect(getStackedGridHeight(0)).toBe(35);
    });

    it("should return exact height when it equals maxHeight", () => {
      // header (35) + rows * 35 = 400 → rows = (400 - 35) / 35 ≈ 10.43 → 10 rows = 385, 11 rows = 420 > 400
      expect(getStackedGridHeight(10)).toBe(385);
      expect(getStackedGridHeight(11)).toBe(400);
    });
  });
});
