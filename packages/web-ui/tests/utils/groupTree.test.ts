import { describe, it, expect } from "vitest";
import { flattenGroupTree } from "../../src/utils/groupTree";
import type { ConnectionGroup } from "../../src/contexts/DatabaseContext";

const g = (
  id: string,
  parent_id: string | null,
  sort_order = 0,
): ConnectionGroup => ({
  id,
  name: id,
  collapsed: false,
  sort_order,
  parent_id,
});

describe("flattenGroupTree", () => {
  it("returns an empty array for no groups", () => {
    expect(flattenGroupTree([])).toEqual([]);
  });

  it("emits parents before their children (DFS)", () => {
    const groups = [g("child", "root"), g("root", null)];
    const flat = flattenGroupTree(groups);
    expect(flat.map((e) => e.group.id)).toEqual(["root", "child"]);
    expect(flat.map((e) => e.depth)).toEqual([0, 1]);
  });

  it("assigns depth by nesting level", () => {
    const groups = [
      g("a", null),
      g("a1", "a"),
      g("a1x", "a1"),
      g("b", null),
    ];
    const flat = flattenGroupTree(groups);
    expect(flat.map((e) => [e.group.id, e.depth])).toEqual([
      ["a", 0],
      ["a1", 1],
      ["a1x", 2],
      ["b", 0],
    ]);
  });

  it("sorts siblings by sort_order", () => {
    const groups = [
      g("second", null, 2),
      g("first", null, 1),
      g("childB", "first", 2),
      g("childA", "first", 1),
    ];
    const flat = flattenGroupTree(groups);
    expect(flat.map((e) => e.group.id)).toEqual([
      "first",
      "childA",
      "childB",
      "second",
    ]);
  });

  it("treats null and undefined parent_id as root", () => {
    const rootUndefined: ConnectionGroup = {
      id: "u",
      name: "u",
      collapsed: false,
      sort_order: 0,
    };
    const flat = flattenGroupTree([rootUndefined, g("n", null, 1)]);
    expect(flat.map((e) => e.group.id)).toEqual(["u", "n"]);
    expect(flat.every((e) => e.depth === 0)).toBe(true);
  });
});
