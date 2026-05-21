import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  DatabaseContext,
  type TableInfo,
  type ViewInfo,
  type RoutineInfo,
  type TriggerInfo,
  type SavedConnection,
  type ConnectionData,
  type ConnectionGroup,
  type ConnectionsFile,
} from './DatabaseContext';
import type { ReactNode } from 'react';
import type { PluginManifest } from '../types/plugins';
import { clearAutocompleteCache } from '../utils/autocomplete';
import { toErrorMessage } from '../utils/errors';
import { useSettings } from '../hooks/useSettings';
import { findConnectionsForDrivers } from '../utils/connectionManager';
import { isMultiDatabaseCapable, getEffectiveDatabase, getDatabaseList } from '../utils/database';

const createEmptyConnectionData = (driver: string = '', name: string = '', dbName: string = ''): ConnectionData => ({
  driver,
  capabilities: null,
  connectionName: name,
  databaseName: dbName,
  tables: [],
  views: [],
  routines: [],
  triggers: [],
  isLoadingTables: false,
  isLoadingViews: false,
  isLoadingRoutines: false,
  isLoadingTriggers: false,
  schemas: [],
  isLoadingSchemas: false,
  schemaDataMap: {},
  activeSchema: null,
  selectedSchemas: [],
  needsSchemaSelection: false,
  selectedDatabases: [],
  databaseDataMap: {},
  isConnecting: false,
  isConnected: false,
});

