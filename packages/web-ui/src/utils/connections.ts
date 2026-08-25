/**
 * Connection utilities for database connections
 * Extracted from Connections.tsx for testability
 */

import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import type { SavedConnection } from "../contexts/DatabaseContext";
import { isLocalDriver } from "./driverCapabilities";
import { isMultiDatabaseCapable } from "./database";

export type DatabaseDriver = string;

export const BUILTIN_DRIVER_IDS = ["postgres", "mysql", "sqlite"] as const;
export type BuiltinDriverId = (typeof BUILTIN_DRIVER_IDS)[number];

export interface ConnectionParams {
  driver: DatabaseDriver;
  host?: string;
  database: string;
  port?: number;
  username?: string;
  password?: string;
  /** Raw driver-specific connection URI, forwarded verbatim to the driver.
   * Never persisted in connections.json: it embeds credentials and is stored
   * in the OS keychain instead. */
  connection_uri?: string;
  /** True when the URI can be restored from the OS keychain. */
  connection_uri_in_keychain?: boolean;
  ssh_enabled?: boolean;
  ssh_connection_id?: string;
  // Legacy fields (for backward compatibility)
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key_file?: string;
  ssh_key_passphrase?: string;
  ssh_allow_passphrase_prompt?: boolean;
  // K8s
  k8s_enabled?: boolean;
  k8s_connection_id?: string;
  k8s_context?: string;
  k8s_namespace?: string;
  k8s_resource_type?: string;
  k8s_resource_name?: string;
  k8s_port?: number;
  /** SQL run on every new connection to this data source (e.g. SET / set_config). */
  startup_script?: string;
  /** Opaque plugin-specific connection fields (e.g. `region` for a DynamoDB
   * plugin). Persisted as-is and forwarded verbatim to the driver/plugin. */
  extra?: Record<string, string>;
}

/**
 * Update one entry of the opaque `extra` connection fields map.
 *
 * Pure function — returns a new map, never mutates its input.
 * - Blank keys are ignored (the input is returned unchanged).
 * - An empty value removes the key, and the map collapsing to empty yields
 *   `undefined` so nothing extra is persisted or sent to the backend.
 *
 * @param extra - Current extra fields map (may be undefined)
 * @param key - Field name owned by the plugin
 * @param value - New value; empty string clears the field
 */
