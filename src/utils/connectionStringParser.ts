/**
 * Connection string parsing utilities.
 * The supported protocols are derived from driver capabilities when provided.
 */

import type { DriverCapabilities } from "../types/plugins";
import { isLocalDriver } from "./driverCapabilities";
import type { ConnectionParams, DatabaseDriver } from "./connections";
import { BUILTIN_DRIVER_IDS } from "./connections";
import { sanitizeLocalFilePath } from "./fsPath";

export interface ParsedConnectionString {
  driver: DatabaseDriver;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  /** TLS mode selected through sslmode / ssl-mode in an imported URI. */
  ssl_mode?: string;
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
  /** The declared example uses a scheme without an authority. */
  opaque: boolean;
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

/** JDBC wrappers for built-in PostgreSQL/MySQL URLs use an ordinary URI
 * after the prefix. Leave other JDBC and raw plugin URIs untouched. */
function normalizeJdbcConnectionString(value: string): string {
  const match = /^jdbc:(postgres(?:ql)?|mysql|mariadb):\/\//i.exec(value);
  return match ? value.slice(5) : value;
}

/** Normalize known URI SSL settings to the values offered by the connection form.
 * @returns A mapped SSL mode, or undefined for an unknown mode or protocol.
 */
function getSslModeFromUrl(url: URL, protocol: string): string | undefined {
  // URLSearchParams.get is case-sensitive, but Connector/J uses "sslMode".
  // Recognize that spelling along with the existing hyphen/underscore aliases.
  // Keep the original alias priority (sslmode > ssl-mode > ssl_mode)
  // even if a differently named query parameter appears first.
  const params = Array.from(url.searchParams.entries());
  const getParam = (name: string) =>
    params.find(([key]) => key.toLowerCase() === name)?.[1];
  const mode = (
    getParam("sslmode") ?? getParam("ssl-mode") ?? getParam("ssl_mode")
  )?.trim().toLowerCase();
  if (!mode) return undefined;

  if (protocol === "mysql" || protocol === "mariadb") {
    const mysqlModes: Record<string, string> = {
      disable: "disabled", disabled: "disabled",
      prefer: "preferred", preferred: "preferred",
      require: "required", required: "required",
      "verify-ca": "verify_ca", verify_ca: "verify_ca",
      "verify-full": "verify_identity", "verify-identity": "verify_identity",
      verify_identity: "verify_identity",
    };
    return mysqlModes[mode];
  }
  if (protocol === "postgres" || protocol === "postgresql") {
    const pgModes: Record<string, string> = {
      disable: "disable", allow: "allow", prefer: "prefer",
      require: "require", "verify-ca": "verify-ca",
      "verify-full": "verify-full",
    };
    return pgModes[mode];
  }
  return undefined;
}

/**
 * WHATWG URL rejects MongoDB's valid comma-separated host list. URI-passthrough
 * drivers only need a representative URL for labels in the form, so parse the
 * first host for display and leave validation of the complete URI to the
 * driver that receives the original value.
 */
function getPassthroughDisplayUrl(value: string, allowOpaque: boolean): URL | null {
  const schemeEnd = value.indexOf(":");
  if (!value.startsWith("//", schemeEnd + 1)) {
    if (!allowOpaque) return null;
    // JDBC-style URIs can be opaque (for example jdbc:h2:mem:test). The
    // plugin owns their syntax, so preserve the URI without requiring a host.
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  const authorityStart = schemeEnd + 3;
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
      opaque: /^[a-z][a-z\d+.-]*:(?!\/\/)/i.test(
        (
          driver.capabilities?.connection_string_example ??
          driver.capabilities?.connectionStringExample ??
          ""
        ).trim(),
      ),
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

  const registry = buildProtocolRegistry(drivers);
  const raw = connectionString.trim();
  // A driver explicitly registering the JDBC scheme may own its URI syntax.
  // Normalize only when JDBC is not being handled as an opaque passthrough.
  const declaredJdbcDriver = registry.get(getProtocolFromConnectionString(raw) ?? "");
  const trimmed = declaredJdbcDriver?.passthrough
    ? raw
    : normalizeJdbcConnectionString(raw);
  const declaredProtocol = getProtocolFromConnectionString(trimmed);
  const declaredDriver = declaredProtocol
    ? registry.get(declaredProtocol)
    : undefined;

  // Resolve passthrough before using WHATWG URL: it rejects valid MongoDB
  // replica-set URIs because their authority contains multiple hosts.
  if (declaredDriver?.passthrough) {
    const url = getPassthroughDisplayUrl(trimmed, declaredDriver.opaque);
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

    const database = sanitizeLocalFilePath(
      decodeURIComponent(rawPath.replace(/^\//, "")),
    );
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
  // Never combine credentials from the authority and query string: the
  // authority wins, even if its password is empty or missing.
  const hasAuthorityCredentials = !!(url.username || url.password);
  const username = hasAuthorityCredentials
    ? (url.username ? decodeURIComponent(url.username) : undefined)
    : (url.searchParams.get("user") || url.searchParams.get("username") || undefined);
  const password = hasAuthorityCredentials
    ? (url.password ? decodeURIComponent(url.password) : undefined)
    : (url.searchParams.get("password") || undefined);
  const ssl_mode = getSslModeFromUrl(url, protocol);

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
      ssl_mode,
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
    ssl_mode: parsed.ssl_mode,
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

  const registry = buildProtocolRegistry(drivers);
  const raw = value.trim();
  const declaredJdbcDriver = registry.get(getProtocolFromConnectionString(raw) ?? "");
  const trimmed = declaredJdbcDriver?.passthrough
    ? raw
    : normalizeJdbcConnectionString(raw);
  const declaredProtocol = getProtocolFromConnectionString(trimmed);
  const declaredDriver = declaredProtocol
    ? registry.get(declaredProtocol)
    : undefined;

  if (declaredDriver?.passthrough) {
    return getPassthroughDisplayUrl(trimmed, declaredDriver.opaque) !== null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  return registry.has(normalizeProtocol(url.protocol));
}