export const DatabaseProvider = ({ children }: { children: ReactNode }) => {
  const { settings } = useSettings();
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [openConnectionIds, setOpenConnectionIds] = useState<string[]>([]);
  const [connectionDataMap, setConnectionDataMap] = useState<Record<string, ConnectionData>>({});
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [connectionGroups, setConnectionGroups] = useState<ConnectionGroup[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);

  // Refs used in the plugin-disable effect to avoid stale closures
  const openConnectionIdsRef = useRef(openConnectionIds);
  openConnectionIdsRef.current = openConnectionIds;
  const connectionDataMapRef = useRef(connectionDataMap);
  connectionDataMapRef.current = connectionDataMap;
  const prevActiveExtRef = useRef<string[] | undefined>(undefined);

  const getActiveConnectionData = useCallback((): ConnectionData | undefined => {
    if (!activeConnectionId) return undefined;
    return connectionDataMap[activeConnectionId];
  }, [activeConnectionId, connectionDataMap]);

  const activeData = getActiveConnectionData();

  const activeDriver = activeData?.driver ?? null;
  const activeCapabilities = activeData?.capabilities ?? null;
  const activeConnectionName = activeData?.connectionName ?? null;
  const activeDatabaseName = activeData?.databaseName ?? null;
  const tables = activeData?.tables ?? [];
  const views = activeData?.views ?? [];
  const routines = activeData?.routines ?? [];
  const triggers = activeData?.triggers ?? [];
  const isLoadingTables = activeData?.isLoadingTables ?? false;
  const isLoadingViews = activeData?.isLoadingViews ?? false;
  const isLoadingRoutines = activeData?.isLoadingRoutines ?? false;
  const isLoadingTriggers = activeData?.isLoadingTriggers ?? false;
  const schemas = activeData?.schemas ?? [];
  const isLoadingSchemas = activeData?.isLoadingSchemas ?? false;
  const schemaDataMap = activeData?.schemaDataMap ?? {};
  const activeSchema = activeData?.activeSchema ?? null;
  const selectedSchemas = activeData?.selectedSchemas ?? [];
  const needsSchemaSelection = activeData?.needsSchemaSelection ?? false;
  const selectedDatabases = useMemo(() => activeData?.selectedDatabases ?? [], [activeData?.selectedDatabases]);
  const databaseDataMap = activeData?.databaseDataMap ?? {};

  useEffect(() => {
    const updateTitle = async () => {
      try {
        let title = 'tabularis';
        if (activeConnectionName && activeDatabaseName) {
          const schemaSuffix = activeSchema && activeCapabilities?.schemas === true ? `/${activeSchema}` : '';
          const dbDisplay =
            isMultiDatabaseCapable(activeCapabilities) && selectedDatabases.length > 1
              ? (activeSchema ?? activeDatabaseName)
              : activeDatabaseName;
          title = `tabularis - ${activeConnectionName} (${dbDisplay}${schemaSuffix})`;
        }
        await invoke('set_window_title', { title });
      } catch (e) {
        console.error('Failed to update window title', e);
      }
    };
    updateTitle();
  }, [activeConnectionName, activeDatabaseName, activeSchema, activeCapabilities, selectedDatabases]);

  const updateConnectionData = useCallback((connectionId: string, updates: Partial<ConnectionData>) => {
    setConnectionDataMap(prev => ({
      ...prev,
      [connectionId]: {
        ...prev[connectionId],
        ...updates,
      },
    }));
  }, []);

  const refreshTables = async (targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;
    updateConnectionData(connId, { isLoadingTables: true });
    try {
      const result = await invoke<TableInfo[]>('get_tables', { connectionId: connId });
      updateConnectionData(connId, { tables: result, isLoadingTables: false });
    } catch (e) {
      console.error('Failed to refresh tables:', e);
      updateConnectionData(connId, { isLoadingTables: false, error: toErrorMessage(e) });
    }
  };

  const refreshViews = async (targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;
    updateConnectionData(connId, { isLoadingViews: true });
    try {
      const result = await invoke<ViewInfo[]>('get_views', { connectionId: connId });
      updateConnectionData(connId, { views: result, isLoadingViews: false });
    } catch (e) {
      console.error('Failed to refresh views:', e);
      updateConnectionData(connId, { isLoadingViews: false, error: toErrorMessage(e) });
    }
  };

  const refreshRoutines = async (targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;
    updateConnectionData(connId, { isLoadingRoutines: true });
    try {
      const result = await invoke<RoutineInfo[]>('get_routines', { connectionId: connId });
      updateConnectionData(connId, { routines: result, isLoadingRoutines: false });
    } catch (e) {
      console.error('Failed to refresh routines:', e);
      updateConnectionData(connId, { isLoadingRoutines: false, error: toErrorMessage(e) });
    }
  };

  const refreshTriggers = async (targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;
    updateConnectionData(connId, { isLoadingTriggers: true });
    try {
      const result = await invoke<TriggerInfo[]>('get_triggers', { connectionId: connId });
      updateConnectionData(connId, { triggers: result, isLoadingTriggers: false });
    } catch (e) {
      console.error('Failed to refresh triggers:', e);
      updateConnectionData(connId, { isLoadingTriggers: false, error: toErrorMessage(e) });
    }
  };

  const loadSchemaData = useCallback(async (schema: string, targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;

    const currentData = connectionDataMap[connId];
    if (!currentData) return;

    const existingSchemaData = currentData.schemaDataMap[schema];
    if (existingSchemaData?.isLoaded || existingSchemaData?.isLoading) return;

    updateConnectionData(connId, {
      schemaDataMap: {
        ...currentData.schemaDataMap,
        [schema]: { tables: [], views: [], routines: [], triggers: [], isLoading: true, isLoaded: false },
      },
    });

    try {
      const [tablesResult, viewsResult, routinesResult, triggersResult] = await Promise.all([
        invoke<TableInfo[]>('get_tables', { connectionId: connId, schema }),
        invoke<ViewInfo[]>('get_views', { connectionId: connId, schema }),
        invoke<RoutineInfo[]>('get_routines', { connectionId: connId, schema }),
        invoke<TriggerInfo[]>('get_triggers', { connectionId: connId, schema }).catch(() => [] as TriggerInfo[]),
      ]);

      const freshData = connectionDataMap[connId];
      if (freshData) {
        updateConnectionData(connId, {
          schemaDataMap: {
            ...freshData.schemaDataMap,
            [schema]: {
              tables: tablesResult,
              views: viewsResult,
              routines: routinesResult,
              triggers: triggersResult,
              isLoading: false,
              isLoaded: true,
            },
          },
        });
      }
    } catch (e) {
      console.error(`Failed to load schema data for ${schema}:`, e);
      const freshData = connectionDataMap[connId];
      if (freshData) {
        updateConnectionData(connId, {
          schemaDataMap: {
            ...freshData.schemaDataMap,
            [schema]: { tables: [], views: [], routines: [], triggers: [], isLoading: false, isLoaded: false },
          },
        });
      }
    }
  }, [activeConnectionId, connectionDataMap, updateConnectionData]);

  const refreshSchemaData = useCallback(async (schema: string, targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;

    const currentData = connectionDataMap[connId];
    if (!currentData) return;

    updateConnectionData(connId, {
      schemaDataMap: {
        ...currentData.schemaDataMap,
        [schema]: {
          ...(currentData.schemaDataMap[schema] || { tables: [], views: [], routines: [], triggers: [], isLoaded: false }),
          isLoading: true
        },
      },
    });

    try {
      const [tablesResult, viewsResult, routinesResult, triggersResult] = await Promise.all([
        invoke<TableInfo[]>('get_tables', { connectionId: connId, schema }),
        invoke<ViewInfo[]>('get_views', { connectionId: connId, schema }),
        invoke<RoutineInfo[]>('get_routines', { connectionId: connId, schema }),
        invoke<TriggerInfo[]>('get_triggers', { connectionId: connId, schema }).catch(() => [] as TriggerInfo[]),
      ]);

      const freshData = connectionDataMap[connId];
      if (freshData) {
        updateConnectionData(connId, {
          schemaDataMap: {
            ...freshData.schemaDataMap,
            [schema]: {
              tables: tablesResult,
              views: viewsResult,
              routines: routinesResult,
              triggers: triggersResult,
              isLoading: false,
              isLoaded: true,
            },
          },
        });
      }
    } catch (e) {
      console.error(`Failed to refresh schema data for ${schema}:`, e);
      const freshData = connectionDataMap[connId];
      if (freshData) {
        updateConnectionData(connId, {
          schemaDataMap: {
            ...freshData.schemaDataMap,
            [schema]: {
              ...(freshData.schemaDataMap[schema] || { tables: [], views: [], routines: [], triggers: [], isLoaded: false }),
              isLoading: false
            },
          },
        });
      }
    }
  }, [activeConnectionId, connectionDataMap, updateConnectionData]);

  const loadDatabaseData = useCallback(async (database: string, targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;

    const currentData = connectionDataMap[connId];
    if (!currentData) return;

    const existing = currentData.databaseDataMap[database];
    if (existing?.isLoaded || existing?.isLoading) return;

    updateConnectionData(connId, {
      databaseDataMap: {
        ...currentData.databaseDataMap,
        [database]: { tables: [], views: [], routines: [], triggers: [], isLoading: true, isLoaded: false },
      },
    });

    try {
      const [tablesResult, viewsResult, routinesResult, triggersResult] = await Promise.all([
        invoke<TableInfo[]>('get_tables', { connectionId: connId, schema: database }),
        invoke<ViewInfo[]>('get_views', { connectionId: connId, schema: database }),
        invoke<RoutineInfo[]>('get_routines', { connectionId: connId, schema: database }),
        invoke<TriggerInfo[]>('get_triggers', { connectionId: connId, schema: database }).catch(() => [] as TriggerInfo[]),
      ]);

      const freshData = connectionDataMap[connId];
      if (freshData) {
        updateConnectionData(connId, {
          databaseDataMap: {
            ...freshData.databaseDataMap,
            [database]: {
              tables: tablesResult,
              views: viewsResult,
              routines: routinesResult,
              triggers: triggersResult,
              isLoading: false,
              isLoaded: true,
            },
          },
        });
      }
    } catch (e) {
      console.error(`Failed to load database data for ${database}:`, e);
      const freshData = connectionDataMap[connId];
      if (freshData) {
        updateConnectionData(connId, {
          databaseDataMap: {
            ...freshData.databaseDataMap,
            [database]: { tables: [], views: [], routines: [], triggers: [], isLoading: false, isLoaded: false },
          },
        });
      }
    }
  }, [activeConnectionId, connectionDataMap, updateConnectionData]);

  const refreshDatabaseData = useCallback(async (database: string, targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;

    const currentData = connectionDataMap[connId];
    if (!currentData) return;

    updateConnectionData(connId, {
      databaseDataMap: {
        ...currentData.databaseDataMap,
        [database]: {
          ...(currentData.databaseDataMap[database] || { tables: [], views: [], routines: [], triggers: [], isLoaded: false }),
          isLoading: true,
        },
      },
    });

    try {
      const [tablesResult, viewsResult, routinesResult, triggersResult] = await Promise.all([
        invoke<TableInfo[]>('get_tables', { connectionId: connId, schema: database }),
        invoke<ViewInfo[]>('get_views', { connectionId: connId, schema: database }),
        invoke<RoutineInfo[]>('get_routines', { connectionId: connId, schema: database }),
        invoke<TriggerInfo[]>('get_triggers', { connectionId: connId, schema: database }).catch(() => [] as TriggerInfo[]),
      ]);

      const freshData = connectionDataMap[connId];
      if (freshData) {
        updateConnectionData(connId, {
          databaseDataMap: {
            ...freshData.databaseDataMap,
            [database]: {
              tables: tablesResult,
              views: viewsResult,
              routines: routinesResult,
              triggers: triggersResult,
              isLoading: false,
              isLoaded: true,
            },
          },
        });
      }
    } catch (e) {
      console.error(`Failed to refresh database data for ${database}:`, e);
      const freshData = connectionDataMap[connId];
      if (freshData) {
        updateConnectionData(connId, {
          databaseDataMap: {
            ...freshData.databaseDataMap,
            [database]: {
              ...(freshData.databaseDataMap[database] || { tables: [], views: [], routines: [], triggers: [], isLoaded: false }),
              isLoading: false,
            },
          },
        });
      }
    }
  }, [activeConnectionId, connectionDataMap, updateConnectionData]);

  const setSelectedSchemas = useCallback(async (newSchemas: string[], targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;

    const currentData = connectionDataMap[connId];
    if (!currentData) return;

    updateConnectionData(connId, {
      selectedSchemas: newSchemas,
      needsSchemaSelection: false
    });

    try {
      await invoke('set_selected_schemas', {
        connectionId: connId,
        schemas: newSchemas,
      });
    } catch (e) {
      console.error('Failed to persist selected schemas:', e);
    }

    for (const schema of newSchemas) {
      const existing = currentData.schemaDataMap[schema];
      if (!existing?.isLoaded && !existing?.isLoading) {
        loadSchemaData(schema, connId);
      }
    }

    if (!currentData.activeSchema || !newSchemas.includes(currentData.activeSchema)) {
      const nextSchema = newSchemas[0] || null;
      updateConnectionData(connId, { activeSchema: nextSchema });
      if (nextSchema) {
        invoke('set_schema_preference', { connectionId: connId, schema: nextSchema }).catch(() => {});
      }
    }
  }, [activeConnectionId, connectionDataMap, updateConnectionData, loadSchemaData]);

  const setSelectedDatabases = useCallback((newDatabases: string[], targetConnectionId?: string) => {
    const connId = targetConnectionId ?? activeConnectionId;
    if (!connId) return;
    const currentData = connectionDataMap[connId];
    if (!currentData) return;

    updateConnectionData(connId, { selectedDatabases: newDatabases });

    for (const db of newDatabases) {
      const existing = currentData.databaseDataMap[db];
      if (!existing?.isLoaded && !existing?.isLoading) {
        loadDatabaseData(db, connId);
      }
    }
  }, [activeConnectionId, connectionDataMap, updateConnectionData, loadDatabaseData]);

  const connect = async (connectionId: string) => {
    // Capture previous state so we can restore it on failure
    const prevActiveConnectionId = activeConnectionId;

    // Set loading state synchronously before any await so UI reflects loading immediately
    if (!openConnectionIds.includes(connectionId)) {
      setOpenConnectionIds(prev => [...prev, connectionId]);
    }

    setConnectionDataMap(prev => ({
      ...prev,
      [connectionId]: {
        ...createEmptyConnectionData(),
        isConnecting: true,
        isConnected: false,
        isLoadingTables: true,
        isLoadingViews: true,
        isLoadingRoutines: true,
      },
    }));

    setActiveConnectionId(connectionId);
    setActiveTable(null);

    try {
      const allConnections = await invoke<SavedConnection[]>('get_connections');
      const conn = allConnections.find(c => c.id === connectionId);
      if (!conn) {
        throw new Error('Connection not found');
      }

      const driver = conn.params.driver;

      // Fetch driver manifest to access capabilities (driver-agnostic feature detection)
      let driverManifest: PluginManifest | null = null;
      try {
        driverManifest = await invoke<PluginManifest | null>('get_driver_manifest', { driverId: driver });
      } catch {
        // Manifest not found; capabilities will be null and features will degrade gracefully
      }

      const capabilities = driverManifest?.capabilities ?? null;
      const dbParam = conn.params.database; // string | string[]
      const primaryDb = getEffectiveDatabase(dbParam);

      updateConnectionData(connectionId, {
        driver,
        capabilities,
        connectionName: conn.name,
        databaseName: primaryDb,
      });

      try {
        await invoke<string>('test_connection', {
          request: {
            params: conn.params,
            connection_id: connectionId,
          },
        });
      } catch (testError) {
        const errorMsg = toErrorMessage(testError);
        updateConnectionData(connectionId, {
          isConnecting: false,
          isConnected: false,
          isLoadingTables: false,
          isLoadingViews: false,
          isLoadingRoutines: false,
          error: errorMsg
        });
        setOpenConnectionIds(prev => prev.filter(id => id !== connectionId));
        throw new Error(errorMsg);
      }

      // Register for health-check pinging.
      await invoke('register_active_connection', { connectionId });

      const isMultiDb = isMultiDatabaseCapable(capabilities) && Array.isArray(dbParam) && dbParam.length > 1;

      if (isMultiDb) {
        const dbList = getDatabaseList(dbParam);
        const firstDb = dbList[0] ?? '';

        // Pre-load first database inline
        let initialDbMap: Record<string, import('./DatabaseContext').SchemaData> = {};
        if (firstDb) {
          try {
            const [tablesResult, viewsResult, routinesResult, triggersResult] = await Promise.all([
              invoke<TableInfo[]>('get_tables', { connectionId, schema: firstDb }),
              invoke<ViewInfo[]>('get_views', { connectionId, schema: firstDb }),
              invoke<RoutineInfo[]>('get_routines', { connectionId, schema: firstDb }),
              invoke<TriggerInfo[]>('get_triggers', { connectionId, schema: firstDb }).catch(() => [] as TriggerInfo[]),
            ]);
            initialDbMap = {
              [firstDb]: {
                tables: tablesResult,
                views: viewsResult,
                routines: routinesResult,
                triggers: triggersResult,
                isLoading: false,
                isLoaded: true,
              },
            };
          } catch (e) {
            console.error(`Failed to pre-load database ${firstDb}:`, e);
          }
        }

        updateConnectionData(connectionId, {
          selectedDatabases: dbList,
          databaseDataMap: initialDbMap,
          isLoadingTables: false,
          isLoadingViews: false,
          isLoadingRoutines: false,
          isLoadingTriggers: false,
          isConnecting: false,
          isConnected: true,
        });
      } else if (capabilities?.schemas === true) {
        updateConnectionData(connectionId, { isLoadingSchemas: true });

        try {
          const schemasResult = await invoke<string[]>('get_schemas', { connectionId });
          updateConnectionData(connectionId, { schemas: schemasResult });

          let savedSelection: string[] = [];
          try {
            savedSelection = await invoke<string[]>('get_selected_schemas', { connectionId });
          } catch {
            // Ignore - no saved selection exists yet
          }

          const validSelection = savedSelection.filter(s => schemasResult.includes(s));

          if (validSelection.length > 0) {
            let preferredSchema = validSelection[0];
            try {
              const saved = await invoke<string | null>('get_schema_preference', { connectionId });
              if (saved && validSelection.includes(saved)) {
                preferredSchema = saved;
              }
            } catch {
              // Ignore - no saved preference exists yet
            }

            const [tablesResult, viewsResult, routinesResult, triggersResult] = await Promise.all([
              invoke<TableInfo[]>('get_tables', { connectionId, schema: preferredSchema }),
              invoke<ViewInfo[]>('get_views', { connectionId, schema: preferredSchema }),
              invoke<RoutineInfo[]>('get_routines', { connectionId, schema: preferredSchema }),
              invoke<TriggerInfo[]>('get_triggers', { connectionId, schema: preferredSchema }).catch(() => [] as TriggerInfo[]),
            ]);

            updateConnectionData(connectionId, {
              selectedSchemas: validSelection,
              needsSchemaSelection: false,
              activeSchema: preferredSchema,
              schemaDataMap: {
                [preferredSchema]: {
                  tables: tablesResult,
                  views: viewsResult,
                  routines: routinesResult,
                  triggers: triggersResult,
                  isLoading: false,
                  isLoaded: true,
                },
              },
              isLoadingSchemas: false,
              isLoadingTables: false,
              isLoadingViews: false,
              isLoadingRoutines: false,
              isLoadingTriggers: false,
              isConnecting: false,
              isConnected: true,
            });
          } else {
            updateConnectionData(connectionId, {
              selectedSchemas: [],
              needsSchemaSelection: true,
              isLoadingSchemas: false,
              isLoadingTables: false,
              isLoadingViews: false,
              isLoadingRoutines: false,
              isLoadingTriggers: false,
              isConnecting: false,
              isConnected: true,
            });
          }
        } catch (e) {
          console.error('Failed to fetch schemas:', e);
          updateConnectionData(connectionId, {
            isLoadingSchemas: false,
            isLoadingTables: false,
            isLoadingViews: false,
            isLoadingRoutines: false,
            isLoadingTriggers: false,
            isConnecting: false,
            isConnected: true,
          });
        }
      } else {
        const [tablesResult, viewsResult, routinesResult, triggersResult] = await Promise.all([
          invoke<TableInfo[]>('get_tables', { connectionId }),
          invoke<ViewInfo[]>('get_views', { connectionId }),
          invoke<RoutineInfo[]>('get_routines', { connectionId }),
          invoke<TriggerInfo[]>('get_triggers', { connectionId }).catch(() => [] as TriggerInfo[]),
        ]);

        updateConnectionData(connectionId, {
          tables: tablesResult,
          views: viewsResult,
          routines: routinesResult,
          triggers: triggersResult,
          isLoadingTables: false,
          isLoadingViews: false,
          isLoadingRoutines: false,
          isLoadingTriggers: false,
          isConnecting: false,
          isConnected: true,
        });
      }
    } catch (error) {
      console.error('Failed to connect:', error);
      setConnectionDataMap(prev => {
        const newMap = { ...prev };
        delete newMap[connectionId];
        return newMap;
      });
      setOpenConnectionIds(prev => prev.filter(id => id !== connectionId));
      setActiveConnectionId(prevActiveConnectionId);
      throw error;
    }
  };

  const disconnect = async (connectionId?: string) => {
    const targetId = connectionId || activeConnectionId;
    if (!targetId) return;

    clearAutocompleteCache(targetId);

    try {
      await invoke('disconnect_connection', { connectionId: targetId });
    } catch (error) {
      console.error(`[DatabaseProvider] Failed to disconnect from ${targetId}:`, error);
    }

    setOpenConnectionIds(prev => prev.filter(id => id !== targetId));
    setConnectionDataMap(prev => {
      const newMap = { ...prev };
      delete newMap[targetId];
      return newMap;
    });

    if (activeConnectionId === targetId) {
      const remainingIds = openConnectionIds.filter(id => id !== targetId);
      if (remainingIds.length > 0) {
        setActiveConnectionId(remainingIds[0]);
      } else {
        setActiveConnectionId(null);
        setActiveTable(null);
      }
    }
  };

  const switchConnection = useCallback((connectionId: string) => {
    if (openConnectionIds.includes(connectionId)) {
      setActiveConnectionId(connectionId);
      setActiveTable(null);
    }
  }, [openConnectionIds]);

  const setActiveTableWithSchema = useCallback((table: string | null, schema?: string | null) => {
    setActiveTable(table);
    if (schema !== undefined && schema !== null && activeConnectionId) {
      updateConnectionData(activeConnectionId, { activeSchema: schema });
      invoke('set_schema_preference', { connectionId: activeConnectionId, schema }).catch(() => {});
    }
  }, [activeConnectionId, updateConnectionData]);

  const loadConnections = useCallback(async () => {
    setIsLoadingConnections(true);
    try {
      const result = await invoke<ConnectionsFile>('get_connections_with_groups');
      setConnections(result.connections);
      setConnectionGroups(result.groups);
    } catch (e) {
      console.error('Failed to load connections:', e);
    } finally {
      setIsLoadingConnections(false);
    }
  }, []);

  const getConnectionData = useCallback((connectionId: string): ConnectionData | undefined => {
    return connectionDataMap[connectionId];
  }, [connectionDataMap]);

  const isConnectionOpen = useCallback((connectionId: string): boolean => {
    return openConnectionIds.includes(connectionId);
  }, [openConnectionIds]);

  // Auto-disconnect open connections when their plugin is disabled
  useEffect(() => {
    const currActiveExt = settings.activeExternalDrivers ?? [];
    const prevActiveExt = prevActiveExtRef.current;
    prevActiveExtRef.current = currActiveExt;

    // Skip on first render — no change to detect
    if (prevActiveExt === undefined) return;

    const removedDrivers = prevActiveExt.filter(id => !currActiveExt.includes(id));
    if (removedDrivers.length === 0) return;

    const toDisconnect = findConnectionsForDrivers(
      openConnectionIdsRef.current,
      connectionDataMapRef.current,
      removedDrivers,
    );
    toDisconnect.forEach(id => disconnect(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.activeExternalDrivers]);

  // Listen for backend health-check failures and clean up dead connections.
  useEffect(() => {
    const unlisten = listen<{ connectionId: string; error: string }>(
      'connection-health-failed',
      (event) => {
        const { connectionId } = event.payload;
        console.warn(`[DatabaseProvider] Connection health check failed for ${connectionId}: ${event.payload.error}`);

        clearAutocompleteCache(connectionId);

        setOpenConnectionIds(prev => prev.filter(id => id !== connectionId));
        setConnectionDataMap(prev => {
          const next = { ...prev };
          delete next[connectionId];
          return next;
        });

        setActiveConnectionId(prev => {
          if (prev !== connectionId) return prev;
          const remaining = openConnectionIdsRef.current.filter(id => id !== connectionId);
          if (remaining.length > 0) return remaining[0];
          setActiveTable(null);
          return null;
        });
      },
    );
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Connection Group methods
  const createGroup = useCallback(async (name: string): Promise<ConnectionGroup> => {
    const group = await invoke<ConnectionGroup>('create_connection_group', { name });
    setConnectionGroups(prev => [...prev, group]);
    return group;
  }, []);

  const updateGroup = useCallback(async (
    id: string,
    updates: { name?: string; collapsed?: boolean; sort_order?: number }
  ): Promise<void> => {
    await invoke('update_connection_group', { id, ...updates });
    setConnectionGroups(prev =>
      prev.map(g => (g.id === id ? { ...g, ...updates } : g))
    );
  }, []);

  const deleteGroup = useCallback(async (id: string): Promise<void> => {
    await invoke('delete_connection_group', { id });
    setConnectionGroups(prev => prev.filter(g => g.id !== id));
    // Update connections that were in this group
    setConnections(prev =>
      prev.map(c => (c.group_id === id ? { ...c, group_id: undefined } : c))
    );
  }, []);

  const moveConnectionToGroup = useCallback(async (
    connectionId: string,
    groupId: string | null
  ): Promise<void> => {
    await invoke('move_connection_to_group', { connectionId, groupId });
    setConnections(prev =>
      prev.map(c => (c.id === connectionId ? { ...c, group_id: groupId ?? undefined } : c))
    );
  }, []);

  const reorderGroups = useCallback(async (
    groupOrders: Array<[string, number]>
  ): Promise<void> => {
    await invoke('reorder_groups', { groupOrders });
    setConnectionGroups(prev => {
      const orderMap = new Map(groupOrders);
      return prev.map(g => ({
        ...g,
        sort_order: orderMap.get(g.id) ?? g.sort_order,
      })).sort((a, b) => a.sort_order - b.sort_order);
    });
  }, []);

  const reorderConnectionsInGroup = useCallback(async (
    connectionOrders: Array<[string, number]>
  ): Promise<void> => {
    await invoke('reorder_connections_in_group', { connectionOrders });
    setConnections(prev => {
      const orderMap = new Map(connectionOrders);
      return prev.map(c => ({
        ...c,
        sort_order: orderMap.get(c.id) ?? c.sort_order,
      }));
    });
  }, []);

  const toggleGroupCollapsed = useCallback(async (groupId: string): Promise<void> => {
    const group = connectionGroups.find(g => g.id === groupId);
    if (group) {
      await updateGroup(groupId, { collapsed: !group.collapsed });
    }
  }, [connectionGroups, updateGroup]);

  return (
    <DatabaseContext.Provider value={{
      activeConnectionId,
      openConnectionIds,
      connectionDataMap,
      activeTable,
      activeDriver,
      activeCapabilities,
      activeConnectionName,
      activeDatabaseName,
      tables,
      views,
      routines,
      triggers,
      isLoadingTables,
      isLoadingViews,
      isLoadingRoutines,
      isLoadingTriggers,
      schemas,
      isLoadingSchemas,
      schemaDataMap,
      activeSchema,
      selectedSchemas,
      needsSchemaSelection,
      selectedDatabases,
      databaseDataMap,
      connections,
      connectionGroups,
      loadConnections,
      isLoadingConnections,
      connect,
      disconnect,
      switchConnection,
      setActiveTable: setActiveTableWithSchema,
      refreshTables,
      refreshViews,
      refreshRoutines,
      refreshTriggers,
      loadSchemaData,
      refreshSchemaData,
      setSelectedSchemas,
      loadDatabaseData,
      refreshDatabaseData,
      setSelectedDatabases,
      getConnectionData,
      isConnectionOpen,
      createGroup,
      updateGroup,
      deleteGroup,
      moveConnectionToGroup,
      reorderGroups,
      reorderConnectionsInGroup,
      toggleGroupCollapsed,
    }}>
      {children}
    </DatabaseContext.Provider>
  );
};
