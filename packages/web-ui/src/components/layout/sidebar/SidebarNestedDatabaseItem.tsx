import React, { useCallback, useState } from "react";
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
  Settings2,
  Download,
  Upload,
  Network,
} from "lucide-react";
import { SidebarSchemaItem } from "./SidebarSchemaItem";
import type { NestedDatabaseData, RoutineInfo, TriggerInfo } from "../../../contexts/DatabaseContext";
import type { TableColumn } from "../../../types/schema";
import type { ContextMenuData } from "../../../types/sidebar";
import { onActivationKey } from "../../../utils/keyboardEvents";
import { useEscapeKey } from "../../../hooks/useEscapeKey";

interface SidebarNestedDatabaseItemProps {
  databaseName: string;
  nestedData: NestedDatabaseData | undefined;
  activeTable: string | null;
  connectionId: string;
  driver: string;
  schemaVersion: number;
  onLoadSchemas: (database: string, force?: boolean) => void;
  onSetSelectedSchemas: (database: string, schemas: string[]) => void;
  onLoadSchemaData: (database: string, schema: string) => void;
  onRefreshSchemaData: (database: string, schema: string) => void;
  onNewConsole: (schema: string, database?: string) => void;
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
  onAddColumn: (tableName: string, schema: string, database: string) => void;
  onEditColumn: (tableName: string, col: TableColumn, schema: string, database: string) => void;
  onAddIndex: (tableName: string, schema: string, database: string) => void;
  onDropIndex: (tableName: string, indexName: string, schema: string, database: string) => void;
  onAddForeignKey: (tableName: string, schema: string, database: string) => void;
  onDropForeignKey: (tableName: string, fkName: string, schema: string, database: string) => void;
  onCreateTable: (schema: string, database: string) => void;
  onCreateView: (schema: string, database: string) => void;
  onCreateTrigger: (schema: string, database: string) => void;
  /** Optional dump/import entry points — mirror SidebarDatabaseItem's props,
   * but scoped to both a database AND the user's currently active schema
   * within that database. */
  onDump?: (database: string, schema: string) => void;
  onImport?: (database: string, schema: string) => void;
  /** The nested tree has no context menu on the database/schema row itself
   * (only on a table, once one exists) to reach the flat multi-db tree's
   * "View ER Diagram" — and the connection-level header button that used
   * to still be visible here read the wrong (top-level, not per-database)
   * schema/database state, opening an empty diagram (#822 follow-up). */
  onViewERDiagram?: (database: string, schema?: string) => void;
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
  onNewConsole,
  onTableClick,
  onTableDoubleClick,
  onViewClick,
  onViewDoubleClick,
  onRoutineDoubleClick,
  onTriggerDoubleClick,
  onContextMenu,
  onAddColumn,
  onEditColumn,
  onAddIndex,
  onDropIndex,
  onAddForeignKey,
  onDropForeignKey,
  onCreateTable,
  onCreateView,
  onCreateTrigger,
  onDump,
  onImport,
  onViewERDiagram,
  showTriggers = false,
}: SidebarNestedDatabaseItemProps) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingSchemaSelection, setPendingSchemaSelection] = useState<Set<string>>(new Set());
  const [isSchemaFilterOpen, setIsSchemaFilterOpen] = useState(false);

  const schemas = nestedData?.schemas ?? [];
  const selectedSchemas = nestedData?.selectedSchemas ?? [];
  const schemaDataMap = nestedData?.schemaDataMap ?? {};
  const activeSchema = nestedData?.activeSchema ?? null;
  const isLoadingSchemas = nestedData?.isLoadingSchemas ?? false;
  const needsSchemaSelection = nestedData?.needsSchemaSelection ?? false;

  const closeSchemaFilter = useCallback(() => setIsSchemaFilterOpen(false), []);
  useEscapeKey(isSchemaFilterOpen, closeSchemaFilter);

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
          <div className="flex items-center opacity-0 group-hover/db:opacity-100 ml-1">
            {onImport && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onImport(databaseName, activeSchema ?? "public");
                }}
                className="p-0.5 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                title={t("dump.importDatabase")}
                aria-label={t("dump.importDatabase")}
              >
                <Upload size={12} />
              </button>
            )}
            {onDump && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDump(databaseName, activeSchema ?? "public");
                }}
                className="p-0.5 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                title={t("dump.dumpDatabase")}
                aria-label={t("dump.dumpDatabase")}
              >
                <Download size={12} />
              </button>
            )}
            {onViewERDiagram && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewERDiagram(databaseName, activeSchema ?? undefined);
                }}
                className="p-0.5 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                title={t("sidebar.viewERDiagram")}
                aria-label={t("sidebar.viewERDiagram")}
              >
                <Network size={12} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onLoadSchemas(databaseName, true);
              }}
              className="p-0.5 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors mr-3"
              title={t("sidebar.refreshTables") || "Refresh"}
              aria-label={t("sidebar.refreshTables") || "Refresh"}
            >
              <RefreshCw size={12} />
            </button>
          </div>
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
            <>
              {/* Schema selection header */}
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-semibold uppercase text-muted tracking-wider">
                  {t("sidebar.schemas")} ({selectedSchemas.length}/{schemas.length})
                </span>
                <div className="relative">
                  <button
                    onClick={() => {
                      setPendingSchemaSelection(new Set(selectedSchemas));
                      setIsSchemaFilterOpen(!isSchemaFilterOpen);
                    }}
                    className={`p-1 rounded transition-colors mr-1.5 ${
                      selectedSchemas.length < schemas.length
                        ? "text-accent bg-accent-primary/10"
                        : "text-muted hover:text-secondary hover:bg-surface-secondary"
                    }`}
                    title={t("sidebar.editSchemas")}
                  >
                    <Settings2 size={14} />
                  </button>
                  {isSchemaFilterOpen && (
                    <>
                      <div
                        role="presentation"
                        className="fixed inset-0 z-40"
                        onClick={closeSchemaFilter}
                      />
                      <div className="absolute right-0 top-8 bg-elevated border border-default rounded-lg shadow-lg z-40 py-2 min-w-[200px] max-h-[300px] flex flex-col">
                        <div className="flex items-center justify-between px-3 pb-2 border-b border-default">
                          <span className="text-xs font-semibold text-secondary">
                            {t("sidebar.editSchemas")}
                          </span>
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
                        </div>
                        <div className="overflow-y-auto py-1">
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
                        <div className="px-3 pt-2 border-t border-default">
                          <button
                            onClick={() => {
                              if (pendingSchemaSelection.size > 0) {
                                onSetSelectedSchemas(databaseName, Array.from(pendingSchemaSelection));
                              }
                              setIsSchemaFilterOpen(false);
                            }}
                            disabled={pendingSchemaSelection.size === 0}
                            className={`w-full flex items-center justify-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
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
                    </>
                  )}
                </div>
              </div>
              {selectedSchemas.map((schemaName) => (
                <SidebarSchemaItem
                  key={schemaName}
                  schemaName={schemaName}
                  schemaData={schemaDataMap[schemaName]}
                  activeTable={activeTable}
                  activeSchema={activeSchema}
                  connectionId={connectionId}
                  driver={driver}
                  schemaVersion={schemaVersion}
                  database={databaseName}
                  onLoadSchema={() => onLoadSchemaData(databaseName, schemaName)}
                  onRefreshSchema={() => onRefreshSchemaData(databaseName, schemaName)}
                  onNewConsole={onNewConsole}
                  onTableClick={(name, schema) => onTableClick(name, schema, databaseName)}
                  onTableDoubleClick={(name, schema) => onTableDoubleClick(name, schema, databaseName)}
                  onViewClick={onViewClick}
                  onViewDoubleClick={(name, schema, materialized) =>
                    onViewDoubleClick(name, schema, databaseName, materialized)
                  }
                  onRoutineDoubleClick={(routine, schema) => onRoutineDoubleClick(routine, schema, databaseName)}
                  onTriggerDoubleClick={(trigger, schema) => onTriggerDoubleClick(trigger, schema, databaseName)}
                  onContextMenu={onContextMenu}
                  onAddColumn={(t_name) => onAddColumn(t_name, schemaName, databaseName)}
                  onEditColumn={(t_name, col) => onEditColumn(t_name, col, schemaName, databaseName)}
                  onAddIndex={(t_name) => onAddIndex(t_name, schemaName, databaseName)}
                  onDropIndex={(t_name, indexName) => onDropIndex(t_name, indexName, schemaName, databaseName)}
                  onAddForeignKey={(t_name) => onAddForeignKey(t_name, schemaName, databaseName)}
                  onDropForeignKey={(t_name, fkName) => onDropForeignKey(t_name, fkName, schemaName, databaseName)}
                  onCreateTable={() => onCreateTable(schemaName, databaseName)}
                  onCreateView={() => onCreateView(schemaName, databaseName)}
                  onCreateTrigger={() => onCreateTrigger(schemaName, databaseName)}
                  showTriggers={showTriggers}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
