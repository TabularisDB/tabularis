import { describe, it, expect, afterEach } from "vitest";
import {
  reorderCells,
  moveCell,
  getDropIndex,
  createCellDragPreview,
  computeAutoScrollSpeed,
} from "../../src/utils/notebookDnd";
import type { NotebookCell } from "../../src/types/notebook";

function makeCell(id: string): NotebookCell {
  return {
    id,
    type: "sql",
    content: "",
    result: null,
    error: undefined,
    executionTime: null,
    isLoading: false,
  };
}

describe("notebookDnd", () => {
  describe("reorderCells", () => {
    it("should move cell from start to end", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      const result = reorderCells(cells, 0, 2);
      expect(result.map((c) => c.id)).toEqual(["b", "c", "a"]);
    });

    it("should move cell from end to start", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      const result = reorderCells(cells, 2, 0);
      expect(result.map((c) => c.id)).toEqual(["c", "a", "b"]);
    });

    it("should move cell to adjacent position", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      const result = reorderCells(cells, 0, 1);
      expect(result.map((c) => c.id)).toEqual(["b", "a", "c"]);
    });

    it("should no-op when from equals to", () => {
      const cells = [makeCell("a"), makeCell("b")];
      const result = reorderCells(cells, 0, 0);
      expect(result.map((c) => c.id)).toEqual(["a", "b"]);
    });

    it("should no-op for out-of-bounds from index", () => {
      const cells = [makeCell("a"), makeCell("b")];
      expect(reorderCells(cells, -1, 0)).toEqual(cells);
      expect(reorderCells(cells, 5, 0)).toEqual(cells);
    });

    it("should no-op for out-of-bounds to index", () => {
      const cells = [makeCell("a"), makeCell("b")];
      expect(reorderCells(cells, 0, -1)).toEqual(cells);
      expect(reorderCells(cells, 0, 5)).toEqual(cells);
    });

    it("should not mutate original array", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      const original = [...cells];
      reorderCells(cells, 0, 2);
      expect(cells.map((c) => c.id)).toEqual(original.map((c) => c.id));
    });
  });

  describe("moveCell", () => {
    it("should move a cell down to a later gap", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      // insert before gap 3 (after last) → a goes to the end
      expect(moveCell(cells, 0, 3).map((c) => c.id)).toEqual(["b", "c", "a"]);
    });

    it("should move a cell up to an earlier gap", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      // insert before gap 0 → c goes to the front
      expect(moveCell(cells, 2, 0).map((c) => c.id)).toEqual(["c", "a", "b"]);
    });

    it("should insert into a middle gap", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c"), makeCell("d")];
      // move d before gap 1 → between a and b
      expect(moveCell(cells, 3, 1).map((c) => c.id)).toEqual([
        "a",
        "d",
        "b",
        "c",
      ]);
    });

    it("should no-op when dropping into its own gap (before)", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      expect(moveCell(cells, 1, 1)).toBe(cells);
    });

    it("should no-op when dropping into its own gap (after)", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      expect(moveCell(cells, 1, 2)).toBe(cells);
    });

    it("should no-op for out-of-bounds indices", () => {
      const cells = [makeCell("a"), makeCell("b")];
      expect(moveCell(cells, -1, 0)).toBe(cells);
      expect(moveCell(cells, 5, 0)).toBe(cells);
      expect(moveCell(cells, 0, -1)).toBe(cells);
      expect(moveCell(cells, 0, 3)).toBe(cells);
    });

    it("should not mutate the original array", () => {
      const cells = [makeCell("a"), makeCell("b"), makeCell("c")];
      const snapshot = cells.map((c) => c.id);
      moveCell(cells, 0, 3);
      expect(cells.map((c) => c.id)).toEqual(snapshot);
    });
  });

  describe("getDropIndex", () => {
    const containerRect = { top: 0, left: 0, width: 400, height: 300 } as DOMRect;

    function makeRect(top: number, height: number): DOMRect {
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 400,
        width: 400,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    }

    it("should return 0 when cursor is above first cell midpoint", () => {
      const rects = [makeRect(0, 100), makeRect(100, 100), makeRect(200, 100)];
      expect(getDropIndex(containerRect, rects, 30, 2)).toBe(0);
    });

    it("should return last index when cursor is below all cells", () => {
      const rects = [makeRect(0, 100), makeRect(100, 100), makeRect(200, 100)];
      expect(getDropIndex(containerRect, rects, 350, 0)).toBe(2);
    });

    it("should return correct index for middle position", () => {
      const rects = [makeRect(0, 100), makeRect(100, 100), makeRect(200, 100)];
      expect(getDropIndex(containerRect, rects, 130, 0)).toBe(1);
    });
  });

  describe("computeAutoScrollSpeed", () => {
    const rect = { top: 100, bottom: 500 };

    it("should not scroll when the cursor is in the middle", () => {
      expect(computeAutoScrollSpeed(rect, 300)).toBe(0);
    });

    it("should scroll up (negative) near the top edge", () => {
      expect(computeAutoScrollSpeed(rect, 110)).toBeLessThan(0);
    });

    it("should scroll down (positive) near the bottom edge", () => {
      expect(computeAutoScrollSpeed(rect, 490)).toBeGreaterThan(0);
    });

    it("should scroll faster the closer to the edge", () => {
      const near = Math.abs(computeAutoScrollSpeed(rect, 102));
      const far = Math.abs(computeAutoScrollSpeed(rect, 150));
      expect(near).toBeGreaterThan(far);
    });

    it("should cap at maxSpeed past the edge", () => {
      expect(computeAutoScrollSpeed(rect, 80, 60, 16)).toBe(-16);
      expect(computeAutoScrollSpeed(rect, 520, 60, 16)).toBe(16);
    });

    it("should move at least 1px when just inside the edge zone", () => {
      // intensity is tiny but non-zero, so ceil keeps it from stalling.
      expect(computeAutoScrollSpeed(rect, 159)).toBe(-1);
    });

    it("should respect a custom edge size", () => {
      expect(computeAutoScrollSpeed(rect, 130, 20)).toBe(0);
      expect(computeAutoScrollSpeed(rect, 115, 20)).toBeLessThan(0);
    });
  });

  describe("createCellDragPreview", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("should append an off-screen preview to the body", () => {
      const el = createCellDragPreview(document, {
        name: "My cell",
        typeLabel: "SQL",
        type: "sql",
      });
      expect(el.parentElement).toBe(document.body);
      expect(el.style.position).toBe("fixed");
      expect(el.style.pointerEvents).toBe("none");
      // Positioned out of view so it can still be snapshotted by the browser.
      expect(el.style.top).toBe("-1000px");
      expect(el.style.left).toBe("-1000px");
    });

    it("should render the cell name and type label", () => {
      const el = createCellDragPreview(document, {
        name: "Top customers",
        typeLabel: "SQL",
        type: "sql",
      });
      expect(el.textContent).toContain("Top customers");
      expect(el.textContent).toContain("SQL");
    });

    it("should style the badge differently per cell type", () => {
      const sql = createCellDragPreview(document, {
        name: "a",
        typeLabel: "SQL",
        type: "sql",
      });
      const md = createCellDragPreview(document, {
        name: "b",
        typeLabel: "Markdown",
        type: "markdown",
      });
      const sqlBadge = sql.querySelector("span");
      const mdBadge = md.querySelector("span");
      expect(sqlBadge?.className).toContain("text-blue-500");
      expect(mdBadge?.className).toContain("text-purple-500");
    });

    it("should be removable from the DOM by the caller", () => {
      const el = createCellDragPreview(document, {
        name: "x",
        typeLabel: "SQL",
        type: "sql",
      });
      el.remove();
      expect(el.parentElement).toBeNull();
    });
  });
});
