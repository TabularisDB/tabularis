import { useMemo } from "react";

import type {
  RoutineInfo,
  TriggerInfo,
} from "../contexts/DatabaseContext";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import {
  createDefinitionRequest,
  createQueryableObjectRequests,
  createTableConsoleRequest,
  openObjectDefinition,
} from "../utils/databaseObjectActions";
import { useDatabaseObjectActionRuntime } from "./useDatabaseObjectActionRuntime";

interface QueryableObjectNavigationOptions {
  materialized?: boolean;
  qualifySchema?: boolean;
  title?: string;
}

/**
 * Tables and views navigate identically — only the SELECT target differs, and
 * that comes from the name — so both go through `open`/`count`.
 *
 * Returns `null` without a connection, so the "there is nothing to navigate to"
 * case is handled once by the caller instead of inside every method.
 */
export function useDatabaseObjectNavigation(
  connectionId: string | null,
  driver: string | PluginManifest | DriverCapabilities | null,
) {
  const runtime = useDatabaseObjectActionRuntime();

  return useMemo(() => {
    if (!connectionId) return null;

    const requests = (
      objectName: string,
      schema?: string,
      options?: QueryableObjectNavigationOptions,
      database?: string,
    ) =>
      createQueryableObjectRequests({
        connectionId,
        driver,
        objectName,
        schema,
        database,
        ...options,
      });

    return {
      open: (
        objectName: string,
        schema?: string,
        options?: QueryableObjectNavigationOptions,
        database?: string,
      ) =>
        runtime.navigateToEditor(
          requests(objectName, schema, options, database).open,
        ),
      count: (
        objectName: string,
        schema?: string,
        options?: QueryableObjectNavigationOptions,
        database?: string,
      ) =>
        runtime.navigateToEditor(
          requests(objectName, schema, options, database).count,
        ),
      newConsole: (objectName: string, schema?: string, database?: string) =>
        runtime.navigateToEditor(
          createTableConsoleRequest(
            { connectionId, objectName, schema, database },
            driver,
          ),
        ),
      openRoutineDefinition: (routine: RoutineInfo, schema?: string, database?: string) =>
        void openObjectDefinition(
          {
            type: "routine",
            connectionId,
            name: routine.name,
            routineType: routine.routine_type,
            schema,
            database,
          },
          runtime,
        ),
      openTriggerDefinition: (trigger: TriggerInfo, schema?: string, database?: string) =>
        void openObjectDefinition(
          {
            type: "trigger",
            connectionId,
            name: trigger.name,
            tableName: trigger.table_name,
            schema,
            database,
          },
          runtime,
        ),
      openDefinition: (
        definition: string,
        queryName: string,
        schema?: string,
        readOnly = false,
      ) =>
        runtime.navigateToEditor(
          createDefinitionRequest({
            connectionId,
            definition,
            queryName,
            schema,
            readOnly,
          }),
        ),
    };
  }, [connectionId, driver, runtime]);
}
