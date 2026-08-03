/**
 * Connection string parsing utilities.
 * The supported protocols are derived from driver capabilities when provided.
 */

import type { DriverCapabilities } from "../types/plugins";
import { isLocalDriver } from "./driverCapabilities";
import type { ConnectionParams, DatabaseDriver } from "./connections";
import { BUILTIN_DRIVER_IDS } from "./connections";

export interface ParsedConnectionString {
  driver: DatabaseDriver;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string;
  /** Original connection string, preserved verbatim for URI-passthrough drivers.
   * When set it is authoritative: the decomposed fields above are only there so
   * the UI has something to display. */
  connection_uri?: string;
}

export interface ConnectionStringParseResult {
  success: true;
  params: ParsedConnectionString;
}

export interface ConnectionStringParseError {
  success: false;
  error: string;
}

export type ConnectionStringResult =
  | ConnectionStringParseResult
  | ConnectionStringParseError;

export interface ConnectionStringDriver {
  id: DatabaseDriver;
  capabilities?: DriverCapabilities | null;
}

interface ResolvedDriver {
  id: DatabaseDriver;
  local: boolean;
  /** The driver takes the raw URI verbatim; decomposing it would lose meaning. */
  passthrough: boolean;
}

/**
 * Groups of interchangeable URI schemes. When a driver registers any
 * protocol of a group, the other members become aliases for the same
 * driver (e.g. `postgresql://` works wherever `postgres://` does).
 */
const PROTOCOL_ALIAS_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["postgres", "postgresql"],
  ["mysql", "mariadb"],
  ["sqlite", "sqlite3"],
];

function getProtocolAliases(protocol: string): string[] {
  const group = PROTOCOL_ALIAS_GROUPS.find((aliases) =>
    aliases.includes(protocol),
  );
  if (!group) return [];
  return group.filter((alias) => alias !== protocol);
}

function normalizeProtocol(protocol: string): string {
  return protocol.replace(/:$/, "").trim().toLowerCase();
}

function getProtocolFromExample(example?: string | null): string | null {
  if (!example?.trim()) return null;

  try {
    const url = new URL(example.trim());
    return normalizeProtocol(url.protocol);
  } catch {
    return null;
  }
}

function connectionStringImportEnabled(
  capabilities?: DriverCapabilities | null,
): boolean {
  if (!capabilities) return true;
  return (
    capabilities.connection_string ?? capabilities.connectionString ?? true
  );
}

function uriPassthroughEnabled(
  capabilities?: DriverCapabilities | null,
): boolean {
  if (!capabilities) return false;
  return capabilities.connection_uri ?? capabilities.connectionUri ?? false;
}

function getExtraProtocols(
  capabilities?: DriverCapabilities | null,
): string[] {
  const schemes =
    capabilities?.connection_uri_schemes ??
    capabilities?.connectionUriSchemes ??
    [];
  return schemes.map(normalizeProtocol).filter((scheme) => scheme.length > 0);
}

function resolveDrivers(
  drivers?: ReadonlyArray<ConnectionStringDriver>,
): ReadonlyArray<ConnectionStringDriver> {
  if (drivers && drivers.length > 0) return drivers;
  return BUILTIN_DRIVER_IDS.map((id) => ({ id, capabilities: null }));
}

function buildProtocolRegistry(
  drivers?: ReadonlyArray<ConnectionStringDriver>,
): Map<string, ResolvedDriver> {
  const registry = new Map<string, ResolvedDriver>();

  for (const driver of resolveDrivers(drivers)) {
    const local = isLocalDriver(driver.capabilities);
    const canImport =
      local || connectionStringImportEnabled(driver.capabilities);

    if (!canImport) continue;

    const resolved: ResolvedDriver = {
      id: driver.id,
      local,
      passthrough: uriPassthroughEnabled(driver.capabilities),
    };

    const idProtocol = normalizeProtocol(driver.id);
    if (idProtocol) {
      registry.set(idProtocol, resolved);
    }

    const exampleProtocol = getProtocolFromExample(
      driver.capabilities?.connection_string_example ??
        driver.capabilities?.connectionStringExample,
    );

    if (exampleProtocol) {
      registry.set(exampleProtocol, resolved);
    }

    // Declared schemes never displace a protocol another driver already owns.
    // Drivers arrive sorted by id, so without this a plugin could claim
    // `postgres` and, sorting later, capture connection strings — credentials
    // included — meant for the built-in driver.
    for (const extraProtocol of getExtraProtocols(driver.capabilities)) {
      if (!registry.has(extraProtocol)) {
        registry.set(extraProtocol, resolved);
      }
    }
  }

  // Second pass: expand well-known aliases without overriding protocols
  // explicitly registered by another driver.
  for (const [protocol, resolved] of Array.from(registry.entries())) {
    for (const alias of getProtocolAliases(protocol)) {
      if (!registry.has(alias)) {
        registry.set(alias, resolved);
      }
    }
  }

  return registry;
}

