import type { TableInfo, ViewInfo, RoutineInfo, TriggerInfo, SchemaData } from '../contexts/DatabaseContext';
import { fuzzyFilter } from './fuzzy';

export interface NavigatorItem {
  name: string;
  type: "table" | "view" | "routine" | "trigger";
  schema?: string;
  detail?: string;
  item: TableInfo | ViewInfo | RoutineInfo | TriggerInfo;
}

export interface NavigatorItemParams {
  activeConnectionId: string | null;
  hasSchemas: boolean;
  isMultiDb: boolean;
  schemas: string[];
  schemaDataMap: Record<string, SchemaData>;
  configuredDatabases: string[];
  databaseDataMap: Record<string, SchemaData>;
  tables: TableInfo[];
  views: ViewInfo[];
  routines: RoutineInfo[];
  triggers: TriggerInfo[];
  activeSchema: string | null;
}

export function getNavigatorItems(params: NavigatorItemParams): NavigatorItem[] {
  const {
    activeConnectionId,
    hasSchemas,
    isMultiDb,
    schemas,
    schemaDataMap,
    configuredDatabases,
    databaseDataMap,
    tables,
    views,
    routines,
    triggers,
    activeSchema,
  } = params;

  if (!activeConnectionId) return [];

  const result: NavigatorItem[] = [];

  if (hasSchemas && schemas) {
    schemas.forEach((schemaName) => {
      const data = schemaDataMap[schemaName];
      if (data) {
        if (data.tables) {
          data.tables.forEach((t) => {
            result.push({ name: t.name, type: "table", schema: schemaName, item: t });
          });
        }
        if (data.views) {
          data.views.forEach((v) => {
            result.push({ name: v.name, type: "view", schema: schemaName, item: v });
          });
        }
        if (data.routines) {
          data.routines.forEach((r) => {
            result.push({
              name: r.name,
              type: "routine",
              schema: schemaName,
              detail: r.routine_type,
              item: r,
            });
          });
        }
        if (data.triggers) {
          data.triggers.forEach((trg) => {
            result.push({
              name: trg.name,
              type: "trigger",
              schema: schemaName,
              detail: `on ${trg.table_name}`,
              item: trg,
            });
          });
        }
      }
    });
  } else if (isMultiDb && configuredDatabases) {
    configuredDatabases.forEach((dbName) => {
      const data = databaseDataMap[dbName];
      if (data) {
        if (data.tables) {
          data.tables.forEach((t) => {
            result.push({ name: t.name, type: "table", schema: dbName, item: t });
          });
        }
        if (data.views) {
          data.views.forEach((v) => {
            result.push({ name: v.name, type: "view", schema: dbName, item: v });
          });
        }
        if (data.routines) {
          data.routines.forEach((r) => {
            result.push({
              name: r.name,
              type: "routine",
              schema: dbName,
              detail: r.routine_type,
              item: r,
            });
          });
        }
        if (data.triggers) {
          data.triggers.forEach((trg) => {
            result.push({
              name: trg.name,
              type: "trigger",
              schema: dbName,
              detail: `on ${trg.table_name}`,
              item: trg,
            });
          });
        }
      }
    });
  } else {
    if (tables) {
      tables.forEach((t) => {
        result.push({ name: t.name, type: "table", schema: activeSchema || undefined, item: t });
      });
    }
    if (views) {
      views.forEach((v) => {
        result.push({ name: v.name, type: "view", schema: activeSchema || undefined, item: v });
      });
    }
    if (routines) {
      routines.forEach((r) => {
        result.push({
          name: r.name,
          type: "routine",
          schema: activeSchema || undefined,
          detail: r.routine_type,
          item: r,
        });
      });
    }
    if (triggers) {
      triggers.forEach((trg) => {
        result.push({
          name: trg.name,
          type: "trigger",
          schema: activeSchema || undefined,
          detail: `on ${trg.table_name}`,
          item: trg,
        });
      });
    }
  }

  return result;
}

export function filterNavigatorItems(items: NavigatorItem[], search: string): NavigatorItem[] {
  return fuzzyFilter(items, search, (item) =>
    item.schema ? `${item.name} ${item.schema}` : item.name,
  );
}
