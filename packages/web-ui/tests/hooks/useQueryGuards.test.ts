import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQueryGuards } from "../../src/hooks/useQueryGuards";

const guardState = vi.hoisted(() => ({
  connections: [] as Array<{
    id: string;
    environment?: "development" | "staging" | "production";
  }>,
  guardProduction: vi.fn(
    async (
      _connectionId: string | null | undefined,
      _sql?: string,
    ): Promise<boolean> => true,
  ),
}));

vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ connections: guardState.connections }),
}));

vi.mock("../../src/hooks/useProductionGuard", () => ({
  useProductionGuard: () => guardState.guardProduction,
}));

describe("useQueryGuards", () => {
  beforeEach(() => {
    guardState.connections = [];
    guardState.guardProduction.mockReset();
    guardState.guardProduction.mockResolvedValue(true);
  });

  it("runs the production guard before opening a dangerous-query prompt", async () => {
    guardState.connections = [
      { id: "dev-id", environment: "development" },
    ];
    const { result } = renderHook(() => useQueryGuards("dev-id"));

    let confirmation!: Promise<boolean>;
    await act(async () => {
      confirmation = result.current.guardQuery("DROP TABLE users");
      await Promise.resolve();
    });

    expect(guardState.guardProduction).toHaveBeenCalledWith(
      "dev-id",
      "DROP TABLE users",
    );
    expect(result.current.pending?.kind).toBe("drop");

    let allowed: boolean | undefined;
    await act(async () => {
      result.current.resolve(false);
      allowed = await confirmation;
    });
    expect(allowed).toBe(false);
  });

  it("stops before the dangerous-query guard when production blocks", async () => {
    guardState.connections = [
      { id: "prod-id", environment: "production" },
    ];
    guardState.guardProduction.mockResolvedValue(false);
    const { result } = renderHook(() => useQueryGuards("prod-id"));

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.guardQuery("DROP TABLE users");
    });

    expect(allowed).toBe(false);
    expect(result.current.pending).toBeNull();
  });

  it("uses only the production guard for dangerous production queries", async () => {
    guardState.connections = [
      { id: "prod-id", environment: "production" },
    ];
    const { result } = renderHook(() => useQueryGuards("prod-id"));

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.guardQuery("DELETE FROM users");
    });

    expect(allowed).toBe(true);
    expect(guardState.guardProduction).toHaveBeenCalledWith(
      "prod-id",
      "DELETE FROM users",
    );
    expect(result.current.pending).toBeNull();
  });

  it("serializes batch SQL for production while preserving statements for danger checks", async () => {
    guardState.connections = [
      { id: "dev-id", environment: "development" },
    ];
    const { result } = renderHook(() => useQueryGuards("dev-id"));
    const queries = ["SELECT 1", "DROP TABLE users"];

    let confirmation!: Promise<boolean>;
    await act(async () => {
      confirmation = result.current.guardQuery(queries);
      await Promise.resolve();
    });

    expect(guardState.guardProduction).toHaveBeenCalledWith(
      "dev-id",
      "SELECT 1;\nDROP TABLE users",
    );
    expect(result.current.pending).toMatchObject({
      kind: "drop",
      sql: "DROP TABLE users",
      count: 1,
    });

    await act(async () => {
      result.current.resolve(true);
      await confirmation;
    });
  });
});
