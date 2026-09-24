import type { CommandScope } from "../types/commands";
import type { TableTarget } from "../types/databaseObjects";
import type { PaletteItem } from "../types/palette";
import {
  createTableCountRequest,
  createTableConsoleRequest,
} from "./databaseObjectActions";
import { PINNED_PALETTE_RELEVANCE } from "./paletteItems";

interface BuiltInCommandLabels {
  openSettings: string;
  openConnections: string;
  newConsole: string;
  openTableInConsole: string;
  inspectTable: string;
  generateSql: string;
  countRows: string;
  navigationCategory: string;
  connectionCategory: string;
  tableCategory: string;
}

/** Commands that open a modal the palette itself owns, rather than navigating. */
interface BuiltInCommandModals {
  inspect: (target: TableTarget) => void;
  generateSql: (target: TableTarget) => void;
}

export function createBuiltInCommandItems(
  scope: CommandScope,
  labels: BuiltInCommandLabels,
  modals: BuiltInCommandModals,
): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: "app.open-settings",
      title: labels.openSettings,
      group: labels.navigationCategory,
      keywords: ["preferences", "configuration"],
      icon: "command",
      primaryAction: {
        id: "app.open-settings",
        label: labels.openSettings,
        execute: () => scope.runtime.navigate("/settings"),
      },
    },
    {
      id: "app.open-connections",
      title: labels.openConnections,
      group: labels.navigationCategory,
      keywords: ["connection", "manager", "database"],
      icon: "command",
      primaryAction: {
        id: "app.open-connections",
        label: labels.openConnections,
        execute: () => scope.runtime.navigate("/connections"),
      },
    },
  ];

  if (scope.connectionId) {
    const connectionId = scope.connectionId;
    items.push({
      id: "connection.new-console",
      title: labels.newConsole,
      group: labels.connectionCategory,
      keywords: ["sql", "query", "console", "editor"],
      icon: "new-console",
      primaryAction: {
        id: "connection.new-console",
        label: labels.newConsole,
        execute: () =>
          scope.runtime.openEditor({
            kind: "console",
            initialQuery: "",
            preventAutoRun: true,
            ...(scope.table?.schema
              ? { schema: scope.table.schema }
              : {}),
            targetConnectionId: connectionId,
          }),
      },
    });
  }

  if (scope.table) {
    const table = scope.table;

    items.push(
      {
        id: "table.open-in-console",
        title: labels.openTableInConsole,
        description: table.tableName,
        group: labels.tableCategory,
        keywords: ["sql", "query", "console"],
        icon: "command",
        relevance: PINNED_PALETTE_RELEVANCE,
        primaryAction: {
          id: "table.open-in-console",
          label: labels.openTableInConsole,
          execute: () =>
            scope.runtime.openEditor(
              createTableConsoleRequest(
                {
                  connectionId: table.connectionId,
                  objectName: table.tableName,
                  schema: table.schema,
                },
                scope.driver,
              ),
            ),
        },
      },
      {
        id: "table.inspect",
        title: labels.inspectTable,
        description: table.tableName,
        group: labels.tableCategory,
        keywords: ["schema", "structure", "columns"],
        icon: "inspect",
        relevance: PINNED_PALETTE_RELEVANCE,
        primaryAction: {
          id: "table.inspect",
          label: labels.inspectTable,
          execute: () => modals.inspect(table),
        },
      },
      {
        id: "table.generate-sql",
        title: labels.generateSql,
        description: table.tableName,
        group: labels.tableCategory,
        keywords: ["ddl", "insert", "update", "template"],
        icon: "generate-sql",
        relevance: PINNED_PALETTE_RELEVANCE,
        primaryAction: {
          id: "table.generate-sql",
          label: labels.generateSql,
          execute: () => modals.generateSql(table),
        },
      },
      {
        id: "table.count-rows",
        title: labels.countRows,
        description: table.tableName,
        group: labels.tableCategory,
        keywords: ["count", "rows", "total"],
        icon: "count",
        relevance: PINNED_PALETTE_RELEVANCE,
        primaryAction: {
          id: "table.count-rows",
          label: labels.countRows,
          execute: () =>
            scope.runtime.openEditor(
              createTableCountRequest(
                {
                  connectionId: table.connectionId,
                  objectName: table.tableName,
                  schema: table.schema,
                },
                scope.driver,
              ),
            ),
        },
      },
    );
  }

  return items;
}
