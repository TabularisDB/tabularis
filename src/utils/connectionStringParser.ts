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

function getProtocolFromConnectionString(value: string): string | null {
  const match = /^([a-z][a-z\d+.-]*):/i.exec(value);
  return match ? normalizeProtocol(match[1]) : null;
}

/**
 * WHATWG URL rejects MongoDB's valid comma-separated host list. URI-passthrough
 * drivers only need a representative URL for labels in the form, so parse the
 * first host for display and leave validation of the complete URI to the
 * driver that receives the original value.
 */
function getPassthroughDisplayUrl(value: string): URL | null {
  const authorityMarker = value.indexOf("://");
  if (authorityMarker < 0) return null;

  const authorityStart = authorityMarker + 3;
  const suffixOffset = value.slice(authorityStart).search(/[/?#]/);
  const authorityEnd =
    suffixOffset < 0 ? value.length : authorityStart + suffixOffset;
  const authority = value.slice(authorityStart, authorityEnd);
  const credentialsEnd = authority.lastIndexOf("@");
  const credentials =
    credentialsEnd < 0 ? "" : authority.slice(0, credentialsEnd + 1);
  const hosts = authority.slice(credentialsEnd + 1);
  const firstHost = hosts.split(",", 1)[0];

  if (!firstHost) return null;

  try {
    return new URL(
      `${value.slice(0, authorityStart)}${credentials}${firstHost}${value.slice(authorityEnd)}`,
    );
  } catch {
    return null;
  }
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

export function uriPassthroughEnabled(
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

  const registry = buildProtocolRegistry(drivers);
  const declaredProtocol = getProtocolFromConnectionString(trimmed);
  const declaredDriver = declaredProtocol
    ? registry.get(declaredProtocol)
    : undefined;

  // Resolve passthrough before using WHATWG URL: it rejects valid MongoDB
  // replica-set URIs because their authority contains multiple hosts.
  if (declaredDriver?.passthrough) {
    const url = getPassthroughDisplayUrl(trimmed);
    if (!url) {
      return { success: false, error: "Invalid connection string format" };
    }

    return {
      success: true,
      params: {
        driver: declaredDriver.id,
        host: url.hostname || undefined,
        port: url.port ? Number.parseInt(url.port, 10) : undefined,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        database: decodeURIComponent(url.pathname.replace(/^\//, "")),
        connection_uri: trimmed,
      },
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { success: false, error: "Invalid connection string format" };
  }

  const protocol = normalizeProtocol(url.protocol);
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

  const registry = buildProtocolRegistry(drivers);
  const declaredProtocol = getProtocolFromConnectionString(trimmed);
  const declaredDriver = declaredProtocol
    ? registry.get(declaredProtocol)
    : undefined;

  if (declaredDriver?.passthrough) {
    return getPassthroughDisplayUrl(trimmed) !== null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  return registry.has(normalizeProtocol(url.protocol));
}
