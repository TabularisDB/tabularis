export interface DriverCapabilities {
  schemas: boolean;
  views: boolean;
  routines: boolean;
  file_based: boolean;
  folder_based: boolean;
  /** Optional flag to enable/disable connection string import UI for network drivers. Defaults to true when omitted. */
  connection_string?: boolean;
  /** CamelCase alias accepted for plugin compatibility. */
  connectionString?: boolean;
  /** Optional placeholder example shown in the connection string input. */
  connection_string_example?: string;
  /** CamelCase alias accepted for plugin compatibility. */
  connectionStringExample?: string;
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
  /** Supports listing and managing database triggers. Defaults to false. */
  triggers?: boolean;
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
  /** Default username pre-filled in the connection modal (e.g. "postgres", "root") */
  default_username?: string;
  /** CSS hex color for UI accents (e.g. "#f97316"). Undefined falls back to a neutral color. */
  color?: string;
  /** Icon name: built-in values are "mysql" | "postgres" | "sqlite" | "network" | "database" | "folder-open".
   * External plugins can reference a file bundled in the plugin package. */
  icon?: string;
  /** Plugin-declared setting definitions. Empty/absent for built-in drivers. */
  settings?: PluginSettingDefinition[];
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
}

export interface InstalledPluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
}
