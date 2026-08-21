import { invoke } from "@tauri-apps/api/core";

import type {
  ConsoleEditorNavigationRequest,
  DefinitionEditorNavigationRequest,
  EditorNavigationRequest,
  TableEditorNavigationRequest,
} from "../types/editor";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { quoteTableRef } from "./identifiers";
import { newConsoleForTable } from "./newConsole";

/** Driver argument accepted throughout this module: a bare driver id
 * string, a resolved manifest, or a bare capabilities object. Capability-
 * driven when available (issue #614): a postgres-compatible driver
 * registered under a different id (e.g. a standalone PostgreSQL plugin) is
 * quoted the same as the builtin "postgres" driver. */
type DriverArg = string | PluginManifest | DriverCapabilities | null;

export interface DatabaseObjectTarget {
  connectionId: string;
  objectName: string;
  schema?: string;
}

interface QueryableObjectOptions extends DatabaseObjectTarget {
  driver: DriverArg;
  materialized?: boolean;
  qualifySchema?: boolean;
  title?: string;
}

interface QueryableObjectRequests {
  open: TableEditorNavigationRequest;
  count: ConsoleEditorNavigationRequest;
}

interface CountRequestOptions extends DatabaseObjectTarget {
  driver: DriverArg;
  qualifySchema?: boolean;
}

export interface RoutineDefinitionTarget {
  connectionId: string;
  routineName: string;
  routineType: string;
  schema?: string;
}

export interface TriggerDefinitionTarget {
  connectionId: string;
  triggerName: string;
  tableName: string;
  schema?: string;
}

interface DatabaseObjectBase {
  connectionId: string;
  name: string;
  schema?: string;
}

interface QueryableDatabaseObjectBase extends DatabaseObjectBase {
  driver: DriverArg;
  materialized?: boolean;
  qualifySchema?: boolean;
  title?: string;
}

export interface TableDatabaseObject
  extends QueryableDatabaseObjectBase {
  type: "table";
}

export interface ViewDatabaseObject
  extends QueryableDatabaseObjectBase {
  type: "view";
}

export interface RoutineDatabaseObject extends DatabaseObjectBase {
  type: "routine";
  routineType: string;
}

export interface TriggerDatabaseObject extends DatabaseObjectBase {
  type: "trigger";
  tableName: string;
}

export type DatabaseObject =
  | TableDatabaseObject
  | ViewDatabaseObject
  | RoutineDatabaseObject
  | TriggerDatabaseObject;

export interface DatabaseObjectActionRuntime {
  navigateToEditor: (request: EditorNavigationRequest) => void;
  loadRoutineDefinition: (
    target: RoutineDefinitionTarget,
  ) => Promise<string>;
  loadTriggerDefinition: (
    target: TriggerDefinitionTarget,
  ) => Promise<string>;
  showDefinitionError: (
    type: "routine" | "trigger",
    error: unknown,
  ) => void;
}

interface DefinitionRequestOptions {
  connectionId: string;
  definition: string;
  queryName: string;
  readOnly?: boolean;
  schema?: string;
}

function createCountRequest({
  connectionId,
  driver,
  objectName,
  qualifySchema = true,
  schema,
}: CountRequestOptions): ConsoleEditorNavigationRequest {
  const quotedObject = quoteTableRef(
    objectName,
    driver,
    qualifySchema ? schema : undefined,
  );

  return {
    kind: "console",
    initialQuery: `SELECT COUNT(*) as count FROM ${quotedObject}`,
    schema,
    targetConnectionId: connectionId,
  };
}

/**
 * Loads a routine or trigger body and opens it in the editor. The only database
 * object action that is more than a request builder, because it has to fetch
 * before it can navigate.
 */
export async function openObjectDefinition(
  object: RoutineDatabaseObject | TriggerDatabaseObject,
  runtime: DatabaseObjectActionRuntime,
): Promise<void> {
  const schemaParam = object.schema ? { schema: object.schema } : {};

  try {
    const definition =
      object.type === "routine"
        ? await runtime.loadRoutineDefinition({
            connectionId: object.connectionId,
            routineName: object.name,
            routineType: object.routineType,
            ...schemaParam,
          })
        : await runtime.loadTriggerDefinition({
            connectionId: object.connectionId,
            triggerName: object.name,
            tableName: object.tableName,
            ...schemaParam,
          });

    runtime.navigateToEditor(
      createDefinitionRequest({
        connectionId: object.connectionId,
        definition,
        queryName: `${object.name} Definition`,
        readOnly: object.type === "trigger",
        schema: object.schema,
      }),
    );
  } catch (error) {
    runtime.showDefinitionError(object.type, error);
  }
}

export function createQueryableObjectRequests({
  connectionId,
  driver,
  materialized,
  objectName,
  qualifySchema = true,
  schema,
  title,
}: QueryableObjectOptions): QueryableObjectRequests {
  const quotedObject = quoteTableRef(
    objectName,
    driver,
    qualifySchema ? schema : undefined,
  );
  const base = {
    schema,
    targetConnectionId: connectionId,
  };

  return {
    open: {
      kind: "table",
      initialQuery: `SELECT * FROM ${quotedObject}`,
      tableName: objectName,
      ...(materialized ? { materialized: true } : {}),
      ...(title ? { title } : {}),
      ...base,
    },
    count: createCountRequest({
      connectionId,
      driver,
      objectName,
      qualifySchema,
      schema,
    }),
  };
}

export function createTableConsoleRequest(
  target: DatabaseObjectTarget,
  driver: DriverArg,
): ConsoleEditorNavigationRequest {
  const spec = newConsoleForTable(
    target.objectName,
    driver,
    target.schema,
  );

  return {
    kind: "console",
    initialQuery: spec.sql,
    queryName: spec.title,
    preventAutoRun: true,
    schema: spec.schema,
    targetConnectionId: target.connectionId,
  };
}

export function createTableCountRequest(
  target: DatabaseObjectTarget,
  driver: DriverArg,
): ConsoleEditorNavigationRequest {
  return createCountRequest({
    ...target,
    driver,
  });
}

export function createDefinitionRequest({
  connectionId,
  definition,
  queryName,
  readOnly,
  schema,
}: DefinitionRequestOptions): DefinitionEditorNavigationRequest {
  return {
    kind: "definition",
    initialQuery: definition,
    queryName,
    ...(readOnly ? { readOnly: true } : {}),
    schema,
    targetConnectionId: connectionId,
  };
}

export function loadRoutineDefinition(
  target: RoutineDefinitionTarget,
): Promise<string> {
  return invoke<string>("get_routine_definition", {
    connectionId: target.connectionId,
    routineName: target.routineName,
    routineType: target.routineType,
    ...(target.schema ? { schema: target.schema } : {}),
  });
}

export function loadTriggerDefinition(
  target: TriggerDefinitionTarget,
): Promise<string> {
  return invoke<string>("get_trigger_definition", {
    connectionId: target.connectionId,
    triggerName: target.triggerName,
    tableName: target.tableName,
    ...(target.schema ? { schema: target.schema } : {}),
  });
}
