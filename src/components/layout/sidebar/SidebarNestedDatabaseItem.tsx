import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Database,
  RefreshCw,
  Check,
  CheckSquare,
  Square,
} from "lucide-react";
import { SidebarSchemaItem } from "./SidebarSchemaItem";
import type { NestedDatabaseData, RoutineInfo, TriggerInfo } from "../../../contexts/DatabaseContext";
import type { ContextMenuData } from "../../../types/sidebar";
import { onActivationKey } from "../../../utils/keyboardEvents";

interface SidebarNestedDatabaseItemProps {
  databaseName: string;
  nestedData: NestedDatabaseData | undefined;
  activeTable: string | null;
  connectionId: string;
  driver: string;
  schemaVersion: number;
  onLoadSchemas: (database: string) => void;
  onSetSelectedSchemas: (database: string, schemas: string[]) => void;
  onLoadSchemaData: (database: string, schema: string) => void;
  onRefreshSchemaData: (database: string, schema: string) => void;
  onTableClick: (name: string, schema: string, database: string) => void;
  onTableDoubleClick: (name: string, schema: string, database: string) => void;
  onViewClick: (name: string) => void;
  onViewDoubleClick: (
    name: string,
    schema: string,
    database: string,
    materialized?: boolean,
  ) => void;
  onRoutineDoubleClick: (routine: RoutineInfo, schema: string, database: string) => void;
  onTriggerDoubleClick: (trigger: TriggerInfo, schema: string, database: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    type: string,
    id: string,
    label: string,
    data?: ContextMenuData,
  ) => void;
  /** Table-mutation actions (create/drop table/view/trigger, add/drop column,
   * index, foreign key) aren't wired for nested multi-database browsing yet
   * — invoked in place of those callbacks to tell the user why nothing
   * happened, instead of silently no-opping or hiding the affordance. */
  onUnsupportedAction: () => void;
  showTriggers?: boolean;
}

/**
 * One database row in a schema-based multi-db connection's sidebar tree
 * (e.g. PostgreSQL browsing several databases on one connection — see
 * isSchemaBasedMultiDb). Expands into that database's own schema picker
 * (mirrors the single-database schema-picker UI) and, once schemas are
 * selected, a `SidebarSchemaItem` per schema — the same component the
 * single-database Postgres layout uses, just scoped to this database.
 */
