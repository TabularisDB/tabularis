/**
 * Hook backing the built-in → plugin driver migration nudge and action.
 *
 * Parameterized by `(builtinId, pluginId)` so the next deprecation (mysql,
 * sqlite) is a new call site, not a redesign. A thin postgres-specific wrapper
 * (`useBuiltinPostgresMigration`) covers this rollout.
 *
 * Owns: connection detection, banner dismissal, the connectivity gate (nudge
 * only when the plugin is installed + active and the registry is reachable),
 * and the migration action itself — auto-disconnect, flip the driver via
 * `update_connection`, run a post-migration `test_connection`, expose undo,
 * record the migration, and surface a toast.
 *
 * Fast Refresh: this file exports only hooks. Pure helpers live in `utils/`.
 */

import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useDatabase } from "./useDatabase";
import { useDrivers } from "./useDrivers";
import useConnectionCatalogue from "./useConnectionCatalogue";
import { useSettings } from "./useSettings";
import { findConnectionsForDrivers } from "../utils/connectionManager";
import type { SavedConnection } from "../contexts/DatabaseContext";

/** Which surface the banner should show. Driven by the connectivity gate. */
export type MigrationBannerVariant = "nudge" | "offline";

/** Result of a migration attempt, driving the toast / undo / report UI. */
export interface MigrationOutcome {
  /** Connection that was migrated. */
  connectionId: string;
  connectionName: string;
  /** "ok" the post-migration test succeeded; "connection" / "process" on failure. */
  status: "ok" | "connection" | "process";
  /** Error message when status !== "ok". */
  error?: string;
}

/** Snapshot of the migration state the banner (and per-connection actions) consume. */
export interface BuiltinDriverMigrationState {
  /** Saved connections still on the built-in driver (the trigger set). */
  builtinConnections: SavedConnection[];
  /** True when at least one saved connection is on the built-in driver. */
  needsMigration: boolean;
  /** True when the replacement plugin is installed and active. */
  pluginReady: boolean;
  /** True when the registry catalogue fetch failed (persistent offline). */
  registryOffline: boolean;
  /** Whether the banner should render and which variant. `null` = hidden. */
  banner: { visible: boolean; variant: MigrationBannerVariant } | null;
  /** Dismiss the banner (persists). */
  dismissBanner: () => void;
  /** Migrate one connection to the plugin. Resolves with the outcome. */
  migrateConnection: (connectionId: string) => Promise<MigrationOutcome>;
  /** Undo a migration: flip the driver back. */
  undoMigration: (connectionId: string) => Promise<void>;
  /** Most recent migration outcome, for the toast / undo surface. */
  lastOutcome: MigrationOutcome | null;
  /** Clear the last outcome (toast dismissed). */
  clearOutcome: () => void;
}

/**
 * Hook for the built-in → plugin migration. Parameterized by driver pair so
 * future deprecations reuse it.
 */