export function updateExtraField(
  extra: Record<string, string> | undefined,
  key: string,
  value: string,
): Record<string, string> | undefined {
  const trimmedKey = key.trim();
  if (!trimmedKey) return extra;
  const next = { ...(extra ?? {}) };
  if (value === "") {
    delete next[trimmedKey];
  } else {
    next[trimmedKey] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Format a connection string for display.
 * When capabilities are provided, uses file_based/folder_based to determine local vs remote.
 * Falls back to driver === "sqlite" when capabilities are not available.
 * @param params - Connection parameters
 * @param capabilities - Optional driver capabilities
 * @returns Formatted connection string
 */
export function formatConnectionString(
  params: ConnectionParams,
  capabilities?: DriverCapabilities | null,
): string {
  const local =
    capabilities != null ? isLocalDriver(capabilities) : params.driver === "sqlite";

  if (local) {
    return params.database;
  }

  const host = params.host || "localhost";
  const port = params.port || getDefaultPort(params.driver);

  return `${host}:${port}/${params.database}`;
}

/**
 * Get the default port for a database driver.
 * Accepts a driver id string, or a PluginManifest — when a manifest is
 * given, its own declared `default_port` is used verbatim (issue #614:
 * this lets a plugin driver like the standalone PostgreSQL plugin, id
 * "postgresql", report the correct port instead of falling through to the
 * literal-id switch below, which only recognizes the builtin ids).
 * @param driver - Database driver type, or a resolved PluginManifest
 * @returns Default port number
 */
export function getDefaultPort(driver: DatabaseDriver | PluginManifest): number {
  if (typeof driver === "object") {
    return driver.default_port ?? 0;
  }
  switch (driver) {
    case "postgres":
      return 5432;
    case "mysql":
      return 3306;
    case "sqlite":
      return 0; // SQLite doesn't use ports
    default:
      return 0;
  }
}

/**
 * Validate connection parameters.
 * When capabilities are provided, uses file_based/folder_based to determine local vs remote.
 * Falls back to driver === "sqlite" when capabilities are not available.
 * @param params - Connection parameters to validate
 * @param capabilities - Optional driver capabilities
 * @returns Object with isValid flag and optional error message
 */
export function validateConnectionParams(
  params: Partial<ConnectionParams>,
  capabilities?: DriverCapabilities | null,
): {
  isValid: boolean;
  error?: string;
} {
  if (!params.driver) {
    return { isValid: false, error: "Driver is required" };
  }

  if (!params.database) {
    return { isValid: false, error: "Database name is required" };
  }

  // For remote drivers, host is required
  const local =
    capabilities != null
      ? isLocalDriver(capabilities)
      : params.driver === "sqlite";
  if (!local && !params.host) {
    return { isValid: false, error: "Host is required for remote databases" };
  }

  // Validate port if provided
  if (params.port !== undefined) {
    if (
      !Number.isInteger(params.port) ||
      params.port < 1 ||
      params.port > 65535
    ) {
      return { isValid: false, error: "Port must be between 1 and 65535" };
    }
  }

  // SSH validation
  if (params.ssh_enabled) {
    if (!params.ssh_host) {
      return {
        isValid: false,
        error: "SSH host is required when SSH is enabled",
      };
    }

    if (!params.ssh_user) {
      return {
        isValid: false,
        error: "SSH user is required when SSH is enabled",
      };
    }

    // Either password or key file must be provided
    if (!params.ssh_password && !params.ssh_key_file) {
      return {
        isValid: false,
        error: "SSH password or key file is required",
      };
    }

    // Validate SSH port if provided
    if (params.ssh_port !== undefined) {
      if (
        !Number.isInteger(params.ssh_port) ||
        params.ssh_port < 1 ||
        params.ssh_port > 65535
      ) {
        return {
          isValid: false,
          error: "SSH port must be between 1 and 65535",
        };
      }
    }
  }

  return { isValid: true };
}

/**
 * Get a human-readable label for a database driver.
 * Accepts a driver id string, or a PluginManifest — when a manifest is
 * given, its own declared `name` is used verbatim (issue #614: a plugin
 * driver like the standalone PostgreSQL plugin, id "postgresql", gets its
 * real display name instead of falling through to an all-caps rendering
 * of its id).
 * @param driver - Database driver type, or a resolved PluginManifest
 * @returns Display label for the driver
 */
export function getDriverLabel(driver: DatabaseDriver | PluginManifest): string {
  if (typeof driver === "object") {
    return driver.name;
  }
  switch (driver) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
    default:
      return String(driver).toUpperCase();
  }
}

/**
 * Build the subtitle shown below a connection name (host:port · db or file path).
 *
 * `labels` carries the translated strings the subtitle may need: the
 * "all databases" label (multi-db connection with no explicit selection)
 * and the "{{n}} databases" counter. Untranslated fallbacks apply when
 * omitted.
 */
export function connectionSubtitle(
  conn: SavedConnection,
  capabilities: DriverCapabilities | null | undefined,
  labels?: { allDatabases?: string; databaseCount?: (count: number) => string },
): string {
  if (isLocalDriver(capabilities)) {
    const db = conn.params.database;
    return Array.isArray(db) ? db[0] ?? '' : db;
  }
  const db = conn.params.database;
  const isAllDatabases =
    isMultiDatabaseCapable(capabilities) &&
    (Array.isArray(db) ? db.length === 0 : db.trim() === '');
  const dbStr = isAllDatabases
    ? labels?.allDatabases ?? 'All databases'
    : Array.isArray(db)
      ? labels?.databaseCount?.(db.length) ?? `${db.length} databases`
      : db;
  return `${conn.params.host ?? 'localhost'}:${conn.params.port ?? ''}  ·  ${dbStr}`;
}

/**
 * CSS class string for a connection card/row based on its active/open state.
 */
export function getCardClass(
  connId: string,
  activeConnectionId: string | null,
  isConnectionOpen: (id: string) => boolean,
): string {
  if (activeConnectionId === connId)
    return 'border-blue-500/40 bg-blue-500/5 ring-1 ring-blue-500/20 shadow-lg shadow-blue-500/8';
  if (isConnectionOpen(connId))
    return 'border-green-500/35 bg-green-500/4 ring-1 ring-green-500/15 shadow-md shadow-green-500/6';
  return 'border-strong bg-elevated hover:border-blue-400/30 hover:bg-surface-primary hover:shadow-md hover:shadow-black/10';
}

/**
 * Create a connection display name from parameters.
 * When capabilities are provided, uses file_based/folder_based to determine local vs remote.
 * Falls back to driver === "sqlite" when capabilities are not available.
 * @param params - Connection parameters
 * @param capabilities - Optional driver capabilities
 * @returns Display name for the connection
 */
export function generateConnectionName(
  params: ConnectionParams,
  capabilities?: DriverCapabilities | null,
): string {
  const local =
    capabilities != null ? isLocalDriver(capabilities) : params.driver === "sqlite";

  if (local) {
    // Extract filename or folder name from path
    const parts = params.database.split("/");
    return parts[parts.length - 1] || params.database;
  }

  const host = params.host || "localhost";
  return `${params.database}@${host}`;
}
