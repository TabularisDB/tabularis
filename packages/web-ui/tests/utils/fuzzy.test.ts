import { describe, it, expect } from "vitest";
import { fuzzyFilter } from "../../src/utils/fuzzy";

const tables = [
  { name: "users" },
  { name: "user_roles" },
  { name: "orders" },
  { name: "order_items" },
  { name: "audit_log" },
];
const byName = (t: { name: string }) => t.name;

describe("fuzzyFilter", () => {
  it("returns items unchanged for an empty query", () => {
    expect(fuzzyFilter(tables, "", byName)).toEqual(tables);
    expect(fuzzyFilter(tables, "   ", byName)).toEqual(tables);
  });

  it("matches case-insensitively", () => {
    expect(fuzzyFilter(tables, "USERS", byName).map(byName)).toContain("users");
  });

  it("keeps relevant matches and ranks the closest first", () => {
    const result = fuzzyFilter(tables, "order", byName).map(byName);
    expect(result).toContain("orders");
    expect(result).toContain("order_items");
    expect(result[0]).toBe("orders");
  });

  it("tolerates single-character typos", () => {
    expect(fuzzyFilter(tables, "ordrs", byName).map(byName)).toContain("orders");
    expect(fuzzyFilter(tables, "userz", byName).map(byName)).toContain("users");
  });

  it("excludes clearly unrelated names", () => {
    expect(fuzzyFilter(tables, "audit", byName).map(byName)).not.toContain(
      "orders",
    );
  });
});
