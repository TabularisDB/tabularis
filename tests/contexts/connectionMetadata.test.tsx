import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DatabaseProvider } from "../../src/contexts/DatabaseProvider";
import { useDatabase } from "../../src/hooks/useDatabase";
import type { ConnectionMetadata, DriverCapabilities } from "../../src/types/plugins";

const { events } = vi.hoisted(() => ({ events: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: { payload: unknown }) => void) => {
    events.set(name, callback);
    return Promise.resolve(() => events.delete(name));
  }),
}));
vi.mock("../../src/utils/autocomplete", () => ({ clearAutocompleteCache: vi.fn() }));
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { activeExternalDrivers: ["jdbc"] }, isLoading: false }),
}));

const capabilities: DriverCapabilities = {
  schemas: false, views: true, routines: false, file_based: false,
  folder_based: false, single_database: true, identifier_quote: '"',
  alter_primary_key: false, manage_tables: false, sql_dialect: "generic",
};
const metadata = (pg: boolean): ConnectionMetadata => ({
  capabilities: { ...capabilities, schemas: pg, views: false, sql_dialect: pg ? "postgres" : "mysql" },
  data_types: [{ name: pg ? "JSONB" : "JSON", category: "json", requires_length: false,
    requires_precision: false, supports_auto_increment: false }],
  type_mappings: { JSON: pg ? "JSONB" : "JSON" },
});
const connections = ["pg", "mysql"].map(id => ({
  id, name: id, params: { driver: "jdbc", database: "example" },
}));

function defaultInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case "get_connections": return Promise.resolve(connections);
    case "get_connections_with_groups": return Promise.resolve({ connections, groups: [] });
    case "get_driver_manifest": return Promise.resolve({ id: "jdbc", capabilities, connection_metadata: true });
    case "get_connection_metadata": return Promise.resolve(metadata(args?.connectionId === "pg"));
    case "get_schemas": return Promise.resolve(["public"]);
    case "get_selected_schemas": return Promise.resolve([]);
    case "get_tables": return Promise.resolve([{ name: "example" }]);
    case "get_active_connections": return Promise.resolve([]);
    default: return Promise.resolve(undefined);
  }
}

const wrapper = ({ children }: { children: React.ReactNode }) => <DatabaseProvider>{children}</DatabaseProvider>;

describe("connection metadata discovery", () => {
  beforeEach(() => {
    events.clear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command, args) => defaultInvoke(command, args as Record<string, unknown>));
  });

  it("keeps metadata separate for two connections using one driver", async () => {
    const { result } = renderHook(() => useDatabase(), { wrapper });
    await act(async () => result.current.connect("pg"));
    await act(async () => result.current.connect("mysql"));
    expect(result.current.connectionDataMap.pg.capabilities?.schemas).toBe(true);
    expect(result.current.connectionDataMap.mysql.capabilities?.schemas).toBe(false);
    expect(result.current.connectionDataMap.pg.metadata?.data_types[0].name).toBe("JSONB");
    expect(result.current.activeCapabilities?.sql_dialect).toBe("mysql");
    expect(result.current.connectionDataMap.pg.needsSchemaSelection).toBe(true);
    expect(result.current.connectionDataMap.mysql.tables).toEqual([{ name: "example" }]);
    expect(invoke).not.toHaveBeenCalledWith("get_views", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("get_routines", expect.anything());
  });

  it("does not request discovery for a static manifest", async () => {
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_driver_manifest"
      ? Promise.resolve({ id: "jdbc", capabilities: { ...capabilities, schemas: true } })
      : defaultInvoke(command, args as Record<string, unknown>));
    const { result } = renderHook(() => useDatabase(), { wrapper });
    await act(async () => result.current.connect("pg"));
    expect(invoke).not.toHaveBeenCalledWith("get_connection_metadata", expect.anything());
    expect(result.current.connectionDataMap.pg.metadata).toBeUndefined();
    await act(async () => events.get("connection-metadata-invalidated")?.({ payload: { driverId: "jdbc" } }));
    expect(result.current.openConnectionIds).toEqual(["pg"]);
  });

  it("surfaces discovery errors before loading database objects", async () => {
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_connection_metadata"
      ? Promise.reject(new Error("Discovery permission denied"))
      : defaultInvoke(command, args as Record<string, unknown>));
    const { result } = renderHook(() => useDatabase(), { wrapper });
    await act(async () => {
      await expect(result.current.connect("pg")).rejects.toThrow("Discovery permission denied");
    });
    expect(result.current.openConnectionIds).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith("get_schemas", expect.anything());
  });

  it("discards discovery that completes after disconnect", async () => {
    let finish: (value: ConnectionMetadata) => void = () => {};
    let started: () => void = () => {};
    const discoveryStarted = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(invoke).mockImplementation((command, args) => command === "get_connection_metadata"
      ? new Promise(resolve => { finish = resolve as (value: ConnectionMetadata) => void; started(); })
      : defaultInvoke(command, args as Record<string, unknown>));
    const { result } = renderHook(() => useDatabase(), { wrapper });
    let connecting: Promise<void> = Promise.resolve();
    await act(async () => { connecting = result.current.connect("pg"); await discoveryStarted; });
    await act(async () => result.current.disconnect("pg"));
    await act(async () => { finish(metadata(true)); await connecting; });
    expect(result.current.connectionDataMap.pg).toBeUndefined();
    expect(result.current.openConnectionIds).toEqual([]);
  });

  it("invalidates only the edited connection and clears both on plugin reload", async () => {
    const { result } = renderHook(() => useDatabase(), { wrapper });
    await act(async () => result.current.connect("pg"));
    await act(async () => result.current.connect("mysql"));
    await act(async () => events.get("connection-metadata-invalidated")?.({ payload: { connectionId: "pg" } }));
    expect(result.current.connectionDataMap.pg).toBeUndefined();
    expect(result.current.connectionDataMap.mysql.metadata).toBeDefined();
    await act(async () => events.get("connection-metadata-invalidated")?.({ payload: { driverId: "jdbc" } }));
    expect(result.current.openConnectionIds).toEqual([]);
    expect(result.current.activeCapabilities).toBeNull();
  });
});
