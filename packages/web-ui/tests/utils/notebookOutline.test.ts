import { describe, it, expect } from "vitest";
import { extractOutline, getUnnamedCellsWithContent } from "../../src/utils/notebookOutline";
import type { NotebookCell } from "../../src/types/notebook";

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
  return {
    id: "cell-1",
    type: "markdown",
    content: "",
    ...overrides,
  };
}

describe("notebookOutline", () => {
  describe("extractOutline", () => {
    it("extracts headings from markdown cells", () => {
      const cells = [
        makeCell({ id: "c1", content: "# Introduction\nSome text\n## Setup" }),
        makeCell({ id: "c2", content: "## Analysis\n### Details" }),
      ];

      const entries = extractOutline(cells);
      expect(entries).toEqual([
        { level: 1, text: "Introduction", cellId: "c1", cellIndex: 0, cellType: "markdown" },
        { level: 2, text: "Setup", cellId: "c1", cellIndex: 0, cellType: "markdown" },
        { level: 2, text: "Analysis", cellId: "c2", cellIndex: 1, cellType: "markdown" },
        { level: 3, text: "Details", cellId: "c2", cellIndex: 1, cellType: "markdown" },
      ]);
    });

    it("includes SQL cells in outline", () => {
      const cells = [
        makeCell({ id: "c1", type: "sql", content: "SELECT 1" }),
        makeCell({ id: "c2", type: "sql", content: "SELECT 2", name: "User Query" }),
      ];

      const entries = extractOutline(cells);
      expect(entries).toEqual([
        { level: 1, text: "SQL #1", cellId: "c1", cellIndex: 0, cellType: "sql" },
        { level: 1, text: "User Query", cellId: "c2", cellIndex: 1, cellType: "sql" },
      ]);
    });

    it("uses cell name for markdown cells when set", () => {
      const cells = [
        makeCell({ id: "c1", content: "# Heading", name: "My Section" }),
      ];

      const entries = extractOutline(cells);
      expect(entries).toEqual([
        { level: 1, text: "My Section", cellId: "c1", cellIndex: 0, cellType: "markdown" },
      ]);
    });

    it("mixes SQL and markdown cells", () => {
      const cells = [
        makeCell({ id: "c1", content: "# Introduction" }),
        makeCell({ id: "c2", type: "sql", content: "SELECT * FROM users", name: "Fetch Users" }),
        makeCell({ id: "c3", content: "## Results" }),
      ];

      const entries = extractOutline(cells);
      expect(entries).toHaveLength(3);
      expect(entries[0].text).toBe("Introduction");
      expect(entries[1].text).toBe("Fetch Users");
      expect(entries[1].cellType).toBe("sql");
      expect(entries[2].text).toBe("Results");
    });

    it("returns empty array for empty cells", () => {
      expect(extractOutline([])).toEqual([]);
    });

    it("shows fallback for empty markdown cells without name", () => {
      const cells = [
        makeCell({ id: "c1", content: "" }),
        makeCell({ id: "c2", content: "   " }),
      ];
      const entries = extractOutline(cells);
      expect(entries).toEqual([
        { level: 1, text: "MD #1", cellId: "c1", cellIndex: 0, cellType: "markdown" },
        { level: 1, text: "MD #2", cellId: "c2", cellIndex: 1, cellType: "markdown" },
      ]);
    });

    it("shows fallback for markdown cells with content but no headings and no name", () => {
      const cells = [
        makeCell({ id: "c1", content: "Just plain text without headings" }),
      ];
      const entries = extractOutline(cells);
      expect(entries).toEqual([
        { level: 1, text: "MD #1", cellId: "c1", cellIndex: 0, cellType: "markdown" },
      ]);
    });

    it("only extracts h1-h3 headings", () => {
      const cells = [
        makeCell({
          id: "c1",
          content: "# H1\n## H2\n### H3\n#### H4\n##### H5",
        }),
      ];

      const entries = extractOutline(cells);
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.level)).toEqual([1, 2, 3]);
    });

    it("trims heading text", () => {
      const cells = [
        makeCell({ id: "c1", content: "#   Spaced Title   " }),
      ];

      const entries = extractOutline(cells);
      expect(entries[0].text).toBe("Spaced Title");
    });
  });

  describe("getUnnamedCellsWithContent", () => {
    it("returns cells without a name that have content", () => {
      const cells = [
        makeCell({ id: "c1", type: "sql", content: "SELECT 1" }),
        makeCell({ id: "c2", type: "sql", content: "SELECT 2", name: "Named" }),
        makeCell({ id: "c3", content: "# Hello" }),
      ];

      const result = getUnnamedCellsWithContent(cells);
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.id)).toEqual(["c1", "c3"]);
    });

    it("excludes cells with empty or whitespace-only content", () => {
      const cells = [
        makeCell({ id: "c1", content: "" }),
        makeCell({ id: "c2", content: "   " }),
        makeCell({ id: "c3", content: "Some content" }),
      ];

      const result = getUnnamedCellsWithContent(cells);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("c3");
    });

    it("returns empty array when all cells are named", () => {
      const cells = [
        makeCell({ id: "c1", content: "SELECT 1", name: "Query 1" }),
        makeCell({ id: "c2", content: "# Intro", name: "Intro Section" }),
      ];

      expect(getUnnamedCellsWithContent(cells)).toEqual([]);
    });

    it("returns empty array for empty cells list", () => {
      expect(getUnnamedCellsWithContent([])).toEqual([]);
    });
  });
});