export const SidebarNestedDatabaseItem = ({
  databaseName,
  nestedData,
  activeTable,
  connectionId,
  driver,
  schemaVersion,
  onLoadSchemas,
  onSetSelectedSchemas,
  onLoadSchemaData,
  onRefreshSchemaData,
  onTableClick,
  onTableDoubleClick,
  onViewClick,
  onViewDoubleClick,
  onRoutineDoubleClick,
  onTriggerDoubleClick,
  onContextMenu,
  onUnsupportedAction,
  showTriggers = false,
}: SidebarNestedDatabaseItemProps) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingSchemaSelection, setPendingSchemaSelection] = useState<Set<string>>(new Set());

  const schemas = nestedData?.schemas ?? [];
  const selectedSchemas = nestedData?.selectedSchemas ?? [];
  const schemaDataMap = nestedData?.schemaDataMap ?? {};
  const activeSchema = nestedData?.activeSchema ?? null;
  const isLoadingSchemas = nestedData?.isLoadingSchemas ?? false;
  const needsSchemaSelection = nestedData?.needsSchemaSelection ?? false;

  const handleToggle = () => {
    const willExpand = !isExpanded;
    setIsExpanded(willExpand);
    if (willExpand && !nestedData?.schemasLoaded && !isLoadingSchemas) {
      onLoadSchemas(databaseName);
    }
    if (willExpand && needsSchemaSelection) {
      setPendingSchemaSelection(new Set(selectedSchemas));
    }
  };

  return (
    <div className="flex flex-col">
      {/* Database header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className="flex items-center justify-between px-2 py-1.5 group/db cursor-pointer hover:bg-surface-secondary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        onClick={handleToggle}
        onKeyDown={onActivationKey(handleToggle)}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isExpanded ? (
            <ChevronDown size={14} className="text-muted shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-muted shrink-0" />
          )}
          <Database size={14} className="text-accent shrink-0" />
          <span className="text-sm font-medium text-secondary truncate">
            {databaseName}
          </span>
        </div>
        {isExpanded && !needsSchemaSelection && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLoadSchemas(databaseName);
            }}
            className="p-0.5 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors opacity-0
                group-hover/db:opacity-100 ml-1 mr-3"
            title={t("sidebar.refreshTables") || "Refresh"}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {/* Database contents */}
      {isExpanded && (
        <div className="ml-3 border-l border-default">
          {isLoadingSchemas ? (
            <div className="flex items-center gap-2 p-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" />
              {t("sidebar.loadingSchema")}
            </div>
          ) : needsSchemaSelection ? (
            /* Schema picker, scoped to this database */
            <div className="px-3 py-2">
              <div className="text-xs text-secondary mb-2">
                {t("sidebar.selectSchemasHint")}
              </div>
              <div className="border border-default rounded-lg overflow-hidden mb-2">
                <div className="max-h-[200px] overflow-y-auto py-1">
                  {schemas.map((schemaName) => {
                    const isSelected = pendingSchemaSelection.has(schemaName);
                    return (
                      <button
                        type="button"
                        key={schemaName}
                        aria-pressed={isSelected}
                        onClick={() => {
                          const next = new Set(pendingSchemaSelection);
                          if (isSelected) {
                            next.delete(schemaName);
                          } else {
                            next.add(schemaName);
                          }
                          setPendingSchemaSelection(next);
                        }}
                        className={`flex w-full text-left items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                          isSelected
                            ? "text-primary hover:bg-surface-secondary"
                            : "text-muted hover:bg-surface-secondary"
                        }`}
                      >
                        <div
                          className={`w-4 h-4 flex items-center justify-center shrink-0 ${
                            isSelected ? "text-accent" : "text-muted"
                          }`}
                        >
                          {isSelected ? (
                            <CheckSquare size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                        </div>
                        <span className="text-sm truncate select-none">
                          {schemaName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (pendingSchemaSelection.size === schemas.length) {
                      setPendingSchemaSelection(new Set());
                    } else {
                      setPendingSchemaSelection(new Set(schemas));
                    }
                  }}
                  className="text-xs text-accent hover:underline"
                >
                  {pendingSchemaSelection.size === schemas.length
                    ? t("sidebar.deselectAll")
                    : t("sidebar.selectAll")}
                </button>
                <button
                  onClick={() => {
                    if (pendingSchemaSelection.size > 0) {
                      onSetSelectedSchemas(databaseName, Array.from(pendingSchemaSelection));
                      setPendingSchemaSelection(new Set());
                    }
                  }}
                  disabled={pendingSchemaSelection.size === 0}
                  className={`ml-auto flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                    pendingSchemaSelection.size > 0
                      ? "bg-accent-primary text-inverse hover:bg-accent-primary/90"
                      : "bg-surface-secondary text-muted cursor-not-allowed"
                  }`}
                >
                  <Check size={12} />
                  {t("sidebar.confirmSelection")}
                </button>
              </div>
            </div>
          ) : (
            selectedSchemas.map((schemaName) => (
              <SidebarSchemaItem
                key={schemaName}
                schemaName={schemaName}
                schemaData={schemaDataMap[schemaName]}
                activeTable={activeTable}
                activeSchema={activeSchema}
                connectionId={connectionId}
                driver={driver}
                schemaVersion={schemaVersion}
                onLoadSchema={() => onLoadSchemaData(databaseName, schemaName)}
                onRefreshSchema={() => onRefreshSchemaData(databaseName, schemaName)}
                onTableClick={(name, schema) => onTableClick(name, schema, databaseName)}
                onTableDoubleClick={(name, schema) => onTableDoubleClick(name, schema, databaseName)}
                onViewClick={onViewClick}
                onViewDoubleClick={(name, schema, materialized) =>
                  onViewDoubleClick(name, schema, databaseName, materialized)
                }
                onRoutineDoubleClick={(routine, schema) => onRoutineDoubleClick(routine, schema, databaseName)}
                onTriggerDoubleClick={(trigger, schema) => onTriggerDoubleClick(trigger, schema, databaseName)}
                onContextMenu={onContextMenu}
                onAddColumn={onUnsupportedAction}
                onEditColumn={onUnsupportedAction}
                onAddIndex={onUnsupportedAction}
                onDropIndex={onUnsupportedAction}
                onAddForeignKey={onUnsupportedAction}
                onDropForeignKey={onUnsupportedAction}
                onCreateTable={onUnsupportedAction}
                onCreateView={onUnsupportedAction}
                onCreateTrigger={onUnsupportedAction}
                showTriggers={showTriggers}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
