import { createContext } from 'react';
import type { DriverCapabilities } from '../types/plugins';

export interface TableInfo {
  name: string;
  schema?: string; // database/schema the table belongs to (populated in multiDb mode)
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
    startup_script?: string;
  };
  group_id?: string;
  sort_order?: number;
  /** Per-connection opt-in: detect JSON in plain text columns. */
  detect_json_in_text_columns?: boolean;
  appearance?: ConnectionAppearance;
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
  isLoading: boolean;
  isLoaded: boolean;
}

export interface ConnectionData {
  driver: string;
  capabilities: DriverCapabilities | null;
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
  schemas: string[];
  isLoadingSchemas: boolean;
  schemaDataMap: Record<string, SchemaData>;
  activeSchema: string | null;
  selectedSchemas: string[];
  needsSchemaSelection: boolean;
  selectedDatabases: string[];
  databaseDataMap: Record<string, SchemaData>;
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
  schemas: string[];
  isLoadingSchemas: boolean;
  schemaDataMap: Record<string, SchemaData>;
  activeSchema: string | null;
  selectedSchemas: string[];
  needsSchemaSelection: boolean;
  selectedDatabases: string[];
  databaseDataMap: Record<string, SchemaData>;
  connections: SavedConnection[];
  connectionGroups: ConnectionGroup[];
  loadConnections: () => Promise<void>;
  isLoadingConnections: boolean;
  connect: (connectionId: string) => Promise<void>;
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
