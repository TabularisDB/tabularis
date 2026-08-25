import { describe, expect, it, vi } from "vitest";

import type { PaletteItem } from "../../src/types/palette";
import { createPaletteSearch } from "../../src/utils/paletteItems";

function createItem(
  overrides: Partial<PaletteItem> = {},
): PaletteItem {
  return {
    id: "item",
    title: "Item",
    primaryAction: {
      id: "open",
      label: "Open",
      execute: vi.fn(),
    },
    ...overrides,
  };
}

describe("createPaletteSearch", () => {
  it("should search command and object items through the same fields", () => {
    const items = [
      createItem({
        id: "settings",
        title: "Open settings",
        keywords: ["preferences"],
      }),
      createItem({
        id: "users",
        title: "users",
        group: "public",
        badge: "table",
      }),
    ];

    expect(
      createPaletteSearch(items)("preferenses").map(
        (item) => item.id,
      ),
    ).toEqual(["settings"]);
    expect(
      createPaletteSearch(items)("public").map((item) => item.id),
    ).toEqual(["users"]);
  });

  it("should apply contextual relevance to every source", () => {
    const items = [
      createItem({ id: "global", title: "Open console" }),
      createItem({
        id: "contextual",
        title: "Open table in console",
        relevance: 100,
      }),
    ];

    expect(
      createPaletteSearch(items)("open").map((item) => item.id),
    ).toEqual(["contextual", "global"]);
  });

  it("should preserve source grouping order for equally relevant items", () => {
    const items = [
      createItem({ id: "schema-b", title: "zebra", group: "b" }),
      createItem({ id: "schema-a", title: "alpha", group: "a" }),
    ];

    expect(
      createPaletteSearch(items)("").map((item) => item.id),
    ).toEqual(["schema-b", "schema-a"]);
  });

  it("should keep fuzzy search results from the same group contiguous", () => {
    const search = createPaletteSearch([
      createItem({ id: "public-user", title: "user", group: "public" }),
      createItem({ id: "sales-user", title: "user", group: "sales" }),
      createItem({
        id: "public-user-roles",
        title: "user_roles_mapping",
        group: "public",
      }),
    ]);

    expect(search("user").map((item) => item.id)).toEqual([
      "public-user",
      "public-user-roles",
      "sales-user",
    ]);
  });
});
