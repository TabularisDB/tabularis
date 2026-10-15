import { describe, it, expect } from "vitest";
import {
  addHistoryEntry,
  createHistoryEntry,
  restoreFromHistory,
  getHistorySize,
} from "../../src/utils/notebookHistory";
import type {
  CellExecutionEntry,
  NotebookCell,
} from "../../src/types/notebook";

function makeEntry(
  overrides: Partial<CellExecutionEntry> = {},
): CellExecutionEntry {
  return {
    query: "SELECT 1",
    result: { columns: ["a"], rows: [[1]], affected_rows: 0 },
    error: undefined,
    executionTime: 50,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeCell(
  overrides: Partial<NotebookCell> = {},
): NotebookCell {
  return {
    id: "c1",
    type: "sql",
    content: "SELECT 1",
    result: null,
    error: undefined,
    executionTime: null,
    isLoading: false,
    ...overrides,
  };
}

describe("notebookHistory", () => {
  describe("addHistoryEntry", () => {
    it("should prepend entry to history", () => {
      const entry = makeEntry({ query: "SELECT 2" });
      const history = addHistoryEntry([], entry);
      expect(history).toHaveLength(1);
      expect(history[0].query).toBe("SELECT 2");
    });

    it("should keep newest first", () => {
      const old = makeEntry({ query: "old" });
      const newer = makeEntry({ query: "new" });
      const history = addHistoryEntry([old], newer);
      expect(history[0].query).toBe("new");
      expect(history[1].query).toBe("old");
    });

    it("should cap at maxSize", () => {
      const entries = Array.from({ length: 5 }, (_, i) =>
        makeEntry({ query: `q${i}` }),
      );
      let history: CellExecutionEntry[] = [];
      for (const entry of entries) {
        history = addHistoryEntry(history, entry, 3);
      }
      expect(history).toHaveLength(3);
      expect(history[0].query).toBe("q4");
    });
  });

  describe("createHistoryEntry", () => {
    it("should create entry with all fields", () => {
      const entry = createHistoryEntry("SELECT 1", null, undefined, 42);
      expect(entry.query).toBe("SELECT 1");
      expect(entry.result).toBeNull();
      expect(entry.executionTime).toBe(42);
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it("should include error when provided", () => {
      const entry = createHistoryEntry("BAD SQL", null, "syntax error", 10);
      expect(entry.error).toBe("syntax error");
    });
  });

  describe("restoreFromHistory", () => {
    it("should return partial cell from history entry", () => {
      const cell = makeCell({
        history: [
          makeEntry({ query: "SELECT old", executionTime: 33 }),
        ],
      });
      const partial = restoreFromHistory(cell, 0);
      expect(partial).not.toBeNull();
      expect(partial!.content).toBe("SELECT old");
      expect(partial!.executionTime).toBe(33);
      expect(partial!.isLoading).toBe(false);
    });

    it("should return null for invalid index", () => {
      const cell = makeCell({ history: [] });
      expect(restoreFromHistory(cell, 0)).toBeNull();
    });

    it("should return null for no history", () => {
      const cell = makeCell();
      expect(restoreFromHistory(cell, 0)).toBeNull();
    });
  });

  describe("getHistorySize", () => {
    it("should return history length", () => {
      expect(getHistorySize(makeCell({ history: [makeEntry()] }))).toBe(1);
    });

    it("should return 0 for no history", () => {
      expect(getHistorySize(makeCell())).toBe(0);
    });
  });

});
