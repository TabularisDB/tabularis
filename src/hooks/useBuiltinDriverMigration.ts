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
 * `update_connection`, run a post-migration `test_connection`, reopen if it
 * was open before, expose undo (the same disconnect/flip/reopen in reverse),
 * and record the migration. Deliberately does NOT own toast display —
 * `migrateConnection`/`undoMigration` resolve with an outcome and leave it to
 * the caller (a toast in `Connections.tsx`; per-row status in
 * `MigrationChecklistModal`) to decide what to do with it.
 *
 * Fast Refresh: this file exports only hooks. Pure helpers live in `utils/`.
 */

import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useDatabase } from "./useDatabase";
import { useDrivers } from "./useDrivers";
import { useConnectionCatalogue } from "./useConnectionCatalogue";
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
  /** "ok" the post-migration test succeeded; "connection" / "process" on an
   * expected failure. "failed" is the catch-all for anything unexpected
   * before that point (e.g. the connection was deleted concurrently, or
   * `update_connection` itself rejected) — `migrateConnection` never throws,
   * it resolves to this instead, so a bulk-migration loop can't abort or
   * wedge on one connection's failure. */
  status: "ok" | "connection" | "process" | "failed";
  /** Error message when status === "connection" or "failed". */
  error?: string;
  /** Startup error text when status === "process", if the plugin reported one. */
  startupError?: string;
  /** Plugin id, needed to word/build the process-level failure and issue report. */
  pluginId?: string;
}

/** Result of an undo attempt. `undoMigration` never throws either — callers
 * check `ok` and surface `error` themselves (there's no outcome-toast
 * plumbing for undo the way there is for `migrateConnection`). */
export interface UndoOutcome {
  ok: boolean;
  error?: string;
}

/** Snapshot of the migration state the banner (and per-connection actions) consume. */
export interface BuiltinDriverMigrationState {
  /** The built-in driver id this instance was parameterized with (e.g.
   * `"postgres"`). Exposed so a caller that only holds the hook's return
   * value — not the `(builtinId, pluginId)` arguments used to create it —
   * can still build driver-specific UI (e.g. an issue-report URL) without
   * re-hardcoding the pair the hook itself is already parameterized by. */
  builtinId: string;
  /** The replacement plugin id this instance was parameterized with (e.g.
   * `"postgresql"`). See `builtinId`. */
  pluginId: string;
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
  /** Migrate one connection to the plugin. Never rejects — resolves with the
   * outcome (including unexpected failures, as `status: "failed"`), so the
   * caller decides what to do with it (e.g. Connections.tsx shows a toast;
   * MigrationChecklistModal's bulk loop drives its own per-row status UI
   * instead — deliberately not both, see the resolver's own comments). */
  migrateConnection: (connectionId: string) => Promise<MigrationOutcome>;
  /** Undo a migration: flip the driver back. Never rejects — resolves with
   * `{ ok: false, error }` on failure so the caller can surface it. */
  undoMigration: (connectionId: string) => Promise<UndoOutcome>;
}

/**
 * Hook for the built-in → plugin migration. Parameterized by driver pair so
 * future deprecations reuse it.
 */
