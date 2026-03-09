import { createContext } from 'react';
import type { DriverCapabilities } from '../types/plugins';

export interface TableInfo {
  name: string;
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
  };
  group_id?: string;
  sort_order?: number;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  collapsed: boolean;
  sort_order: number;
}

export interface ConnectionsFile {
  groups: ConnectionGroup[];
  connections: SavedConnection[];
}

export interface SchemaData {
  tables: TableInfo[];
  views: ViewInfo[];
  routines: RoutineInfo[];
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
  isLoadingTables: boolean;
  isLoadingViews: boolean;
  isLoadingRoutines: boolean;
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
  routines: RoutineInfo[];
  isLoadingTables: boolean;
  isLoadingViews: boolean;
  isLoadingRoutines: boolean;
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
  switchConnection: (connectionId: string) => void;
  setActiveTable: (table: string | null, schema?: string | null) => void;
  refreshTables: (connectionId?: string) => Promise<void>;
  refreshViews: (connectionId?: string) => Promise<void>;
  refreshRoutines: (connectionId?: string) => Promise<void>;
  loadSchemaData: (schema: string, connectionId?: string) => Promise<void>;
  refreshSchemaData: (schema: string, connectionId?: string) => Promise<void>;
  setSelectedSchemas: (schemas: string[], connectionId?: string) => Promise<void>;
  loadDatabaseData: (database: string, connectionId?: string) => Promise<void>;
  refreshDatabaseData: (database: string, connectionId?: string) => Promise<void>;
  setSelectedDatabases: (databases: string[], connectionId?: string) => void;
  getConnectionData: (connectionId: string) => ConnectionData | undefined;
  isConnectionOpen: (connectionId: string) => boolean;
  // Connection Group methods
  createGroup: (name: string) => Promise<ConnectionGroup>;
  updateGroup: (id: string, updates: { name?: string; collapsed?: boolean; sort_order?: number }) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  moveConnectionToGroup: (connectionId: string, groupId: string | null) => Promise<void>;
  reorderGroups: (groupOrders: Array<[string, number]>) => Promise<void>;
  reorderConnectionsInGroup: (connectionOrders: Array<[string, number]>) => Promise<void>;
  toggleGroupCollapsed: (groupId: string) => Promise<void>;
}

export const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);