export function getSupportedConnectionStringProtocols(
  drivers?: ReadonlyArray<ConnectionStringDriver>,
): string[] {
  return Array.from(buildProtocolRegistry(drivers).keys()).sort();
}

/**
 * Parse a database connection string.
 * Supported protocols are inferred from the provided drivers/capabilities.
 */
export function parseConnectionString(
  connectionString: string,
  drivers?: ReadonlyArray<ConnectionStringDriver>,
): ConnectionStringResult {
  if (!connectionString || !connectionString.trim()) {
    return { success: false, error: "Connection string is empty" };
  }

  const trimmed = connectionString.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { success: false, error: "Invalid connection string format" };
  }

  const protocol = normalizeProtocol(url.protocol);
  const registry = buildProtocolRegistry(drivers);
  const resolved = registry.get(protocol);

  if (!resolved) {
    const supported = getSupportedConnectionStringProtocols(drivers);
    const suffix =
      supported.length > 0 ? `. Supported: ${supported.join(", ")}` : "";
    return {
      success: false,
      error: `Unsupported database driver: ${protocol}${suffix}`,
    };
  }

  if (resolved.passthrough) {
    // The scheme and query string carry meaning the decomposed fields cannot
    // represent (a `mongodb+srv://` host has SRV records but no A record, and
    // params like `tls` or `replicaSet` have no field of their own), so the
    // original string is kept verbatim and handed to the driver as-is. The
    // fields below are derived only so the UI can label the connection; the
    // password is deliberately left out because the URI already carries it and
    // is the only copy that reaches the keychain.
    return {
      success: true,
      params: {
        driver: resolved.id,
        host: url.hostname || undefined,
        port: url.port ? Number.parseInt(url.port, 10) : undefined,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        database: decodeURIComponent(url.pathname.replace(/^\//, "")),
        connection_uri: trimmed,
      },
    };
  }

  if (resolved.local) {
    const rawPath = url.pathname;
    if (!rawPath) {
      return {
        success: false,
        error: "Connection string must include a database path",
      };
    }

    const database = decodeURIComponent(rawPath.replace(/^\//, ""));
    if (!database) {
      return {
        success: false,
        error: "Connection string must include a database path",
      };
    }

    return {
      success: true,
      params: {
        driver: resolved.id,
        database,
      },
    };
  }

  const host = url.hostname || undefined;
  const port = url.port ? Number.parseInt(url.port, 10) : undefined;
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  let database = url.pathname;
  if (database.startsWith("/")) {
    database = database.slice(1);
  }
  database = decodeURIComponent(database);

  if (!database) {
    return {
      success: false,
      error: "Database name is required in connection string",
    };
  }

  return {
    success: true,
    params: {
      driver: resolved.id,
      host,
      port,
      username,
      password,
      database,
    },
  };
}

/**
 * Convert parsed connection string to ConnectionParams format.
 */
export function toConnectionParams(
  parsed: ParsedConnectionString,
): Partial<ConnectionParams> {
  return {
    driver: parsed.driver,
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
    database: parsed.database,
    connection_uri: parsed.connection_uri,
  };
}

/**
 * Validate if a string looks like a supported connection string.
 * Supported protocols are inferred from the provided drivers/capabilities.
 */
export function looksLikeConnectionString(
  value: string,
  drivers?: ReadonlyArray<ConnectionStringDriver>,
): boolean {
  if (!value || !value.trim()) return false;

  const trimmed = value.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  const protocol = normalizeProtocol(url.protocol);
  const registry = buildProtocolRegistry(drivers);

  return registry.has(protocol);
}
