import type {
  RoutineInfo,
  SchemaData,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from "../contexts/DatabaseContext";
import type { DatabaseObject } from "./databaseObjectActions";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";

interface NavigatorItemBase {
  name: string;
  schema?: string;
  detail?: string;
}

export type NavigatorItem =
  | (NavigatorItemBase & {
      type: "table";
      item: TableInfo;
    })
  | (NavigatorItemBase & {
      type: "view";
      item: ViewInfo;
    })
  | (NavigatorItemBase & {
      type: "routine";
      item: RoutineInfo;
    })
  | (NavigatorItemBase & {
      type: "trigger";
      item: TriggerInfo;
    });

export interface NavigatorItemParams {
  activeConnectionId: string | null;
  hasSchemas: boolean;
  isMultiDb: boolean;
  schemas: string[];
  schemaDataMap: Record<string, SchemaData>;
  selectedDatabases: string[];
  databaseDataMap: Record<string, SchemaData>;
  tables: TableInfo[];
  views: ViewInfo[];
  routines: RoutineInfo[];
  triggers: TriggerInfo[];
  activeSchema: string | null;
}

type NavigatorData = Pick<
  SchemaData,
  "tables" | "views" | "routines" | "triggers"
>;

interface NavigatorGroup {
  group?: string;
  data: NavigatorData;
}

function createNavigatorItems({
  group,
  data,
}: NavigatorGroup): NavigatorItem[] {
  return [
    ...(data.tables ?? []).map(
      (item): NavigatorItem => ({
        name: item.name,
        type: "table",
        schema: group,
        item,
      }),
    ),
    ...(data.views ?? []).map(
      (item): NavigatorItem => ({
        name: item.name,
        type: "view",
        schema: group,
        item,
      }),
    ),
    ...(data.routines ?? []).map(
      (item): NavigatorItem => ({
        name: item.name,
        type: "routine",
        schema: group,
        detail: item.routine_type,
        item,
      }),
    ),
    ...(data.triggers ?? []).map(
      (item): NavigatorItem => ({
        name: item.name,
        type: "trigger",
        schema: group,
        detail: `on ${item.table_name}`,
        item,
      }),
    ),
  ];
}

export function getNavigatorItems(params: NavigatorItemParams): NavigatorItem[] {
  const {
    activeConnectionId,
    hasSchemas,
    isMultiDb,
    schemas,
    schemaDataMap,
    selectedDatabases,
    databaseDataMap,
    tables,
    views,
    routines,
    triggers,
    activeSchema,
  } = params;

  if (!activeConnectionId) return [];

  let groups: NavigatorGroup[];
  if (hasSchemas) {
    groups = schemas.flatMap((group) => {
      const data = schemaDataMap[group];
      return data ? [{ group, data }] : [];
    });
  } else if (isMultiDb) {
    groups = selectedDatabases.flatMap((group) => {
      const data = databaseDataMap[group];
      return data ? [{ group, data }] : [];
    });
  } else {
    groups = [{
      group: activeSchema ?? undefined,
      data: { tables, views, routines, triggers },
    }];
  }

  return groups.flatMap(createNavigatorItems);
}

interface DatabaseObjectContext {
  connectionId: string;
  driver: string | PluginManifest | DriverCapabilities | null;
  isMultiDatabase: boolean;
}

export function toDatabaseObject(
  item: NavigatorItem,
  context: DatabaseObjectContext,
): DatabaseObject {
  const base = {
    connectionId: context.connectionId,
    name: item.name,
    schema: item.schema,
  };

  switch (item.type) {
    case "table":
    case "view":
      return {
        ...base,
        type: item.type,
        driver: context.driver,
        qualifySchema: !context.isMultiDatabase,
        title:
          context.isMultiDatabase && item.schema
            ? `${item.name} (${item.schema})`
            : undefined,
      };
    case "routine":
      return {
        ...base,
        type: "routine",
        routineType: item.item.routine_type,
      };
    case "trigger":
      return {
        ...base,
        type: "trigger",
        tableName: item.item.table_name,
      };
  }
}
