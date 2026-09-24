import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useCommandPaletteState } from "../../hooks/useCommandPalette";
import { useCommandPaletteActionItems } from "../../hooks/useCommandPaletteActionItems";
import { useCommandPaletteObjectItems } from "../../hooks/useCommandPaletteObjectItems";
import { useActiveCommandPaletteScope } from "../../hooks/useCommandPaletteScope";
import { GenerateSQLModal } from "./GenerateSQLModal";
import { SchemaModal } from "./SchemaModal";
import {
  Palette,
  type PaletteLabels,
} from "./commandPalette/Palette";
import type { TableTarget } from "../../types/databaseObjects";

/**
 * Each palette mounts only while it is the active one: the object palette
 * eagerly loads every schema, which must not happen for the action palette.
 */
interface ActionPaletteProps {
  onGenerateSql: (target: TableTarget) => void;
  onInspect: (target: TableTarget) => void;
}

const ActionPalette = ({
  onGenerateSql,
  onInspect,
}: ActionPaletteProps) => {
  const { t } = useTranslation();
  const items = useCommandPaletteActionItems(onGenerateSql, onInspect);
  const labels: PaletteLabels = {
    ariaLabel: t("commandPalette.title"),
    searchLabel: t("commandPalette.searchLabel"),
    placeholder: t("commandPalette.placeholder"),
    noResults: t("commandPalette.noResults"),
    navigationHint: t("commandPalette.navigationHint"),
    escapeHint: t("commandPalette.escapeHint"),
  };

  return <Palette labels={labels} items={items} />;
};

interface ObjectPaletteProps {
  onGenerateSql: (target: TableTarget) => void;
  onInspect: (target: TableTarget) => void;
}

const ObjectPalette = ({
  onGenerateSql,
  onInspect,
}: ObjectPaletteProps) => {
  const { t } = useTranslation();
  const { items, error } = useCommandPaletteObjectItems(
    onGenerateSql,
    onInspect,
  );
  const labels: PaletteLabels = {
    ariaLabel: t("commandPalette.objectsTitle"),
    searchLabel: t("editor.quickNavigator.placeholder"),
    placeholder: t("editor.quickNavigator.placeholder"),
    noResults: t("editor.quickNavigator.noResults"),
    navigationHint: t("commandPalette.navigationHint"),
    escapeHint: t("commandPalette.escapeHint"),
    getCountLabel: (count) =>
      count === 1
        ? t("editor.quickNavigator.count_one")
        : t("editor.quickNavigator.count_other", { count }),
  };

  return <Palette labels={labels} items={items} error={error} />;
};

export const CommandPaletteModal = () => {
  const { activePalette } = useCommandPaletteState();
  const scope = useActiveCommandPaletteScope();
  const [generateSQLTarget, setGenerateSQLTarget] =
    useState<TableTarget | null>(null);
  const [inspectTarget, setInspectTarget] =
    useState<TableTarget | null>(null);

  return (
    <>
      {activePalette === "actions" && (
        <ActionPalette
          onGenerateSql={setGenerateSQLTarget}
          onInspect={setInspectTarget}
        />
      )}
      {activePalette === "objects" && (
        <ObjectPalette
          onGenerateSql={setGenerateSQLTarget}
          onInspect={setInspectTarget}
        />
      )}
      {generateSQLTarget && (
        <GenerateSQLModal
          isOpen
          target={generateSQLTarget}
          openEditor={scope?.runtime.openEditor}
          onClose={() => setGenerateSQLTarget(null)}
        />
      )}
      {inspectTarget && (
        <SchemaModal
          isOpen
          target={inspectTarget}
          onClose={() => setInspectTarget(null)}
        />
      )}
    </>
  );
};
