import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DatabaseContext, type DatabaseContextType } from "../../src/contexts/DatabaseContext";
import { useDataTypes } from "../../src/hooks/useDataTypes";
import type { DataTypeInfo, DataTypeRegistry } from "../../src/types/dataTypes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const type = (name: string): DataTypeInfo => ({
  name, category: "json", requires_length: false,
  requires_precision: false, supports_auto_increment: false,
});

const context = (activeConnectionId: string, pgTypes: DataTypeInfo[] = [type("JSONB")]) => ({
  activeConnectionId,
  connectionDataMap: {
    pg: { driver: "jdbc", metadata: { data_types: pgTypes } },
    mysql: { driver: "jdbc", metadata: { data_types: [type("JSON")] } },
  },
} as unknown as DatabaseContextType);

describe("useDataTypes", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("switches types immediately between connections sharing a driver", () => {
    let value = context("pg");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
    );
    const { result, rerender } = renderHook(() => useDataTypes("jdbc"), { wrapper });
    expect(result.current.dataTypes?.types[0].name).toBe("JSONB");
    value = context("mysql");
    rerender();
    expect(result.current.dataTypes?.types[0].name).toBe("JSON");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses an explicit connection instead of the active one", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={context("mysql")}>{children}</DatabaseContext.Provider>
    );
    const { result } = renderHook(() => useDataTypes("jdbc", "pg"), { wrapper });
    expect(result.current.dataTypes?.types[0].name).toBe("JSONB");
  });

  it("preserves an explicitly empty dynamic type list", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={context("pg", [])}>{children}</DatabaseContext.Provider>
    );
    const { result } = renderHook(() => useDataTypes("jdbc"), { wrapper });
    expect(result.current.dataTypes?.types).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the static get_data_types request shape", async () => {
    vi.mocked(invoke).mockResolvedValue({ driver: "static-test", types: [type("TEXT")] });
    const { result } = renderHook(() => useDataTypes("static-test"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invoke).toHaveBeenCalledExactlyOnceWith("get_data_types", { driver: "static-test" });
    expect(result.current.dataTypes?.types[0].name).toBe("TEXT");
  });

  it("discards a late response for a previous driver", async () => {
    let finish: (value: DataTypeRegistry) => void = () => {};
    vi.mocked(invoke).mockImplementation((_command, args) => args?.driver === "slow-test"
      ? new Promise(resolve => { finish = resolve as (value: DataTypeRegistry) => void; })
      : Promise.resolve({ driver: "fast-test", types: [type("JSON")] }));
    const { result, rerender } = renderHook(({ driver }) => useDataTypes(driver), {
      initialProps: { driver: "slow-test" },
    });
    rerender({ driver: "fast-test" });
    await waitFor(() => expect(result.current.dataTypes?.driver).toBe("fast-test"));
    await act(async () => finish({ driver: "slow-test", types: [type("STALE")] }));
    expect(result.current.dataTypes?.driver).toBe("fast-test");
  });

  it("reuses static types when a second consumer mounts", async () => {
    vi.mocked(invoke).mockResolvedValue({ driver: "cached-static", types: [type("TEXT")] });
    const first = renderHook(() => useDataTypes("cached-static"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() => useDataTypes("cached-static"));
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.dataTypes?.types[0].name).toBe("TEXT");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