export function useBuiltinDriverMigration(
  builtinId: string,
  pluginId: string,
): BuiltinDriverMigrationState {
  const { connections, loadConnections, disconnect, openConnectionIds, connectionDataMap } =
    useDatabase();
  const { allDrivers, installedPlugins } = useDrivers();
  const { registryOffline } = useConnectionCatalogue();
  const { settings, updateSetting } = useSettings();

  const [lastOutcome, setLastOutcome] = useState<MigrationOutcome | null>(null);

  // Connections still on the built-in driver — the trigger condition and the
  // set eligible to migrate.
  const builtinConnections = useMemo(
    () => connections.filter((c) => c.params.driver === builtinId),
    [connections, builtinId],
  );

  const needsMigration = builtinConnections.length > 0;

  // The plugin is "ready" when it's both installed and active — `useDrivers`
  // returns manifests for installed drivers; `activeExternalDrivers` marks
  // activation. This is the gate that keeps the nudge from outrunning the
  // install (see the design doc's connectivity section).
  const pluginInstalled = useMemo(
    () => installedPlugins.some((p) => p.id === pluginId) || allDrivers.some((d) => d.id === pluginId),
    [installedPlugins, allDrivers, pluginId],
  );
  const pluginActive = useMemo(() => {
    const active = settings.activeExternalDrivers ?? [];
    return active.includes(pluginId);
  }, [settings.activeExternalDrivers, pluginId]);
  const pluginReady = pluginInstalled && pluginActive;

  // Connectivity gate: the nudge only shows when the plugin is present and
  // the registry is reachable. When the registry is offline (persistent
  // failure), the banner either stays suppressed or shows the honest
  // "couldn't be downloaded" variant — never a "Switch to plugin" nudge it
  // can't back up.
  const dismissed = settings.postgresPluginMigrationBannerDismissed === true;
  const banner = useMemo(() => {
    if (!needsMigration || dismissed) return null;
    if (!pluginReady || registryOffline) return { visible: true, variant: "offline" as const };
    return { visible: true, variant: "nudge" as const };
  }, [needsMigration, dismissed, pluginReady, registryOffline]);

  const dismissBanner = useCallback(() => {
    void updateSetting("postgresPluginMigrationBannerDismissed", true);
  }, [updateSetting]);

  const clearOutcome = useCallback(() => setLastOutcome(null), []);

  const recordMigration = useCallback(
    async (connectionId: string, fromDriver: string, toDriver: string) => {
      const history = settings.driverMigrationHistory ?? [];
      await updateSetting("driverMigrationHistory", [
        ...history,
        {
          connectionId,
          fromDriver,
          toDriver,
          // ISO-8601 timestamp of the migration.
          migratedAt: new Date().toISOString(),
          toastDismissed: false,
        },
      ]);
    },
    [settings.driverMigrationHistory, updateSetting],
  );

  // Migrate one connection: auto-disconnect if open, flip the driver, run a
  // post-migration test, and record the outcome. The undo path flips back.
  const migrateConnection = useCallback(
    async (connectionId: string): Promise<MigrationOutcome> => {
      const conn = connections.find((c) => c.id === connectionId);
      const name = conn?.name ?? connectionId;
      const fromDriver = builtinId;

      // Disconnect first if the connection is currently open — reuses the
      // same helper the plugin-uninstall flow uses.
      const openForBuiltin = findConnectionsForDrivers(
        openConnectionIds,
        connectionDataMap,
        [builtinId],
      );
      if (openForBuiltin.includes(connectionId)) {
        await disconnect(connectionId);
      }

      // Flip the driver. `update_connection` handles the persistence; for a
      // connection-URI connection it drops the stored URI on the driver
      // change (by design), which the pre-flight warning (Chunk 4) surfaces
      // before the user ever gets here.
      await invoke("update_connection", {
        id: connectionId,
        name: conn?.name ?? connectionId,
        params: { ...conn?.params, driver: pluginId },
        detectJsonInTextColumns: conn?.detect_json_in_text_columns ? true : null,
        environment: conn?.environment ?? null,
      });
      await loadConnections();
      await recordMigration(connectionId, fromDriver, pluginId);

      // Post-migration test to catch a bad outcome before declaring success.
      try {
        await invoke<string>("test_connection", {
          request: {
            params: { ...conn?.params, driver: pluginId },
            connection_id: connectionId,
          },
        });
        const outcome: MigrationOutcome = {
          connectionId,
          connectionName: name,
          status: "ok",
        };
        setLastOutcome(outcome);
        return outcome;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const outcome: MigrationOutcome = {
          connectionId,
          connectionName: name,
          status: "connection",
          error,
        };
        setLastOutcome(outcome);
        return outcome;
      }
    },
    [
      connections,
      builtinId,
      pluginId,
      openConnectionIds,
      connectionDataMap,
      disconnect,
      loadConnections,
      recordMigration,
    ],
  );

  // Undo: flip the driver back to the built-in and refresh.
  const undoMigration = useCallback(
    async (connectionId: string) => {
      const conn = connections.find((c) => c.id === connectionId);
      await invoke("update_connection", {
        id: connectionId,
        name: conn?.name ?? connectionId,
        params: { ...conn?.params, driver: builtinId },
        detectJsonInTextColumns: conn?.detect_json_in_text_columns ? true : null,
        environment: conn?.environment ?? null,
      });
      await loadConnections();
      setLastOutcome(null);
    },
    [connections, builtinId, loadConnections],
  );

  return {
    builtinConnections,
    needsMigration,
    pluginReady,
    registryOffline,
    banner,
    dismissBanner,
    migrateConnection,
    undoMigration,
    lastOutcome,
    clearOutcome,
  };
}

/** Thin postgres-specific wrapper for the current rollout. */
export function useBuiltinPostgresMigration(): BuiltinDriverMigrationState {
  return useBuiltinDriverMigration("postgres", "postgresql");
}
