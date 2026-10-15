import { describe, expect, it, vi } from "vitest";

import type { PaletteItem } from "../../src/types/palette";
import {
  createPaletteSearch,
  MAX_VISIBLE_PALETTE_RESULTS,
} from "../../src/utils/paletteItems";

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

  it("should not let a short query fuzzy-match every function in a large schema", () => {
    const routines = Array.from({ length: 200 }, (_, index) =>
      createItem({
        id: `routine-${index}`,
        title: `st_setsrid_${index}`,
        description: "FUNCTION",
        group: "public",
        badge: "Routine",
      }),
    );
    const search = createPaletteSearch([
      createItem({
        id: "users",
        title: "users",
        group: "public",
        badge: "Table",
      }),
      ...routines,
    ]);

    expect(search("users").map((item) => item.id)).toEqual(["users"]);
    // A single typo still matches.
    expect(search("usrs").map((item) => item.id)).toEqual(["users"]);
  });

  it("should rank a boosted table above loosely matching routines but below an exact routine", () => {
    const search = createPaletteSearch([
      createItem({
        id: "routine-loose",
        title: "st_equals",
        relevance: 0,
      }),
      createItem({
        id: "table",
        title: "sequences",
        relevance: 20,
      }),
      createItem({
        id: "routine-exact",
        title: "seqences_next",
        relevance: 0,
      }),
    ]);

    // Both the table and the routine contain the query verbatim; the boost
    // puts the table first, and the routine that only matches fuzzily is
    // dropped by the threshold.
    expect(search("seq").map((item) => item.id)).toEqual([
      "table",
      "routine-exact",
    ]);
    // A verbatim routine match still beats a table that only matches with a
    // typo.
    expect(search("seqences").map((item) => item.id)).toEqual([
      "routine-exact",
      "table",
    ]);
  });

  it("should expose a render cap that keeps large lists responsive", () => {
    expect(MAX_VISIBLE_PALETTE_RESULTS).toBeGreaterThan(0);
  });
});
