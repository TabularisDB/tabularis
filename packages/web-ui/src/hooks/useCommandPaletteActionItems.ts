import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { TableTarget } from "../types/databaseObjects";
import { createBuiltInCommandItems } from "../utils/builtInCommands";
import { useActiveCommandPaletteScope } from "./useCommandPaletteScope";

export function useCommandPaletteActionItems(
  onGenerateSql: (target: TableTarget) => void,
  onInspect: (target: TableTarget) => void,
) {
  const { t } = useTranslation();
  const scope = useActiveCommandPaletteScope();

  return useMemo(() => {
    if (!scope) return [];

    return createBuiltInCommandItems(
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
        connectionCategory: t("commandPalette.categories.connection"),
        tableCategory: t("commandPalette.categories.table"),
      },
      { generateSql: onGenerateSql, inspect: onInspect },
    );
  }, [onGenerateSql, onInspect, scope, t]);
}
