import { describe, it, expect } from "vitest";
import {
  getExecutableCells,
  createRunAllResult,
  addSuccess,
  addFailure,
  addSkipped,
  formatRunAllSummary,
} from "../../src/utils/notebookRunAll";
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

describe("notebookRunAll", () => {
  describe("getExecutableCells", () => {
    it("should return only SQL cells with content", () => {
      const cells = [
        makeCell({ id: "a", type: "sql", content: "SELECT 1" }),
        makeCell({ id: "b", type: "markdown", content: "# Title" }),
        makeCell({ id: "c", type: "sql", content: "" }),
        makeCell({ id: "d", type: "sql", content: "SELECT 2" }),
      ];
      const result = getExecutableCells(cells);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ cell: cells[0], index: 0 });
      expect(result[1]).toEqual({ cell: cells[3], index: 3 });
    });

    it("should skip whitespace-only SQL cells", () => {
      const cells = [makeCell({ content: "   \n  " })];
      expect(getExecutableCells(cells)).toHaveLength(0);
    });

    it("should return empty for empty cells array", () => {
      expect(getExecutableCells([])).toHaveLength(0);
    });
  });

  describe("createRunAllResult", () => {
    it("should initialize with zeros", () => {
      const result = createRunAllResult();
      expect(result.total).toBe(0);
      expect(result.executed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe("addSuccess", () => {
    it("should increment executed and succeeded", () => {
      const result = addSuccess(createRunAllResult());
      expect(result.executed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
    });
  });

  describe("addFailure", () => {
    it("should increment executed and failed and add error", () => {
      const result = addFailure(createRunAllResult(), "c1", 0, "error msg");
      expect(result.executed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toEqual([
        { cellId: "c1", cellIndex: 0, error: "error msg" },
      ]);
    });
  });

  describe("addSkipped", () => {
    it("should increment skipped count", () => {
      const result = addSkipped(createRunAllResult(), 3);
      expect(result.skipped).toBe(3);
    });
  });

  describe("formatRunAllSummary", () => {
    it("should format mixed result", () => {
      let result = createRunAllResult();
      result = addSuccess(result);
      result = addSuccess(result);
      result = addFailure(result, "c1", 0, "err");
      result = addSkipped(result, 1);
      expect(formatRunAllSummary(result)).toBe(
        "2 succeeded, 1 failed, 1 skipped",
      );
    });

    it("should format success-only result", () => {
      let result = createRunAllResult();
      result = addSuccess(result);
      expect(formatRunAllSummary(result)).toBe("1 succeeded");
    });

    it("should return empty for zero result", () => {
      expect(formatRunAllSummary(createRunAllResult())).toBe("");
    });
  });
});
