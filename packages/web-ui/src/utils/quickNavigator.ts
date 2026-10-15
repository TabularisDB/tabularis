import type {
  NestedDatabaseData,
  RoutineInfo,
  SchemaData,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from "../contexts/DatabaseContext";
import type { DatabaseObject } from "./databaseObjectActions";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { routineLabel } from "./routines";

interface NavigatorItemBase {
  name: string;
  schema?: string;
  database?: string;
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
  isNestedMultiDb: boolean;
  schemas: string[];
  schemaDataMap: Record<string, SchemaData>;
  selectedDatabases: string[];
  databaseDataMap: Record<string, SchemaData>;
  nestedDatabaseDataMap: Record<string, NestedDatabaseData>;
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
  database?: string;
  data: NavigatorData;
}

function createNavigatorItems({
  group,
  database,
  data,
}: NavigatorGroup): NavigatorItem[] {
  return [
    ...(data.tables ?? []).map(
      (item): NavigatorItem => ({
        name: item.name,
        type: "table",
        schema: group,
        database,
        item,
      }),
    ),
    ...(data.views ?? []).map(
      (item): NavigatorItem => ({
        name: item.name,
        type: "view",
        schema: group,
        database,
        item,
      }),
    ),
    ...(data.routines ?? []).map(
      (item): NavigatorItem => ({
        // Labelled with the signature where the dialect reports one, for the
        // same reason the sidebar is: four overloads of a name are otherwise
        // four identical palette entries (#893).
        name: routineLabel(item.name, item.identity_args),
        type: "routine",
        schema: group,
        database,
        detail: item.routine_type,
        item,
      }),
    ),
    ...(data.triggers ?? []).map(
      (item): NavigatorItem => ({
        name: item.name,
        type: "trigger",
        schema: group,
        database,
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
    isNestedMultiDb,
    schemas,
    schemaDataMap,
    selectedDatabases,
    databaseDataMap,
    nestedDatabaseDataMap,
    tables,
    views,
    routines,
    triggers,
    activeSchema,
  } = params;

  if (!activeConnectionId) return [];

  let groups: NavigatorGroup[];
  if (isNestedMultiDb) {
    groups = selectedDatabases.flatMap((database) => {
      const nested = nestedDatabaseDataMap[database];
      if (!nested) return [];
      return nested.selectedSchemas.flatMap((group) => {
        const data = nested.schemaDataMap[group];
        return data ? [{ group, database, data }] : [];
      });
    });
  } else if (hasSchemas) {
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
    database: item.database,
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
          item.database && item.schema
            ? `${item.name} (${item.database}.${item.schema})`
            : context.isMultiDatabase && item.schema
              ? `${item.name} (${item.schema})`
              : undefined,
      };
    case "routine":
      return {
        ...base,
        // The BARE name, overriding the label `base` carried in from the
        // navigator entry. `DatabaseObject.name` is an identifier: it reaches
        // `get_routine_definition` as `routineName` and the catalog filters
        // `p.proname` on it, and Copy name puts it on the clipboard for pasting
        // into SQL. A label there broke every PostgreSQL routine opened from
        // the palette, not only the overloaded ones, because `f()` is a label
        // too. The signature travels in `identityArgs`, which is where the
        // lookup can use it.
        name: item.item.name,
        type: "routine",
        routineType: item.item.routine_type,
        identityArgs: item.item.identity_args,
      };
    case "trigger":
      return {
        ...base,
        type: "trigger",
        tableName: item.item.table_name,
      };
  }
}
