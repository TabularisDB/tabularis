import type { Dialect } from "../utils/sqlSplitter";

export interface DriverCapabilities {
  schemas: boolean;
  views: boolean;
  routines: boolean;
  file_based: boolean;
  folder_based: boolean;
  /** The driver exposes a single implicit database (e.g. a flat search/document
   * store like Meilisearch). Skips the database tab + database-name field. */
  single_database?: boolean;
  /** Optional flag to enable/disable connection string import UI for network drivers. Defaults to true when omitted. */
  connection_string?: boolean;
  /** CamelCase alias accepted for plugin compatibility. */
  connectionString?: boolean;
  /** Optional placeholder example shown in the connection string input. */
  connection_string_example?: string;
  /** CamelCase alias accepted for plugin compatibility. */
  connectionStringExample?: string;
  /** The driver consumes the raw connection URI verbatim instead of the decomposed
   * host/port/database fields. Set by drivers whose scheme carries semantics the
   * decomposition would destroy (e.g. the DNS seedlist lookup implied by
   * `mongodb+srv://`). Defaults to false. */
  connection_uri?: boolean;
  /** CamelCase alias accepted for plugin compatibility. */
  connectionUri?: boolean;
  /** Additional URI schemes handled by this driver, beyond its own id and the scheme
   * of `connection_string_example` (e.g. ["mongodb+srv"]). */
  connection_uri_schemes?: string[];
  /** CamelCase alias accepted for plugin compatibility. */
  connectionUriSchemes?: string[];
  identifier_quote: string;
  alter_primary_key: boolean;
  // SQL generation capabilities (optional, default to '' / false when not present)
  auto_increment_keyword?: string;
  serial_type?: string;
  inline_pk?: boolean;
  // DDL capabilities (optional, default to false when not present)
  alter_column?: boolean;
  create_foreign_keys?: boolean;
  /** true for API-based plugins that need no host/port/credentials (e.g. public REST APIs). Hides the entire connection form. */
  no_connection_required?: boolean;
  /** Whether the driver supports table and column management (CREATE TABLE, ADD/MODIFY/DROP COLUMN, DROP TABLE). Does not control index or FK operations. Defaults to true. */
  manage_tables?: boolean;
  /** When true, the driver is read-only: all data modification operations (INSERT, UPDATE, DELETE) are disabled in the UI. Table/column management is also hidden regardless of manage_tables. Defaults to false. */
  readonly?: boolean;
  /** Supports EXPLAIN / query plan visualization. When false, the Visual Explain UI is hidden for connections using this driver. Defaults to false. */
  explain?: boolean;
  /** Supports listing and managing database triggers. Defaults to false. */
  triggers?: boolean;
  /** Supports listing and managing server accounts (users, grants). Defaults to false. */
  user_management?: boolean;
  /** Supports managing stored routines (run with parameters, create from template, edit, drop). Defaults to false. */
  routine_management?: boolean;
  /** Supports materialized views (e.g. PostgreSQL). When false, the frontend skips fetching materialized views entirely. Defaults to false. */
  materialized_views?: boolean;
  /** Shows the SSL/TLS configuration tab (mode + CA/client cert/key) in the connection modal.
   * Built-in network drivers (postgres, mysql) set this; plugins opt in via their manifest. Defaults to false. */
  supports_ssl?: boolean;
  /**
   * SQL dialect for the statement splitter / classifier. Plugins that
   * omit the field fall back to "postgres" (the dialect everyone got
   * implicitly via the previous splitter).
   */
  sql_dialect?: Dialect;
}

export type PluginSettingType = "string" | "boolean" | "number" | "select";

export interface PluginSettingDefinition {
  key: string;
  label: string;
  type: PluginSettingType;
  default?: string | boolean | number;
  description?: string;
  required?: boolean;
  options?: string[]; // only when type === "select"
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  default_port: number | null;
  capabilities: DriverCapabilities;
  /** true for built-in drivers (postgres, mysql, sqlite); false/absent for external plugins */
  is_builtin?: boolean;
  /** Concrete database engine (registry manifest `engine`). Lets the connection
   * catalogue place locally-installed, not-yet-published plugins. */
  engine?: string | null;
  /** Data-model families, primary first (registry manifest `paradigms`). */
  paradigms?: string[];
  /** Default username pre-filled in the connection modal (e.g. "postgres", "root") */
  default_username?: string;
  /** CSS hex color for UI accents (e.g. "#f97316"). Undefined falls back to a neutral color. */
  color?: string;
  /** Icon: a hosted URL (`https://...`) or `data:` URI, resolved to an
   * `<img>` (see the Tabularium manifest docs); or one of the built-in
   * lookup keys "mysql" | "postgres" | "sqlite" | "network" | "database" |
   * "folder-open", resolved to an inline brand/lucide icon. */
  icon?: string;
  /** Plugin-declared setting definitions. Empty/absent for built-in drivers. */
  settings?: PluginSettingDefinition[];
  /** Optional map of generic inferred type names to driver-specific types.
   * Used during paste/import to resolve map_inferred_type() locally. */
  type_mappings?: Record<string, string>;
  /** UI extension declarations for slot-based rendering (Phase 2). */
  ui_extensions?: UIExtensionManifestEntry[];
}

/** Manifest-level entry for a UI extension slot. */
export interface UIExtensionManifestEntry {
  slot: string;
  module: string;
  order?: number;
  /** If set, the contribution is only active when context.driver matches this value. */
  driver?: string;
}

/**
 * Locale-aware README payload from the `fetch_plugin_readme` command.
 * `html` is the registry's server-rendered README; `locale` is the locale
 * actually served, which can differ from the requested one when the plugin
 * has no translation for it.
 */
export interface PluginReadme {
  html: string | null;
  locale: string | null;
  available_locales?: string[];
  documentation_url?: string | null;
  /** Repository URL, used to resolve relative image/link paths in the README. */
  repo_url?: string | null;
}

export interface RegistryReleaseWithStatus {
  version: string;
  min_tabularis_version: string | null;
  platform_supported: boolean;
}

export interface RegistryPluginWithStatus {
  id: string;
  name: string;
  description: string;
  author: string;
  homepage: string;
  latest_version: string;
  releases: RegistryReleaseWithStatus[];
  installed_version: string | null;
  update_available: boolean;
  platform_supported: boolean;
  // Richer Tabularium-only fields. All optional so legacy data still works.
  icon?: string | null;
  repo_url?: string | null;
  kind?: string | null;
  tags?: string[];
  category?: string | null;
  downloads?: number | null;
  /** Base URL of the registry that served this plugin (e.g. https://registry.tabularis.dev). */
  registry_base_url?: string | null;
  /** Concrete database the driver connects to (registry manifest extensions.engine). */
  engine?: string | null;
  /** Data-model families, primary first (registry manifest extensions.paradigms). */
  paradigms?: string[];
  /** Registry-assigned verification flag. */
  verified?: boolean;
  /** Deeplink-only: resolved action for the confirmation modal. */
  install_action?: "install" | "update" | "up_to_date" | null;
  /**
   * Release-integrity signature state for the target version (preview path).
   * Distinct from `verified` (admin moderation) — this is the cryptographic
   * signature over the release's asset hashes.
   */
  signature?: "verified" | "unsigned" | "invalid" | "unknown" | null;
}

export interface InstalledPluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
}
