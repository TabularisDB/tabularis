import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the four context hooks the migration hook composes, plus `invoke`.
// Each test reconfigures the mock returns to drive the connectivity gate.

const databaseMock = {
  connections: [] as Array<{ id: string; name: string; params: { driver: string } }>,
  loadConnections: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  connect: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
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
    databaseMock.connect.mockClear();
    databaseMock.connect.mockResolvedValue(undefined);
    databaseMock.disconnect.mockClear();
    // Reset invoke to a permissive default; individual tests override.
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(mockInvokeDefault);
  });

  describe("builtinId/pluginId", () => {
    it("exposes the driver pair it was parameterized with", () => {
      // A caller holding only the hook's return value (not the arguments
      // used to create it) still needs the pair — e.g. Connections.tsx
      // builds a driver-specific issue-report URL from it instead of
      // re-hardcoding "postgres"/"postgresql".
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      expect(result.current.builtinId).toBe("postgres");
      expect(result.current.pluginId).toBe("postgresql");
    });
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
      // history record persisted, via the updater-function form (see the
      // "bulk migration" describe block below for why: a plain
      // `[...settings.driverMigrationHistory, record]` read from a stale
      // closure loses earlier records when this runs several times in a
      // row against the same pre-loop snapshot).
      expect(settingsMock.updateSetting).toHaveBeenCalledWith(
        "driverMigrationHistory",
        expect.any(Function),
      );
      const updater = settingsMock.updateSetting.mock.calls[0][1] as (
        prev: unknown[] | undefined,
      ) => unknown[];
      expect(updater(undefined)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ connectionId: "c1", fromDriver: "postgres", toDriver: "postgresql" }),
        ]),
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

    it("reopens a connection that was open before migrating, on a successful outcome", async () => {
      // The confirm dialog promises "it'll be disconnected and reopened" —
      // disconnect alone doesn't fulfill that, connect must actually run.
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      databaseMock.openConnectionIds = ["c1"];
      databaseMock.connectionDataMap = { c1: { driver: "postgres" } };
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      await act(async () => {
        await result.current.migrateConnection("c1");
      });
      expect(databaseMock.disconnect).toHaveBeenCalledWith("c1");
      expect(databaseMock.connect).toHaveBeenCalledWith("c1");
    });

    it("still reopens the connection when the post-migration test fails", async () => {
      // A failed test_connection means the outcome status is "connection", not
      // "ok" — but the connection was still disconnected to run the flip, so
      // it must still be reopened (reopening surfaces its own error via
      // connectionDataMap, independent of the migration outcome).
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      databaseMock.openConnectionIds = ["c1"];
      databaseMock.connectionDataMap = { c1: { driver: "postgres" } };
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
      expect(databaseMock.connect).toHaveBeenCalledWith("c1");
    });

    it("does not reconnect a connection that was already closed", async () => {
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      // Not in openConnectionIds — the connection was already closed.
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      await act(async () => {
        await result.current.migrateConnection("c1");
      });
      expect(databaseMock.disconnect).not.toHaveBeenCalled();
      expect(databaseMock.connect).not.toHaveBeenCalled();
    });

    it("resolves the migration outcome even when the reconnect itself fails", async () => {
      // A reconnect failure surfaces through connectionDataMap[id].error (the
      // existing UI path for a failed connection), not by corrupting the
      // migration outcome — the migration itself still succeeded.
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      databaseMock.openConnectionIds = ["c1"];
      databaseMock.connectionDataMap = { c1: { driver: "postgres" } };
      databaseMock.connect.mockRejectedValueOnce(new Error("host unreachable"));
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      let outcome;
      await act(async () => {
        outcome = await result.current.migrateConnection("c1");
      });
      expect(outcome.status).toBe("ok");
      expect(databaseMock.connect).toHaveBeenCalledWith("c1");
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

    it("resolves a failed outcome instead of rejecting when update_connection itself throws", async () => {
      // e.g. the connection was deleted concurrently and the backend's
      // update_connection returns Err("Connection not found"). migrateConnection
      // must never reject — a caller looping over many connections would abort
      // the batch and never reach setMigrating(false) otherwise.
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "update_connection") return Promise.reject(new Error("Connection not found"));
        return mockInvokeDefault(cmd);
      });
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      let outcome;
      await act(async () => {
        outcome = await result.current.migrateConnection("c1");
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toContain("Connection not found");
    });

    it("resolves a failed outcome when get_registered_drivers itself throws", async () => {
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1")];
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "get_registered_drivers") return Promise.reject(new Error("IPC error"));
        return mockInvokeDefault(cmd);
      });
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      let outcome;
      await act(async () => {
        outcome = await result.current.migrateConnection("c1");
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toContain("IPC error");
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

    it("appends every record when migrateConnection runs several times in a row, like the checklist's bulk loop", async () => {
      // Regression for the bulk-migration history-loss bug: MigrationChecklistModal
      // calls migrateConnection once per checked connection, sequentially, all
      // from the same render — so recordMigration must append onto whatever
      // updateSetting's own functional update sees as current, not onto a
      // `settings.driverMigrationHistory` value captured once before the loop
      // started (that would make every write but the last silently overwrite
      // the ones before it). Simulate updateSetting's real behavior — an
      // updater function reads the *current* accumulated history — rather
      // than the plain mock the other tests use.
      setPluginReady(true);
      databaseMock.connections = [builtinConn("c1"), builtinConn("c2"), builtinConn("c3")];
      let history: unknown[] = [];
      settingsMock.updateSetting.mockImplementation((key: string, valueOrUpdater: unknown) => {
        if (key === "driverMigrationHistory" && typeof valueOrUpdater === "function") {
          history = (valueOrUpdater as (prev: unknown[]) => unknown[])(history);
        }
        return Promise.resolve();
      });

      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      await act(async () => {
        await result.current.migrateConnection("c1");
        await result.current.migrateConnection("c2");
        await result.current.migrateConnection("c3");
      });

      expect(history).toHaveLength(3);
      expect(history).toEqual([
        expect.objectContaining({ connectionId: "c1" }),
        expect.objectContaining({ connectionId: "c2" }),
        expect.objectContaining({ connectionId: "c3" }),
      ]);
    });
  });

  describe("undoMigration", () => {
    it("flips the driver back to the built-in and resolves ok: true", async () => {
      // After a migration, the connection's driver is the plugin; undo reverts.
      databaseMock.connections = [{ id: "c1", name: "c1", params: { driver: "postgresql" } }];
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      let outcome;
      await act(async () => {
        outcome = await result.current.undoMigration("c1");
      });
      expect(invoke).toHaveBeenCalledWith(
        "update_connection",
        expect.objectContaining({ id: "c1", params: expect.objectContaining({ driver: "postgres" }) }),
      );
      expect(outcome).toEqual({ ok: true });
    });

    it("resolves ok: false with the error instead of rejecting when update_connection throws", async () => {
      // Same never-reject contract as migrateConnection: the caller (a toast
      // action button, no surrounding try/catch) needs a value to check, not
      // an unhandled rejection.
      databaseMock.connections = [{ id: "c1", name: "c1", params: { driver: "postgresql" } }];
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "update_connection") return Promise.reject(new Error("Connection not found"));
        return mockInvokeDefault(cmd);
      });
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      let outcome;
      await act(async () => {
        outcome = await result.current.undoMigration("c1");
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain("Connection not found");
    });

    it("disconnects and reopens a connection that was open (on the plugin id) before undoing", async () => {
      databaseMock.connections = [{ id: "c1", name: "c1", params: { driver: "postgresql" } }];
      // Undo runs after a completed migration, so the connection is open
      // under the plugin id, not the builtin id — the lookup must reflect
      // that (the inverse of migrateConnection's [builtinId] lookup).
      databaseMock.openConnectionIds = ["c1"];
      databaseMock.connectionDataMap = { c1: { driver: "postgresql" } };
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      await act(async () => {
        await result.current.undoMigration("c1");
      });
      expect(databaseMock.disconnect).toHaveBeenCalledWith("c1");
      expect(databaseMock.connect).toHaveBeenCalledWith("c1");
    });

    it("still disconnects/reconnects when called from a closure captured before the connection was open", async () => {
      // Regression: Connections.tsx's outcome toast builds its "Undo" action
      // (which closes over whichever undoMigration reference the hook
      // returned) at the moment migrateConnection is *called* — before the
      // driver flip, disconnect, and reconnect that migrateConnection itself
      // performs have run. If undoMigration read connectionDataMap through
      // its own useCallback closure, that closure would be permanently fixed
      // to "connection not open under the plugin id yet" from that early
      // render, so undo's own [pluginId] lookup would always find nothing —
      // wasOpen always false — even though the connection is live and open
      // on the plugin by the time the user actually clicks Undo.
      databaseMock.connections = [{ id: "c1", name: "c1", params: { driver: "postgres" } }];
      databaseMock.openConnectionIds = [];
      databaseMock.connectionDataMap = {};
      const { result, rerender } = renderHook(() =>
        useBuiltinDriverMigration("postgres", "postgresql"),
      );
      const staleUndoMigration = result.current.undoMigration;

      // Simulate the migration completing: driver flips, connection reopens
      // under the plugin id, and the provider re-renders with fresh state —
      // exactly what happens between the toast being built and the user
      // clicking its Undo action.
      databaseMock.connections = [{ id: "c1", name: "c1", params: { driver: "postgresql" } }];
      databaseMock.openConnectionIds = ["c1"];
      databaseMock.connectionDataMap = { c1: { driver: "postgresql" } };
      rerender();

      await act(async () => {
        await staleUndoMigration("c1");
      });

      expect(databaseMock.disconnect).toHaveBeenCalledWith("c1");
      expect(databaseMock.connect).toHaveBeenCalledWith("c1");
    });

    it("does not disconnect/reconnect a connection that was already closed", async () => {
      databaseMock.connections = [{ id: "c1", name: "c1", params: { driver: "postgresql" } }];
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      await act(async () => {
        await result.current.undoMigration("c1");
      });
      expect(databaseMock.disconnect).not.toHaveBeenCalled();
      expect(databaseMock.connect).not.toHaveBeenCalled();
    });

    it("resolves ok: true even when the reconnect itself fails", async () => {
      databaseMock.connections = [{ id: "c1", name: "c1", params: { driver: "postgresql" } }];
      databaseMock.openConnectionIds = ["c1"];
      databaseMock.connectionDataMap = { c1: { driver: "postgresql" } };
      databaseMock.connect.mockRejectedValueOnce(new Error("host unreachable"));
      const { result } = renderHook(() => useBuiltinDriverMigration("postgres", "postgresql"));
      let outcome;
      await act(async () => {
        outcome = await result.current.undoMigration("c1");
      });
      expect(outcome).toEqual({ ok: true });
      expect(databaseMock.connect).toHaveBeenCalledWith("c1");
    });
  });
});
