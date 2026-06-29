/**
 * Connection utilities for database connections
 * Extracted from Connections.tsx for testability
 */

import type { DriverCapabilities } from "../types/plugins";
import type { SavedConnection, ConnectionGroup } from "../contexts/DatabaseContext";
import { isLocalDriver } from "./driverCapabilities";

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
 * Get the default port for a database driver
 * @param driver - Database driver type
 * @returns Default port number
 */
export function getDefaultPort(driver: DatabaseDriver): number {
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
 * Get a human-readable label for a database driver
 * @param driver - Database driver type
 * @returns Display label for the driver
 */
export function getDriverLabel(driver: DatabaseDriver): string {
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
 */
export function connectionSubtitle(
  conn: SavedConnection,
  capabilities: DriverCapabilities | null | undefined,
): string {
  if (isLocalDriver(capabilities)) {
    const db = conn.params.database;
    return Array.isArray(db) ? db[0] ?? '' : db;
  }
  const db = conn.params.database;
  const dbStr = Array.isArray(db) ? `${db.length} databases` : db;
  return `${conn.params.host ?? 'localhost'}:${conn.params.port ?? ''}  ·  ${dbStr}`;
}

/**
 * Returns true when a connection's context menu would have at least one item
 * (i.e. there are groups to move to, or the connection is already in a group).
 */
export function hasConnectionMenuItems(
  sortedGroups: ConnectionGroup[],
  groupId: string | undefined,
): boolean {
  return sortedGroups.filter(g => g.id !== groupId).length > 0 || !!groupId;
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
