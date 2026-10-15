import { describe, it, expect } from "vitest";
import { moveTab } from "../../src/utils/tabDnd";
import type { Tab } from "../../src/types/editor";

function makeTab(id: string, connectionId: string): Tab {
  return {
    id,
    title: id,
    type: "console",
    query: "",
    result: null,
    error: "",
    executionTime: null,
    page: 1,
    activeTable: null,
    pkColumns: null,
    connectionId,
  };
}

describe("tabDnd", () => {
  describe("moveTab", () => {
    it("should move a tab down to a later gap", () => {
      const tabs = [makeTab("a", "c1"), makeTab("b", "c1"), makeTab("c", "c1")];
      // insert before gap 3 (after last) → a goes to the end
      expect(moveTab(tabs, "c1", "a", 3).map((t) => t.id)).toEqual([
        "b",
        "c",
        "a",
      ]);
    });

    it("should move a tab up to an earlier gap", () => {
      const tabs = [makeTab("a", "c1"), makeTab("b", "c1"), makeTab("c", "c1")];
      // insert before gap 0 → c goes to the front
      expect(moveTab(tabs, "c1", "c", 0).map((t) => t.id)).toEqual([
        "c",
        "a",
        "b",
      ]);
    });

    it("should insert into a middle gap", () => {
      const tabs = [
        makeTab("a", "c1"),
        makeTab("b", "c1"),
        makeTab("c", "c1"),
        makeTab("d", "c1"),
      ];
      // move d before gap 1 → between a and b
      expect(moveTab(tabs, "c1", "d", 1).map((t) => t.id)).toEqual([
        "a",
        "d",
        "b",
        "c",
      ]);
    });

    it("should no-op when dropping into its own gap (before)", () => {
      const tabs = [makeTab("a", "c1"), makeTab("b", "c1"), makeTab("c", "c1")];
      expect(moveTab(tabs, "c1", "b", 1)).toBe(tabs);
    });

    it("should no-op when dropping into its own gap (after)", () => {
      const tabs = [makeTab("a", "c1"), makeTab("b", "c1"), makeTab("c", "c1")];
      expect(moveTab(tabs, "c1", "b", 2)).toBe(tabs);
    });

    it("should no-op for an unknown tab id", () => {
      const tabs = [makeTab("a", "c1"), makeTab("b", "c1")];
      expect(moveTab(tabs, "c1", "missing", 0)).toBe(tabs);
    });

    it("should no-op for out-of-bounds insertAt", () => {
      const tabs = [makeTab("a", "c1"), makeTab("b", "c1")];
      expect(moveTab(tabs, "c1", "a", -1)).toBe(tabs);
      expect(moveTab(tabs, "c1", "a", 3)).toBe(tabs);
    });

    it("should not mutate the original array", () => {
      const tabs = [makeTab("a", "c1"), makeTab("b", "c1"), makeTab("c", "c1")];
      const snapshot = tabs.map((t) => t.id);
      moveTab(tabs, "c1", "a", 3);
      expect(tabs.map((t) => t.id)).toEqual(snapshot);
    });

    it("should leave other connections' tabs in their original slots", () => {
      const tabs = [
        makeTab("a", "c1"),
        makeTab("x", "c2"),
        makeTab("b", "c1"),
        makeTab("y", "c2"),
        makeTab("c", "c1"),
      ];
      // Move c1's "a" to the end of c1's own tabs (after "c").
      const result = moveTab(tabs, "c1", "a", 3);
      expect(result.map((t) => t.id)).toEqual(["b", "x", "c", "y", "a"]);
    });

    it("should only reorder tabs belonging to the given connection", () => {
      const tabs = [makeTab("a", "c1"), makeTab("b", "c2"), makeTab("c", "c1")];
      // c2 has only one tab, so nothing should change when acting on c2.
      expect(moveTab(tabs, "c2", "b", 0)).toBe(tabs);
    });
  });
});
