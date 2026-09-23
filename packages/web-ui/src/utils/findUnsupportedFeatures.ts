/**
 * Capability-gap detection for the built-in-to-plugin driver migration.
 *
 * Compares what a connection actually uses against a plugin's declared
 * `DriverCapabilities` and returns the named gaps. A connection with an
 * unsupported feature stays *unchecked by default* in the migration checklist
 * but is still shown with the specific gap named inline, so the user can
 * report it rather than being silently excluded.
 *
 * What this compares: the real `DriverCapabilities` surface — `supports_ssl`,
 * `connection_uri`, `connection_string`, etc.
 *
 * What it deliberately does NOT compare: SSH tunneling, IAM auth, and
 * Kubernetes port-forwarding. Those are app-level features, transparent to
 * every driver — `test_connection` opens the tunnel and rewrites `params.port`
 * to the local forwarded port before the driver sees the connection. The
 * driver trait has no SSH/tunnel/IAM methods, and `DriverCapabilities` has no
 * fields for them, so a connection using them migrates cleanly and must never
 * appear as a gap here.
 */

import type { PluginManifest } from "../types/plugins";

/** The slice of connection params this function needs. Defined locally
 * rather than imported from one of the several `ConnectionParams` variants so
 * this pure util depends on no Tauri/command shape — only the fields it reads. */
export interface MigrationConnectionParams {
  /** Raw driver-specific connection URI in use (or restorable from keychain). */
  connection_uri?: string;
  /** True when the URI can be restored from the OS keychain. */
  connection_uri_in_keychain?: boolean;
  /** SSL mode, non-empty when TLS is configured (e.g. "verify-ca"). */
  ssl_mode?: string;
  /** A decomposed connection string is in use (host/port/database fields). */
  host?: string;
  port?: number;
}

/** A named capability gap a connection uses that the plugin doesn't declare. */
export interface UnsupportedFeature {
  /** Stable feature key for dedup / "report this gap" tracking. */
  feature: "ssl" | "connection_uri";
  /** Human-readable description shown inline in the migration checklist. */
  label: string;
}

/**
 * Return the capabilities a connection uses that the plugin does not declare.
 * Empty when the plugin covers everything the connection needs.
 *
 * Pure: no side effects, no I/O — straightforward to unit-test.
 */
export function findUnsupportedFeatures(
  connection: MigrationConnectionParams,
  manifest: PluginManifest,
): UnsupportedFeature[] {
  const caps = manifest.capabilities;
  const gaps: UnsupportedFeature[] = [];

  // SSL: the connection has a non-empty ssl_mode but the plugin declares no
  // SSL support.
  if (connection.ssl_mode && connection.ssl_mode.trim() !== "" && !caps.supports_ssl) {
    gaps.push({ feature: "ssl", label: "uses SSL/TLS, not yet supported by the plugin" });
  }

  // Connection URI: the connection uses a raw URI (present now or restorable
  // from the keychain) but the plugin declares it can't accept a connection
  // string at all. This checks `connection_string` (whether the plugin's
  // connection form accepts a URI as an input, defaulting to true), NOT
  // `connection_uri` (whether the plugin needs the URI passed through
  // verbatim instead of decomposed — a structural requirement for drivers
  // like MongoDB's `mongodb+srv://`, irrelevant to whether postgres-style
  // decomposition is possible). A plugin that decomposes URIs just fine
  // (`connection_uri: false`, e.g. the postgresql plugin, same as builtin
  // postgres) is not a gap; only a plugin that rejects connection strings
  // outright (`connection_string: false`) is.
  const usesUri =
    (connection.connection_uri !== undefined && connection.connection_uri !== "") ||
    connection.connection_uri_in_keychain === true;
  // `connection_string` defaults to true (backward-compat default in the
  // Rust struct); absent/undefined means supported, not unsupported.
  const supportsConnectionString =
    caps.connection_string ?? caps.connectionString ?? true;
  if (usesUri && !supportsConnectionString) {
    gaps.push({
      feature: "connection_uri",
      label: "uses a connection string, not yet supported by the plugin",
    });
  }

  return gaps;
}
