import type { TableTarget } from "../types/databaseObjects";
import type { PaletteAction, PaletteItem } from "../types/palette";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import {
  createQueryableObjectRequests,
  createTableConsoleRequest,
  openObjectDefinition,
  type DatabaseObject,
  type DatabaseObjectActionRuntime,
} from "./databaseObjectActions";
import {
  toDatabaseObject,
  type NavigatorItem,
} from "./quickNavigator";

export interface ObjectPaletteRuntime
  extends DatabaseObjectActionRuntime {
  inspect: (target: TableTarget) => void;
  generateSql: (target: TableTarget) => void;
  copyText: (value: string) => Promise<void>;
  setActiveTable: (table: string, schema: string) => void;
}

interface ObjectPaletteLabels {
  inspect: string;
  newConsole: string;
  generateSql: string;
  countRows: string;
  query: string;
  copyName: string;
  type: Record<NavigatorItem["type"], string>;
}

interface CreateObjectPaletteItemsOptions {
  navigatorItems: NavigatorItem[];
  connectionId: string;
  driver: string | PluginManifest | DriverCapabilities | null;
  hasGroups: boolean;
  isMultiDatabase: boolean;
  labels: ObjectPaletteLabels;
  runtime: ObjectPaletteRuntime;
}

export function createObjectPaletteItems({
  navigatorItems,
  connectionId,
  driver,
  hasGroups,
  isMultiDatabase,
  labels,
  runtime,
}: CreateObjectPaletteItemsOptions): PaletteItem[] {
  return navigatorItems.map((item) => {
    const object = toDatabaseObject(item, {
      connectionId,
      driver,
      isMultiDatabase,
    });
    const { open, actions } = createActions(object, runtime, labels);

    return {
      id: `${item.type}:${item.schema ?? ""}:${item.name}`,
      title: item.name,
      description: item.detail,
      group: hasGroups ? item.schema : undefined,
      badge: labels.type[item.type],
      keywords: item.schema ? [item.schema] : undefined,
      icon: item.type,
      primaryAction: open,
      actions,
    };
  });
}

/**
 * `actions` is rendered in list order — there is no separate ranking to keep in
 * sync — and `open` doubles as the item's primary action, so pressing Enter on
 * a row and clicking its query button always do the same thing.
 */
function createActions(
  object: DatabaseObject,
  runtime: ObjectPaletteRuntime,
  labels: ObjectPaletteLabels,
): { open: PaletteAction; actions: PaletteAction[] } {
  const copy: PaletteAction = {
    id: "copy",
    label: labels.copyName,
    icon: "copy",
    execute: () => runtime.copyText(object.name),
  };

  if (object.type === "routine" || object.type === "trigger") {
    return {
      open: {
        id: "open",
        label: labels.query,
        icon: "query",
        execute: () => openObjectDefinition(object, runtime),
      },
      actions: [copy],
    };
  }

  const requests = createQueryableObjectRequests({
    connectionId: object.connectionId,
    driver: object.driver,
    materialized: object.materialized,
    objectName: object.name,
    qualifySchema: object.qualifySchema,
    schema: object.schema,
    title: object.title,
  });
  const open: PaletteAction = {
    id: "open",
    label: labels.query,
    icon: "query",
    // Opening a table also selects it in the explorer, matching a double-click
    // there.
    execute: () => {
      if (object.type === "table" && object.schema) {
        runtime.setActiveTable(object.name, object.schema);
      }
      runtime.navigateToEditor(requests.open);
    },
  };
  const count: PaletteAction = {
    id: "count",
    label: labels.countRows,
    icon: "count",
    execute: () => runtime.navigateToEditor(requests.count),
  };

  if (object.type === "view") {
    return { open, actions: [count, open, copy] };
  }

  const target: TableTarget = {
    connectionId: object.connectionId,
    tableName: object.name,
    ...(object.schema ? { schema: object.schema } : {}),
  };

  return {
    open,
    actions: [
      {
        id: "inspect",
        label: labels.inspect,
        icon: "inspect",
        execute: () => runtime.inspect(target),
      },
      {
        id: "new-console",
        label: labels.newConsole,
        icon: "new-console",
        execute: () =>
          runtime.navigateToEditor(
            createTableConsoleRequest(
              {
                connectionId: object.connectionId,
                objectName: object.name,
                schema: object.schema,
              },
              object.driver,
            ),
          ),
      },
      {
        id: "generate-sql",
        label: labels.generateSql,
        icon: "generate-sql",
        execute: () => runtime.generateSql(target),
      },
      count,
      open,
      copy,
    ],
  };
}