export function useBuiltinDriverMigration(
  builtinId: string,
  pluginId: string,
): BuiltinDriverMigrationState {
  const { connections, loadConnections, connect, disconnect, openConnectionIds, connectionDataMap } =
    useDatabase();
  const { allDrivers, installedPlugins } = useDrivers();
  const { registryOffline } = useConnectionCatalogue();
  const { settings, updateSetting } = useSettings();

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
  //
  // Dismissal is the deliberate opt-out (no separate "don't show again"
  // checkbox) — but it only holds for the connections that existed at
  // dismissal time. A builtin connection id not in
  // `postgresPluginMigrationBannerDismissedFor` means the trigger condition
  // changed since the dismissal, so the banner resurfaces — the same
  // "did-the-condition-change" gating `WhatsNewModal` uses for its own
  // version comparison.
  const dismissedForIds = settings.postgresPluginMigrationBannerDismissedFor ?? [];
  const dismissed =
    settings.postgresPluginMigrationBannerDismissed === true &&
    builtinConnections.every((c) => dismissedForIds.includes(c.id));
  const banner = useMemo(() => {
    if (!needsMigration || dismissed) return null;
    if (!pluginReady || registryOffline) return { visible: true, variant: "offline" as const };
    return { visible: true, variant: "nudge" as const };
  }, [needsMigration, dismissed, pluginReady, registryOffline]);

  const dismissBanner = useCallback(() => {
    // Sequential and awaited, not fire-and-forget in parallel: updateSetting
    // merges against a snapshot of state captured at call time, so two
    // concurrent calls can each start from the same stale snapshot and the
    // second write silently drops the first's field. Awaiting serializes them.
    void (async () => {
      await updateSetting("postgresPluginMigrationBannerDismissed", true);
      await updateSetting(
        "postgresPluginMigrationBannerDismissedFor",
        builtinConnections.map((c) => c.id),
      );
    })();
  }, [updateSetting, builtinConnections]);

  const recordMigration = useCallback(
    async (connectionId: string, fromDriver: string, toDriver: string) => {
      // Updater form, not `[...settings.driverMigrationHistory, record]`:
      // MigrationChecklistModal's bulk loop calls `migrateConnection` (and
      // therefore this) repeatedly in a tight sequence, all against the same
      // `settings` snapshot from whichever render started the loop. Reading
      // `prev` inside `updateSetting`'s own functional update means each
      // call appends onto the result of the write immediately before it,
      // not onto that one shared pre-loop snapshot — otherwise every write
      // but the last silently discards the ones before it.
      await updateSetting("driverMigrationHistory", (prev) => [
        ...(prev ?? []),
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
    [updateSetting],
  );

  // Migrate one connection: auto-disconnect if open, flip the driver, run a
  // post-migration test, reopen if it was open before, and record the
  // outcome. The undo path mirrors this (see below). Never rejects: every
  // awaited call up through the driver-flip is wrapped, so a bulk caller
  // looping over many connections can't have one failure abort the batch or
  // leave its own loop state (e.g. a "migrating" flag) stuck permanently on.
  const migrateConnection = useCallback(
    async (connectionId: string): Promise<MigrationOutcome> => {
      const conn = connections.find((c) => c.id === connectionId);
      const name = conn?.name ?? connectionId;
      const fromDriver = builtinId;

      // Disconnect first if the connection is currently open — reuses the
      // same helper the plugin-uninstall flow uses. Captured before the flow
      // runs so the reconnect below only fires when this call actually
      // closed the connection, not on every outcome unconditionally (e.g. a
      // connection that was already closed has nothing to reopen).
      const openForBuiltin = findConnectionsForDrivers(
        openConnectionIds,
        connectionDataMap,
        [builtinId],
      );
      const wasOpen = openForBuiltin.includes(connectionId);
      let disconnected = false;

      // The rest of the outcome logic is unchanged from before reconnect
      // support — extracted into `run` so every one of its several early
      // `return outcome` statements returns from `run`, not from
      // `migrateConnection`, letting the single reconnect attempt below run
      // exactly once regardless of which branch produced the outcome.
      const run = async (): Promise<MigrationOutcome> => {
        try {
          if (wasOpen) {
            await disconnect(connectionId);
            disconnected = true;
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
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          const outcome: MigrationOutcome = {
            connectionId,
            connectionName: name,
            status: "failed",
            error,
            pluginId,
          };
          return outcome;
        }

        // The plugin process never starting is a different failure than the
        // connection itself failing — detectable because the registry never
        // picked up the driver (get_registered_drivers won't list it), rather
        // than by relying solely on get_plugin_startup_errors()'s one-shot
        // drain (which PluginsTab's own mount effect may have already emptied)
        // to detect the failure. Skipping the connection test in this case
        // avoids attributing a plugin-startup failure to the connection's own
        // credentials.
        let registeredDrivers: Array<{ id: string }>;
        try {
          registeredDrivers = await invoke<Array<{ id: string }>>("get_registered_drivers");
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          const outcome: MigrationOutcome = {
            connectionId,
            connectionName: name,
            status: "failed",
            error,
            pluginId,
          };
          return outcome;
        }
        const pluginRegistered = registeredDrivers.some((d) => d.id === pluginId);
        if (!pluginRegistered) {
          // Best-effort: if the drain still has this plugin's error (nobody
          // else read it first), surface the specific message; otherwise fall
          // back to a generic one in the UI.
          let startupError: string | undefined;
          try {
            const startupErrors = await invoke<Array<{ plugin_id: string; error: string }>>(
              "get_plugin_startup_errors",
            );
            startupError = startupErrors.find((e) => e.plugin_id === pluginId)?.error;
          } catch {
            // Non-fatal — the UI falls back to a generic message.
          }
          const outcome: MigrationOutcome = {
            connectionId,
            connectionName: name,
            status: "process",
            pluginId,
            startupError,
          };
          return outcome;
        }

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
          return outcome;
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          const outcome: MigrationOutcome = {
            connectionId,
            connectionName: name,
            status: "connection",
            error,
            pluginId,
          };
          return outcome;
        }
      };

      const outcome = await run();

      // Reopen using whichever driver ended up persisted — `connect` always
      // re-fetches the connection's params from the backend rather than
      // trusting this closure's (possibly stale) `conn`, so it reflects the
      // flip whether it succeeded, failed outright, or the plugin never
      // registered. A reconnect failure is not folded into `outcome`: it's
      // already recorded into `connectionDataMap[connectionId].error` by
      // `connect` itself — the same slot the sidebar/tab UI already renders
      // for a failed connection — so surfacing it again here would just be a
      // second, redundant channel for the same fact, and swallowing it keeps
      // the migration outcome this function returns describing only the
      // migration, not an unrelated reconnect attempt.
      if (disconnected) {
        try {
          await connect(connectionId);
        } catch {
          // Already surfaced via connectionDataMap[connectionId].error.
        }
      }

      return outcome;
    },
    [
      connections,
      builtinId,
      pluginId,
      openConnectionIds,
      connectionDataMap,
      connect,
      disconnect,
      loadConnections,
      recordMigration,
    ],
  );

  // Undo: disconnect if open, flip the driver back to the built-in, refresh,
  // and reopen if it was open before — the same disconnect/reconnect
  // symmetry as migrateConnection, since undo is exactly its inverse. Never
  // rejects — resolves to `{ ok: false, error }` so the caller (there's no
  // outcome-toast plumbing for undo, unlike migrateConnection) can surface it.
  const undoMigration = useCallback(
    async (connectionId: string): Promise<UndoOutcome> => {
      const conn = connections.find((c) => c.id === connectionId);
      // The connection is on `pluginId` at this point (undo runs after a
      // completed migration), so look for it open under that id, mirroring
      // migrateConnection's `[builtinId]` lookup before its own flip.
      const openForPlugin = findConnectionsForDrivers(
        openConnectionIds,
        connectionDataMap,
        [pluginId],
      );
      const wasOpen = openForPlugin.includes(connectionId);
      let disconnected = false;

      let outcome: UndoOutcome;
      try {
        if (wasOpen) {
          await disconnect(connectionId);
          disconnected = true;
        }
        await invoke("update_connection", {
          id: connectionId,
          name: conn?.name ?? connectionId,
          params: { ...conn?.params, driver: builtinId },
          detectJsonInTextColumns: conn?.detect_json_in_text_columns ? true : null,
          environment: conn?.environment ?? null,
        });
        await loadConnections();
        outcome = { ok: true };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        outcome = { ok: false, error };
      }

      // Reopen using whichever driver ended up persisted — see
      // migrateConnection's matching comment for why a reconnect failure
      // isn't folded into `outcome`: it's already surfaced through
      // connectionDataMap[connectionId].error, the same slot the
      // sidebar/tab UI already renders for a failed connection.
      if (disconnected) {
        try {
          await connect(connectionId);
        } catch {
          // Already surfaced via connectionDataMap[connectionId].error.
        }
      }

      return outcome;
    },
    [connections, builtinId, pluginId, openConnectionIds, connectionDataMap, connect, disconnect, loadConnections],
  );

  return {
    builtinId,
    pluginId,
    builtinConnections,
    needsMigration,
    pluginReady,
    registryOffline,
    banner,
    dismissBanner,
    migrateConnection,
    undoMigration,
  };
}

/** Thin postgres-specific wrapper for the current rollout. */
export function useBuiltinPostgresMigration(): BuiltinDriverMigrationState {
  return useBuiltinDriverMigration("postgres", "postgresql");
}
