import { createContext } from 'react';
import type { ProxyOverride } from '../types/proxy';
import type { ConnectionMetadata, DriverCapabilities } from '../types/plugins';

export interface TableInfo {
  name: string;
  schema?: string; // database/schema the table belongs to (populated in multiDb mode)
  comment?: string | null;
}

export interface ViewInfo {
  name: string;
  definition?: string;
}

export interface RoutineInfo {
  name: string;
  routine_type: string;
  definition?: string;
}

export interface TriggerInfo {
  name: string;
  table_name: string;
  event: string;
  timing: string;
  definition?: string;
}

export type IconOverride =
  | { type: "pack";  id: string }
  | { type: "emoji"; value: string }
  | { type: "image"; path: string };

export interface ConnectionAppearance {
  icon?: IconOverride;
  accentColor?: string;
}

export interface SavedConnection {
  id: string;
  name: string;
  params: {
    driver: string;
    host?: string;
    database: string | string[];
    port?: number;
    username?: string;
    password?: string;
    ssh_enabled?: boolean;
    ssh_connection_id?: string;
    k8s_enabled?: boolean;
    k8s_connection_id?: string;
    ssm_enabled?: boolean;
    ssm_target?: string;
    startup_script?: string;
    /** SSL/TLS mode (e.g. "verify-ca"); empty/absent means SSL is off. Used
     * by findUnsupportedFeatures to detect a plugin capability gap. */
    ssl_mode?: string;
    /** Raw driver-specific connection URI, when present at runtime (never
     * persisted to disk — see connection_uri_in_keychain below). */
    connection_uri?: string;
    /** True when a connection URI is restorable from the OS keychain. A
     * driver flip drops it (by design — a stored URI belongs to the driver
     * that produced it), so the migration confirm warns before this happens. */
    connection_uri_in_keychain?: boolean;
    /** Optional proxy override for this connection. */
    proxy?: ProxyOverride;
  };
  group_id?: string;
  sort_order?: number;
  /** Per-connection opt-in: detect JSON in plain text columns. */
  detect_json_in_text_columns?: boolean;
  appearance?: ConnectionAppearance;
  /** Ids of connection tags attached to this connection. */
  tag_ids?: string[];
  /** Deployment environment; production drives warnings and visuals. */
  environment?: "development" | "staging" | "production";
}

export interface ConnectionGroup {
  id: string;
  name: string;
  collapsed: boolean;
  sort_order: number;
  /** When set, this group is a child of another group. `undefined` or `null`
   * means top-level root. Cycles are rejected by the backend. */
  parent_id?: string | null;
}

export interface ConnectionsFile {
  groups: ConnectionGroup[];
  connections: SavedConnection[];
}

export interface SchemaData {
  tables: TableInfo[];
  views: ViewInfo[];
  materializedViews?: ViewInfo[];
  routines: RoutineInfo[];
  triggers: TriggerInfo[];
  routineError?: string;
  isLoading: boolean;
  isLoaded: boolean;
}

/**
 * Per-database state for a schema-based multi-db driver (e.g. PostgreSQL
 * browsing several databases on one connection). Mirrors `ConnectionData`'s
 * own `schemas`/`selectedSchemas`/`activeSchema`/`needsSchemaSelection`/
 * `schemaDataMap` quintet, scoped to one database instead of the whole
 * connection, since each database has its own independent set of schemas.
 */
export interface NestedDatabaseData {
  schemas: string[];
  schemasLoaded: boolean;
  isLoadingSchemas: boolean;
  selectedSchemas: string[];
  activeSchema: string | null;
  needsSchemaSelection: boolean;
  schemaDataMap: Record<string, SchemaData>;
}

export interface ConnectionData {
  driver: string;
  capabilities: DriverCapabilities | null;
  metadata?: ConnectionMetadata;
  usesConnectionMetadata?: boolean;
  connectionName: string;
  databaseName: string;
  tables: TableInfo[];
  views: ViewInfo[];
  routines: RoutineInfo[];
  triggers: TriggerInfo[];
  isLoadingTables: boolean;
  isLoadingViews: boolean;
  isLoadingRoutines: boolean;
  isLoadingTriggers: boolean;
  routineError?: string;
  schemas: string[];
  isLoadingSchemas: boolean;
  schemaDataMap: Record<string, SchemaData>;
  activeSchema: string | null;
  selectedSchemas: string[];
  needsSchemaSelection: boolean;
  selectedDatabases: string[];
  databaseDataMap: Record<string, SchemaData>;
  /** Nested per-database schema state for schema-based multi-db drivers
   * (see `isSchemaBasedMultiDb` in `src/utils/database.ts`). Keyed by
   * database name; empty/unused for flat multi-db drivers like MySQL, which
   * keep using `databaseDataMap` above. */
  nestedDatabaseDataMap: Record<string, NestedDatabaseData>;
  /** Multi-db drivers with no explicit selection: the database list is
   * fetched from the server on every connect/refresh instead of being
   * persisted. */
  allDatabasesMode: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  error?: string;
}

