import type { ReactNode } from 'react';
import { DatabaseContext } from '../../contexts/DatabaseContext';
import { useDatabase } from '../../hooks/useDatabase';

interface Props {
  connectionId: string;
  children: ReactNode;
}

/** Overrides DatabaseContext for a single split panel with the given connectionId */
export const PanelDatabaseProvider = ({ connectionId, children }: Props) => {
  const sharedContext = useDatabase();
  const data = sharedContext.connectionDataMap[connectionId];

  return (
    <DatabaseContext.Provider
      value={{
        ...sharedContext,
        // Read fields — scoped to this panel's connection
        activeConnectionId: connectionId,
        activeDriver: data?.driver ?? null,
        activeCapabilities: data?.capabilities ?? null,
        activeConnectionName: data?.connectionName ?? null,
        activeDatabaseName: data?.databaseName ?? null,
        tables: data?.tables ?? [],
        views: data?.views ?? [],
        routines: data?.routines ?? [],
        isLoadingTables: data?.isLoadingTables ?? false,
        isLoadingViews: data?.isLoadingViews ?? false,
        isLoadingRoutines: data?.isLoadingRoutines ?? false,
        routineError: data?.routineError ?? null,
        schemas: data?.schemas ?? [],
        isLoadingSchemas: data?.isLoadingSchemas ?? false,
        schemaDataMap: data?.schemaDataMap ?? {},
        activeSchema: data?.activeSchema ?? null,
        selectedSchemas: data?.selectedSchemas ?? [],
        needsSchemaSelection: data?.needsSchemaSelection ?? false,
        selectedDatabases: data?.selectedDatabases ?? [],
        databaseDataMap: data?.databaseDataMap ?? {},
        // Mutation functions — bound to this panel's connectionId
        refreshTables: () => sharedContext.refreshTables(connectionId),
        refreshViews: () => sharedContext.refreshViews(connectionId),
        refreshRoutines: () => sharedContext.refreshRoutines(connectionId),
        loadSchemaData: (schema: string) => sharedContext.loadSchemaData(schema, connectionId),
        refreshSchemaData: (schema: string) => sharedContext.refreshSchemaData(schema, connectionId),
        setSelectedSchemas: (schemas: string[]) => sharedContext.setSelectedSchemas(schemas, connectionId),
        loadDatabaseData: (database: string) => sharedContext.loadDatabaseData(database, connectionId),
        refreshDatabaseData: (database: string) => sharedContext.refreshDatabaseData(database, connectionId),
        setSelectedDatabases: (databases: string[]) => sharedContext.setSelectedDatabases(databases, connectionId),
      }}
    >
      {children}
    </DatabaseContext.Provider>
  );
};
