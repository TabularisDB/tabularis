import { describe, expect, it, vi } from "vitest";
import { passQueryGuards } from "../../src/utils/queryGuard";

describe("passQueryGuards", () => {
  it("runs the production guard before the standard dangerous-query guard", async () => {
    const order: string[] = [];

    const result = await passQueryGuards({
      guardProduction: vi.fn(async () => {
        order.push("production");
        return true;
      }),
      guardDangerousQuery: vi.fn(async () => {
        order.push("dangerous-query");
        return true;
      }),
    });

    expect(result).toBe(true);
    expect(order).toEqual(["production", "dangerous-query"]);
  });

  it("does not run the standard guard when production blocks the query", async () => {
    const guardDangerousQuery = vi.fn(async () => true);

    const result = await passQueryGuards({
      guardProduction: vi.fn(async () => false),
      guardDangerousQuery,
    });

    expect(result).toBe(false);
    expect(guardDangerousQuery).not.toHaveBeenCalled();
  });

  it("returns false when the standard guard blocks a non-production query", async () => {
    const result = await passQueryGuards({
      guardProduction: vi.fn(async () => true),
      guardDangerousQuery: vi.fn(async () => false),
    });

    expect(result).toBe(false);
  });
});
