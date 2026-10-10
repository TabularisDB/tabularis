import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { TableTarget } from "../types/databaseObjects";
import { createBuiltInCommandItems } from "../utils/builtInCommands";
import { createConnectionCommandItems } from "../utils/connectionCommandItems";
import { useActiveCommandPaletteScope } from "./useCommandPaletteScope";

export function useCommandPaletteActionItems(
  onGenerateSql: (target: TableTarget) => void,
  onInspect: (target: TableTarget) => void,
) {
  const { t } = useTranslation();
  const scope = useActiveCommandPaletteScope();

  return useMemo(() => {
    if (!scope) return [];

    const connectionCategory = t("commandPalette.categories.connection");
    const builtInItems = createBuiltInCommandItems(
      scope,
      {
        openSettings: t("commandPalette.commands.openSettings"),
        openConnections: t("commandPalette.commands.openConnections"),
        newConsole: t("editor.quickNavigator.actions.newConsole"),
        openTableInConsole: t(
          "commandPalette.commands.openTableInConsole",
        ),
        inspectTable: t("editor.quickNavigator.actions.inspect"),
        generateSql: t("editor.quickNavigator.actions.generateSql"),
        countRows: t("editor.quickNavigator.actions.countRows"),
        navigationCategory: t("commandPalette.categories.navigation"),
        connectionCategory,
        editorCategory: t("settings.shortcuts.categories.editor"),
        tableCategory: t("commandPalette.categories.table"),
        resultCategory: t("editor.multiResult.results"),
        copySelectedCells: (count) => t("dataGrid.copyCells", { count }),
        copySelectedRows: (count) => t("dataGrid.copyRows", { count }),
        copySelectedColumns: (count) =>
          t("dataGrid.copySelectedColumns", { count }),
        copyColumnValuesAsSqlIn: t("dataGrid.copyColumnValuesIn"),
        copyAllRows: (count) =>
          count == null
            ? t("dataGrid.copyAll")
            : t("dataGrid.copyAllRows", { count }),
      },
      { generateSql: onGenerateSql, inspect: onInspect },
    );

    const connectionItems = scope.runtime.switchConnection
      ? createConnectionCommandItems({
          activeConnectionId: scope.connectionId,
          connections: scope.connections ?? [],
          group: connectionCategory,
          switchConnection: scope.runtime.switchConnection,
        })
      : [];

    return [...builtInItems, ...connectionItems];
  }, [onGenerateSql, onInspect, scope, t]);
}
