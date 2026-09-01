import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the four context hooks the migration hook composes, plus `invoke`.
// Each test reconfigures the mock returns to drive the connectivity gate.

const databaseMock = {
  connections: [] as Array<{ id: string; name: string; params: { driver: string } }>,
  loadConnections: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  disconnect: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
  openConnectionIds: [] as string[],
  connectionDataMap: {} as Record<string, { driver: string } | undefined>,
};

const driversMock = {
  drivers: [],
  allDrivers: [] as Array<{ id: string }>,
  installedPlugins: [] as Array<{ id: string }>,
  loading: false,
  error: null,
  refresh: vi.fn(),
};

const catalogueMock = { groups: [], facets: [], loading: false, registryOffline: false, refresh: vi.fn() };
const settingsMock = { settings: {}, updateSetting: vi.fn<(k: string, v: unknown) => Promise<void>>().mockResolvedValue(undefined) };

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => databaseMock,
}));
vi.mock("../../src/hooks/useDrivers", () => ({
  useDrivers: () => driversMock,
}));
vi.mock("../../src/hooks/useConnectionCatalogue", () => ({
  useConnectionCatalogue: () => catalogueMock,
}));
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => settingsMock,
}));

import { useBuiltinDriverMigration } from "../../src/hooks/useBuiltinDriverMigration";
import { invoke } from "@tauri-apps/api/core";

const builtinConn = (id: string) => ({ id, name: id, params: { driver: "postgres" } });

/** Default per-command invoke behavior: the plugin is registered and
 * test_connection succeeds. Individual tests override specific commands via
 * a custom mockImplementation. */
const mockInvokeDefault = (cmd: string) => {
  if (cmd === "get_registered_drivers") return Promise.resolve([{ id: "postgresql" }]);
  if (cmd === "get_plugin_startup_errors") return Promise.resolve([]);
  return Promise.resolve("ok");
};

const setPluginReady = (ready: boolean) => {
  driversMock.installedPlugins = ready ? [{ id: "postgresql" }] : [];
  driversMock.allDrivers = ready ? [{ id: "postgresql" }] : [];
  settingsMock.settings = ready ? { activeExternalDrivers: ["postgresql"] } : {};
};