export interface DatabaseContextType {
  activeConnectionId: string | null;
  openConnectionIds: string[];
  connectionDataMap: Record<string, ConnectionData>;
  activeTable: string | null;
  activeDriver: string | null;
  activeCapabilities: DriverCapabilities | null;
  activeConnectionName: string | null;
  activeDatabaseName: string | null;
  tables: TableInfo[];
  views: ViewInfo[];
  materializedViews: ViewInfo[];
  routines: RoutineInfo[];
  triggers: TriggerInfo[];
  isLoadingTables: boolean;
  isLoadingViews: boolean;
  isLoadingRoutines: boolean;
  isLoadingTriggers: boolean;
  routineError?: string | null;
  schemas: string[];
  isLoadingSchemas: boolean;
  schemaDataMap: Record<string, SchemaData>;
  activeSchema: string | null;
  selectedSchemas: string[];
  needsSchemaSelection: boolean;
  selectedDatabases: string[];
  databaseDataMap: Record<string, SchemaData>;
  nestedDatabaseDataMap: Record<string, NestedDatabaseData>;
  connections: SavedConnection[];
  connectionGroups: ConnectionGroup[];
  loadConnections: (options?: { ifNeeded?: boolean }) => Promise<void>;
  isLoadingConnections: boolean;
  connect: (connectionId: string, options?: { activate?: boolean }) => Promise<void>;
  disconnect: (connectionId?: string) => Promise<void>;
  /**
   * Remove a connection from THIS window's UI without closing its backend pool.
   * Used when handing a connection off to a dedicated window (the pool is
   * process-global and reused by the new window, which owns it from then on).
   */
  detachConnection: (connectionId: string) => void;
  switchConnection: (connectionId: string) => void;
  setActiveTable: (table: string | null, schema?: string | null) => void;
  refreshTables: (connectionId?: string) => Promise<void>;
  refreshViews: (connectionId?: string) => Promise<void>;
  refreshRoutines: (connectionId?: string) => Promise<void>;
  refreshTriggers: (connectionId?: string) => Promise<void>;
  loadSchemaData: (schema: string, connectionId?: string) => Promise<void>;
  refreshSchemaData: (schema: string, connectionId?: string) => Promise<void>;
  setSelectedSchemas: (schemas: string[], connectionId?: string) => Promise<void>;
  loadDatabaseData: (database: string, connectionId?: string) => Promise<void>;
  refreshDatabaseData: (database: string, connectionId?: string) => Promise<void>;
  setSelectedDatabases: (databases: string[], connectionId?: string) => void;
  /** Fetches the schema list for one database of a schema-based multi-db
   * connection and its saved schema selection/preference (scoped to that
   * database — see `schema_storage_key` on the backend). No-op if already
   * loaded/loading. */
  loadNestedSchemas: (database: string, connectionId?: string) => Promise<void>;
  /** Sets which schemas are selected for one database of a schema-based
   * multi-db connection, persists the selection, and loads any newly
   * selected schema's table/view/routine/trigger data. */
  setSelectedSchemasForDatabase: (
    database: string,
    schemas: string[],
    connectionId?: string,
  ) => Promise<void>;
  loadNestedSchemaData: (database: string, schema: string, connectionId?: string) => Promise<void>;
  refreshNestedSchemaData: (database: string, schema: string, connectionId?: string) => Promise<void>;
  refreshDatabaseSelection: (
    connectionId: string,
    options?: { notifyWhenUnchanged?: boolean },
  ) => Promise<void>;
  getConnectionData: (connectionId: string) => ConnectionData | undefined;
  isConnectionOpen: (connectionId: string) => boolean;
  /** Connection ids open in ANY window (shared backend registry). */
  globallyOpenConnectionIds: string[];
  /** True when the connection is open in this window OR another window. */
  isConnectionOpenAnywhere: (connectionId: string) => boolean;
  // Connection Group methods
  createGroup: (name: string, parentId?: string | null) => Promise<ConnectionGroup>;
  /**
   * Creates a nested hierarchy from a `/`-separated path (e.g.
   * "TEST/flexways"). Existing segments are reused, missing ones are
   * created. Returns the deepest (last) group.
   */
  createGroupPath: (path: string, parentId?: string | null) => Promise<ConnectionGroup>;
  updateGroup: (id: string, updates: { name?: string; collapsed?: boolean; sort_order?: number }) => Promise<void>;
  /** Re-parent a group. `parentId === null` moves the group to the top
   * level; `undefined` would be a no-op (kept distinct to match the
   * Tauri command's `Option<String>` parameter). */
  moveGroupToParent: (id: string, parentId: string | null) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  moveConnectionToGroup: (connectionId: string, groupId: string | null) => Promise<void>;
  reorderGroups: (groupOrders: Array<[string, number]>) => Promise<void>;
  reorderConnectionsInGroup: (connectionOrders: Array<[string, number]>) => Promise<void>;
  toggleGroupCollapsed: (groupId: string) => Promise<void>;
}

export const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);
