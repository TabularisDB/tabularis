import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { TableTarget } from "../types/databaseObjects";
import { usesMultiDatabaseLayout } from "../utils/database";
import {
  createObjectPaletteItems,
  type ObjectPaletteRuntime,
} from "../utils/objectPaletteItems";
import { getNavigatorItems } from "../utils/quickNavigator";
import { useActiveCommandPaletteScope } from "./useCommandPaletteScope";
import { useDatabase } from "./useDatabase";
import { useDatabaseObjectActionRuntime } from "./useDatabaseObjectActionRuntime";

/**
 * A failed load resets the entry to neither loading nor loaded, which the effect
 * below would read as "still needs fetching" forever. Capping the attempts keeps
 * a broken schema from looping the backend; the failure surfaces in the palette.
 */
const MAX_OBJECT_LOAD_ATTEMPTS = 2;
const EMPTY_SELECTED_DATABASES: string[] = [];

export function useCommandPaletteObjectItems(
  onGenerateSql: (target: TableTarget) => void,
  onInspect: (target: TableTarget) => void,
) {
  const { t } = useTranslation();
  const scope = useActiveCommandPaletteScope();
  const baseRuntime = useDatabaseObjectActionRuntime();
  const {
    activeConnectionId,
    connectionDataMap,
    loadDatabaseData,
    loadSchemaData,
    setActiveTable,
  } = useDatabase();

  const connectionId = scope?.connectionId ?? null;
  const requestDatabaseData = useEffectEvent(loadDatabaseData);
  const requestSchemaData = useEffectEvent(loadSchemaData);
  const loadAttemptsRef = useRef(new Map<string, number>());
  const [failedTargets, setFailedTargets] = useState<string[]>([]);
  const markFailed = (name: string) =>
    setFailedTargets((previous) =>
      previous.includes(name) ? previous : [...previous, name],
    );
  // Returning the previous array when nothing changes keeps this out of the
  // render loop the effect below would otherwise start.
  const clearFailed = (name: string) =>
    setFailedTargets((previous) =>
      previous.includes(name)
        ? previous.filter((target) => target !== name)
        : previous,
    );
  const runtime = useMemo<ObjectPaletteRuntime>(
    () => ({
      ...baseRuntime,
      // Route through the scope so the object opens in the panel that owns it,
      // instead of the router-level editor baseRuntime navigates to.
      navigateToEditor: (request) =>
        scope?.runtime.openEditor(request),
      inspect: onInspect,
      generateSql: onGenerateSql,
      copyText: (value: string) =>
        navigator.clipboard.writeText(value),
      // setActiveTable always writes the root connection's schema preference,
      // so a split panel targeting another connection must not call it.
      setActiveTable: (table, schema) => {
        if (connectionId !== activeConnectionId) return;
        setActiveTable(table, schema);
      },
    }),
    [
      activeConnectionId,
      baseRuntime,
      connectionId,
      onGenerateSql,
      onInspect,
      scope,
      setActiveTable,
    ],
  );
  const connectionData = connectionId
    ? connectionDataMap[connectionId]
    : undefined;
  const selectedDatabases =
    connectionData?.selectedDatabases ?? EMPTY_SELECTED_DATABASES;
  const hasSchemas = !!connectionData?.capabilities?.schemas;
  const isMultiDatabase = usesMultiDatabaseLayout(
    connectionData?.capabilities,
    selectedDatabases,
  );

  useEffect(() => {
    if (!connectionId) return;

    if (hasSchemas) {
      connectionData?.schemas.forEach((schema) => {
        const schemaData = connectionData.schemaDataMap[schema];
        const requestKey = `schema:${connectionId}:${schema}`;
        if (schemaData?.isLoaded) {
          loadAttemptsRef.current.delete(requestKey);
          clearFailed(schema);
          return;
        }
        if (schemaData?.isLoading) return;

        const attempts = loadAttemptsRef.current.get(requestKey) ?? 0;
        if (attempts >= MAX_OBJECT_LOAD_ATTEMPTS) {
          markFailed(schema);
          return;
        }
        loadAttemptsRef.current.set(requestKey, attempts + 1);
        void requestSchemaData(schema, connectionId);
      });
      return;
    }

    if (isMultiDatabase) {
      selectedDatabases.forEach((database) => {
        const databaseData = connectionData?.databaseDataMap[database];
        const requestKey = `database:${connectionId}:${database}`;
        if (databaseData?.isLoaded) {
          loadAttemptsRef.current.delete(requestKey);
          clearFailed(database);
          return;
        }
        if (databaseData?.isLoading) return;

        const attempts = loadAttemptsRef.current.get(requestKey) ?? 0;
        if (attempts >= MAX_OBJECT_LOAD_ATTEMPTS) {
          markFailed(database);
          return;
        }
        loadAttemptsRef.current.set(requestKey, attempts + 1);
        void requestDatabaseData(database, connectionId);
      });
    }
  }, [
    connectionData?.databaseDataMap,
    connectionData?.schemaDataMap,
    connectionData?.schemas,
    connectionId,
    hasSchemas,
    isMultiDatabase,
    selectedDatabases,
  ]);

  const navigatorItems = useMemo(
    () =>
      getNavigatorItems({
        activeConnectionId: connectionId,
        hasSchemas,
        isMultiDb: isMultiDatabase,
        schemas: connectionData?.schemas ?? [],
        schemaDataMap: connectionData?.schemaDataMap ?? {},
        selectedDatabases,
        databaseDataMap: connectionData?.databaseDataMap ?? {},
        tables: connectionData?.tables ?? [],
        views: connectionData?.views ?? [],
        routines: connectionData?.routines ?? [],
        triggers: connectionData?.triggers ?? [],
        activeSchema: connectionData?.activeSchema ?? null,
      }),
    [
      connectionData?.activeSchema,
      connectionData?.databaseDataMap,
      connectionData?.routines,
      connectionData?.schemaDataMap,
      connectionData?.schemas,
      connectionData?.tables,
      connectionData?.triggers,
      connectionData?.views,
      connectionId,
      hasSchemas,
      isMultiDatabase,
      selectedDatabases,
    ],
  );

  const items = useMemo(() => {
    if (!connectionId) return [];

    return createObjectPaletteItems({
      navigatorItems,
      connectionId,
      driver: connectionData?.capabilities ?? connectionData?.driver ?? null,
      hasGroups: hasSchemas || isMultiDatabase,
      isMultiDatabase,
      runtime,
      labels: {
        inspect: t("editor.quickNavigator.actions.inspect"),
        newConsole: t("editor.quickNavigator.actions.newConsole"),
        generateSql: t(
          "editor.quickNavigator.actions.generateSql",
        ),
        countRows: t("editor.quickNavigator.actions.countRows"),
        query: t("editor.quickNavigator.actions.query"),
        copyName: t("editor.quickNavigator.actions.copyName"),
        type: {
          table: t("editor.quickNavigator.type_table"),
          view: t("editor.quickNavigator.type_view"),
          routine: t("editor.quickNavigator.type_routine"),
          trigger: t("editor.quickNavigator.type_trigger"),
        },
      },
    });
  }, [
    connectionData?.driver,
    connectionData?.capabilities,
    connectionId,
    hasSchemas,
    isMultiDatabase,
    navigatorItems,
    runtime,
    t,
  ]);

  return useMemo(
    () => ({
      items,
      error: failedTargets.length
        ? t("commandPalette.objectsLoadError", {
            names: failedTargets.join(", "),
          })
        : null,
    }),
    [failedTargets, items, t],
  );
}