describe("useBuiltinDriverMigration", () => {
  beforeEach(() => {
    databaseMock.connections = [];
    databaseMock.openConnectionIds = [];
    databaseMock.connectionDataMap = {};
    driversMock.installedPlugins = [];
    driversMock.allDrivers = [];
    catalogueMock.registryOffline = false;
    settingsMock.settings = {};
    settingsMock.updateSetting.mockClear();
    settingsMock.updateSetting.mockResolvedValue(undefined);
    databaseMock.loadConnections.mockClear();
    databaseMock.disconnect.mockClear();
    // Reset invoke to a permissive default; individual tests override.
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(mockInvokeDefault);
  });

  describe("banner gating", () => {
    it("stays hidden when no connection is on the built-in driver", () => {
      setPluginReady(true);
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      expect(result.current.banner).toBeNull();
      expect(result.current.needsMigration).toBe(false);
    });

    it("shows the nudge when a built-in connection exists, plugin is ready, registry reachable", () => {
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      expect(result.current.needsMigration).toBe(true);
      expect(result.current.banner?.visible).toBe(true);
      expect(result.current.banner?.variant).toBe("nudge");
    });

    it("stays hidden once dismissed for the connections that triggered it", () => {
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      settingsMock.settings = {
        activeExternalDrivers: ["postgresql"],
        postgresPluginMigrationBannerDismissed: true,
        postgresPluginMigrationBannerDismissedFor: ["c1"],
      };
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      expect(result.current.banner).toBeNull();
    });

    it("resurfaces when a new built-in connection appears after dismissal", () => {
      // Dismissal is the deliberate opt-out, but only for the connections that
      // existed at the time — a genuinely new trigger (a second builtin
      // connection the user hadn't dismissed for) must resurface the banner,
      // the same "did-the-condition-change" gating WhatsNewModal uses.
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1"), builtinConn("c2")];
      settingsMock.settings = {
        activeExternalDrivers: ["postgresql"],
        postgresPluginMigrationBannerDismissed: true,
        postgresPluginMigrationBannerDismissedFor: ["c1"], // c2 is new
      };
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      expect(result.current.banner?.visible).toBe(true);
      expect(result.current.banner?.variant).toBe("nudge");
    });

    it("shows the offline variant when the registry is offline, not the nudge", () => {
      // The connectivity gate: the nudge can't outrun the install. Even with a
      // built-in connection, an offline registry yields the honest "couldn't
      // be downloaded" message, never a "Switch to plugin" nudge.
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      catalogueMock.registryOffline = true;
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      expect(result.current.banner?.variant).toBe("offline");
    });

    it("shows the offline variant when the plugin is not installed/active", () => {
      // No point nudging toward a migration that can't succeed without the plugin.
      databaseMock.connections = [builtinConn("c1")];
      setPluginReady(false);
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      expect(result.current.banner?.variant).toBe("offline");
      expect(result.current.pluginReady).toBe(false);
    });
  });

  describe("dismissal", () => {
    it("persists dismissal and records which connections it applies to", async () => {
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      await act(async () => {
        result.current.dismissBanner();
      });
      expect(settingsMock.updateSetting).toHaveBeenCalledWith(
        "postgresPluginMigrationBannerDismissed",
        true,
      );
      expect(settingsMock.updateSetting).toHaveBeenCalledWith(
        "postgresPluginMigrationBannerDismissedFor",
        ["c1"],
      );
    });
  });

  describe("migrateConnection", () => {
    it("flips the driver, runs a post-migration test, and records an ok outcome", async () => {
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));

      let outcome;
      await act(async () => {
        outcome = await result.current.migrateConnection("c1");
      });

      expect(outcome.status).toBe("ok");
      // update_connection was invoked with the flipped driver.
      expect(invoke).toHaveBeenCalledWith(
        "update_connection",
        expect.objectContaining({ id: "c1", params: expect.objectContaining({ driver: "postgresql" }) }),
      );
      // post-migration test_connection was invoked.
      expect(invoke).toHaveBeenCalledWith(
        "test_connection",
        expect.objectContaining({ request: expect.objectContaining({ connection_id: "c1" }) }),
      );
      // history record persisted.
      expect(settingsMock.updateSetting).toHaveBeenCalledWith(
        "driverMigrationHistory",
        expect.arrayContaining([expect.objectContaining({ connectionId: "c1", fromDriver: "postgres", toDriver: "postgresql" })]),
      );
    });

    it("disconnects an open built-in connection before flipping the driver", async () => {
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      databaseMock.openConnectionIds = ["c1"];
      databaseMock.connectionDataMap = { c1: { driver: "postgres" } };
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      await act(async () => {
        await result.current.migrateConnection("c1");
      });
      expect(databaseMock.disconnect).toHaveBeenCalledWith("c1");
    });

    it("records a connection-level failure when the post-migration test throws", async () => {
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      // update_connection succeeds, the plugin is registered; only the
      // post-migration test_connection fails.
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "test_connection") return Promise.reject("connection refused");
        return mockInvokeDefault(cmd);
      });
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      let outcome;
      await act(async () => {
        outcome = await result.current.migrateConnection("c1");
      });
      expect(outcome.status).toBe("connection");
      expect(outcome.error).toContain("connection refused");
    });

    it("records a process-level failure when the plugin isn't registered after the flip", async () => {
      // The registry never picked up the driver — a plugin startup failure,
      // not a connection problem. test_connection must not be attempted.
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "get_registered_drivers") return Promise.resolve([]); // plugin absent
        if (cmd === "get_plugin_startup_errors") {
          return Promise.resolve([{ plugin_id: "postgresql", error: "no such interpreter" }]);
        }
        if (cmd === "test_connection") {
          throw new Error("test_connection must not be called when the plugin never started");
        }
        return mockInvokeDefault(cmd);
      });
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      let outcome;
      await act(async () => {
        outcome = await result.current.migrateConnection("c1");
      });
      expect(outcome.status).toBe("process");
      expect(outcome.startupError).toBe("no such interpreter");
      expect(outcome.pluginId).toBe("postgresql");
    });
  });

  describe("undoMigration", () => {
    it("flips the driver back to the built-in", async () => {
      // After a migration, the connection's driver is the plugin; undo reverts.
      databaseMock.connections = [{ id: "c1", name: "c1", params: { driver: "postgresql" } }];
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      await act(async () => {
        await result.current.undoMigration("c1");
      });
      expect(invoke).toHaveBeenCalledWith(
        "update_connection",
        expect.objectContaining({ id: "c1", params: expect.objectContaining({ driver: "postgres" }) }),
      );
    });
  });
});
