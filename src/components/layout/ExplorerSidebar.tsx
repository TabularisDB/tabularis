import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { quoteTableRef } from "../../utils/identifiers";
import { invoke } from "@tauri-apps/api/core";
import {
  Database,
  Plus,
  FileCode,
  Play,
  Edit,
  Trash2,
  PanelLeftClose,
  Network,
  PlaySquare,
  Hash,
  FileText,
  Copy,
  Loader2,
  Download,
  Upload,
  ChevronDown,
  RefreshCw,
  ChevronRight,
  Settings2,
  Check,
  CheckSquare,
  Square,
  Search,
  X,
  Star,
  FileInput,
  Layers,
  Clock,
  Clipboard,
} from "lucide-react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { toErrorMessage } from "../../utils/errors";
import { useAlert } from "../../hooks/useAlert";
import { useDatabase } from "../../hooks/useDatabase";
import { useSavedQueries } from "../../hooks/useSavedQueries";
import { useQueryHistory } from "../../hooks/useQueryHistory";
import type { SavedQuery } from "../../contexts/SavedQueriesContext";
import type { QueryHistoryEntry } from "../../types/queryHistory";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { SchemaModal } from "../modals/SchemaModal";
import { CreateTableModal } from "../modals/CreateTableModal";
import { QueryModal } from "../modals/QueryModal";
import { ModifyColumnModal } from "../modals/ModifyColumnModal";
import { CreateIndexModal } from "../modals/CreateIndexModal";
import { CreateForeignKeyModal } from "../modals/CreateForeignKeyModal";
import { GenerateSQLModal } from "../modals/GenerateSQLModal";
import { DumpDatabaseModal } from "../modals/DumpDatabaseModal";
import { ImportDatabaseModal } from "../modals/ImportDatabaseModal";
import { ClipboardImportModal } from "../modals/ClipboardImportModal";
import { ViewEditorModal } from "../modals/ViewEditorModal";
import { TriggerEditorModal } from "../modals/TriggerEditorModal";
import { ConfirmModal } from "../modals/ConfirmModal";
import { Accordion } from "./sidebar/Accordion";
import { SidebarTableItem } from "./sidebar/SidebarTableItem";
import { SidebarViewItem } from "./sidebar/SidebarViewItem";
import { SidebarRoutineItem } from "./sidebar/SidebarRoutineItem";
import { SidebarSchemaItem } from "./sidebar/SidebarSchemaItem";
import { SidebarDatabaseItem } from "./sidebar/SidebarDatabaseItem";
import { SidebarTriggerItem } from "./sidebar/SidebarTriggerItem";
import { QueryHistorySection } from "./sidebar/QueryHistorySection";
import { useConnectionLayoutContext } from "../../hooks/useConnectionLayoutContext";
import type { TableColumn } from "../../types/schema";
import type { ContextMenuData } from "../../types/sidebar";
import type { RoutineInfo, TriggerInfo } from "../../contexts/DatabaseContext";
import { groupRoutinesByType } from "../../utils/routines";
import { formatObjectCount } from "../../utils/schema";
import { groupByDate, formatHistoryTime } from "../../utils/dateGroups";
import { SqlHighlight } from "../ui/SqlHighlight";
import { isMultiDatabaseCapable } from "../../utils/database";
import { supportsManageTables } from "../../utils/driverCapabilities";
import { newConsoleForDatabase, newConsoleForTable } from "../../utils/newConsole";

export type SidebarTab = "structure" | "favorites" | "history";

interface ExplorerSidebarProps {
  sidebarWidth: number;
  startResize: (e: React.MouseEvent) => void;
  onCollapse: () => void;
  sidebarTab: SidebarTab;
  onSidebarTabChange: (tab: SidebarTab) => void;
}

export const ExplorerSidebar = ({ sidebarWidth, startResize, onCollapse, sidebarTab, onSidebarTabChange }: ExplorerSidebarProps) => {
  const { t } = useTranslation();
  const {
    activeConnectionId,
    activeDriver,
    activeCapabilities,
    activeTable,
    setActiveTable,
    tables,
    views,
    routines,
    triggers,
    isLoadingTables,
    refreshTables,
    refreshViews,
    refreshRoutines,
    refreshTriggers,
    activeConnectionName,
    activeDatabaseName,
    schemas,
    isLoadingSchemas,
    schemaDataMap,
    activeSchema,
    loadSchemaData,
    refreshSchemaData,
    selectedSchemas,
    setSelectedSchemas,
    needsSchemaSelection,
    selectedDatabases,
    setSelectedDatabases,
    databaseDataMap,
    loadDatabaseData,
    refreshDatabaseData,
    connectionDataMap,
  } = useDatabase();
  const { queries, deleteQuery, updateQuery, saveQuery } = useSavedQueries();
  const { entries: historyEntries, isLoading: isHistoryLoading, deleteEntry: deleteHistoryEntry, clearHistory } = useQueryHistory();
  const { showAlert } = useAlert();
  const navigate = useNavigate();
  const [schemaVersion, setSchemaVersion] = useState(0);

  const { splitView, isSplitVisible, explorerConnectionId, setExplorerConnectionId } = useConnectionLayoutContext();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: string;
    id: string;
    label: string;
    data?: ContextMenuData;
  } | null>(null);
  const [schemaModal, setSchemaModal] = useState<{ tableName: string; schema?: string } | null>(null);
  const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
  const [isClipboardImportOpen, setIsClipboardImportOpen] = useState(false);
  const [modifyColumnModal, setModifyColumnModal] = useState<{
    isOpen: boolean;
    tableName: string;
    column: TableColumn | null;
  }>({ isOpen: false, tableName: "", column: null });
  const [createIndexModal, setCreateIndexModal] = useState<{
    isOpen: boolean;
    tableName: string;
  }>({ isOpen: false, tableName: "" });
  const [createForeignKeyModal, setCreateForeignKeyModal] = useState<{
    isOpen: boolean;
    tableName: string;
  }>({ isOpen: false, tableName: "" });
  const [generateSQLModal, setGenerateSQLModal] = useState<string | null>(null);
  const setSidebarTab = onSidebarTabChange;
  const [historyToFavoriteSQL, setHistoryToFavoriteSQL] = useState<string | null>(null);
  const [historyToFavoriteDB, setHistoryToFavoriteDB] = useState<string | null>(null);
  const [historyDeleteConfirm, setHistoryDeleteConfirm] = useState<string | null>(null);
  const [historyClearConfirm, setHistoryClearConfirm] = useState(false);
  const [favoriteDeleteConfirm, setFavoriteDeleteConfirm] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [favoritesFilter, setFavoritesFilter] = useState("");
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<string | null>(null);
  const [tablesOpen, setTablesOpen] = useState(true);
  const [viewsOpen, setViewsOpen] = useState(true);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [triggersOpenFlat, setTriggersOpenFlat] = useState(false);
  const [triggerFilterFlat, setTriggerFilterFlat] = useState("");
  const [functionsOpen, setFunctionsOpen] = useState(true);
  const [proceduresOpen, setProceduresOpen] = useState(true);
  const [activeView, setActiveView] = useState<string | null>(null);
  const [queryModal, setQueryModal] = useState<{
    isOpen: boolean;
    query?: SavedQuery;
  }>({ isOpen: false });
  const [dumpModal, setDumpModal] = useState<{ database: string } | null>(null);
  const [importModal, setImportModal] = useState<{
    filePath: string;
    database: string;
  } | null>(null);
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const [isSchemaFilterOpen, setIsSchemaFilterOpen] = useState(false);
  const [pendingSchemaSelection, setPendingSchemaSelection] = useState<Set<string>>(new Set());
  const [dbFilter, setDbFilter] = useState("");
  const [isDbManagerOpen, setIsDbManagerOpen] = useState(false);
  const [pendingDbSelection, setPendingDbSelection] = useState<Set<string>>(new Set());
  const [allAvailableDatabases, setAllAvailableDatabases] = useState<string[]>([]);
  const [isLoadingAllDbs, setIsLoadingAllDbs] = useState(false);
  const [viewEditorModal, setViewEditorModal] = useState<{
    isOpen: boolean;
    viewName?: string;
    isNewView?: boolean;
  }>({ isOpen: false });

  const [triggerEditorModal, setTriggerEditorModal] = useState<{
    isOpen: boolean;
    triggerName?: string;
    tableName?: string;
    schema?: string;
    isNewTrigger?: boolean;
  }>({ isOpen: false });

  const groupedRoutines = routines ? groupRoutinesByType(routines) : { procedures: [], functions: [] };

  const runQuery = (sql: string, queryName?: string, tableName?: string, preventAutoRun: boolean = false, schema?: string, readOnly?: boolean) => {
    navigate("/editor", {
      state: { initialQuery: sql, queryName, tableName, preventAutoRun, schema, readOnly, targetConnectionId: activeConnectionId },
    });
  };

  useEffect(() => {
    const handler = () => {
      if (activeConnectionId && activeCapabilities?.no_connection_required !== true) {
        setIsClipboardImportOpen(true);
      }
    };
    window.addEventListener("tabularis:paste-import", handler);
    return () => window.removeEventListener("tabularis:paste-import", handler);
  }, [activeConnectionId, activeCapabilities]);

  const handleTableClick = (tableName: string, schema?: string) => {
    setActiveTable(tableName, schema);
  };

  const handleOpenTable = (tableName: string, schema?: string) => {
    if (schema) {
      setActiveTable(tableName, schema);
    }
    const quotedTable = quoteTableRef(tableName, activeDriver, schema);
    navigate("/editor", {
      state: {
        initialQuery: `SELECT * FROM ${quotedTable}`,
        tableName: tableName,
        schema,
        targetConnectionId: activeConnectionId,
      },
    });
  };

  const handleViewClick = (viewName: string) => {
    setActiveView(viewName);
  };

  const handleOpenView = (viewName: string, schema?: string) => {
    const quotedView = quoteTableRef(viewName, activeDriver, schema);
    navigate("/editor", {
      state: {
        initialQuery: `SELECT * FROM ${quotedView}`,
        tableName: viewName,
        schema,
        targetConnectionId: activeConnectionId,
      },
    });
  };

  // Multi-database: open table/view without qualified prefix — backend uses USE <db> for isolation
  const handleOpenDatabaseTable = (tableName: string, database?: string) => {
    if (database) setActiveTable(tableName, database);
    const quotedTable = quoteTableRef(tableName, activeDriver);
    navigate("/editor", {
      state: {
        initialQuery: `SELECT * FROM ${quotedTable}`,
        tableName,
        schema: database,
        title: database ? `${tableName} (${database})` : tableName,
        targetConnectionId: activeConnectionId,
      },
    });
  };

  const handleOpenDatabaseView = (viewName: string, database?: string) => {
    const quotedView = quoteTableRef(viewName, activeDriver);
    navigate("/editor", {
      state: {
        initialQuery: `SELECT * FROM ${quotedView}`,
        tableName: viewName,
        schema: database,
        title: database ? `${viewName} (${database})` : viewName,
        targetConnectionId: activeConnectionId,
      },
    });
  };

  const handleRoutineDoubleClick = async (routine: RoutineInfo, schema?: string) => {
    try {
      const definition = await invoke<string>("get_routine_definition", {
        connectionId: activeConnectionId,
        routineName: routine.name,
        routineType: routine.routine_type,
        ...(schema ? { schema } : {}),
      });
      runQuery(definition, `${routine.name} Definition`, undefined, true);
    } catch (e) {
      console.error(e);
      showAlert(
        t("sidebar.failGetRoutineDefinition") + String(e),
        { kind: "error" }
      );
    }
  };

  const handleTriggerDoubleClick = async (trigger: TriggerInfo, schema?: string) => {
    try {
      const definition = await invoke<string>("get_trigger_definition", {
        connectionId: activeConnectionId,
        triggerName: trigger.name,
        tableName: trigger.table_name,
        ...(schema ? { schema } : {}),
      });
      runQuery(definition, `${trigger.name} Definition`, undefined, true, schema, true);
    } catch (e) {
      console.error(e);
      showAlert(
        t("sidebar.failGetTriggerDefinition") + String(e),
        { kind: "error" }
      );
    }
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    type: string,
    id: string,
    label: string,
    data?: ContextMenuData,
  ) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, label, data });
  };

  const handleImportDatabase = async (database?: string) => {
    const file = await open({
      filters: [{ name: "SQL / Zip File", extensions: ["sql", "zip"] }],
    });
    if (file && typeof file === "string") {
      const confirmed = await ask(
        t("dump.confirmImport", { file: file.split(/[\\/]/).pop() }),
        { title: t("dump.importDatabase"), kind: "warning" },
      );
      if (!confirmed) return;
      setImportModal({ filePath: file, database: database ?? activeDatabaseName ?? "" });
    }
  };

  const isMultiDb = isMultiDatabaseCapable(activeCapabilities) && selectedDatabases.length > 1;

  return (
    <>
      <aside
        className="bg-base border-r border-default flex flex-col relative shrink-0"
        style={{ width: sidebarWidth }}
      >
        {/* Resize Handle */}
        <div
          onMouseDown={startResize}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 z-30 transition-colors"
        />

        {/* Tab switcher for split view */}
        {splitView && isSplitVisible && (
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-default">
            {splitView.connectionIds.map(connId => {
              const name = connectionDataMap[connId]?.connectionName ?? connId;
              const isActive = explorerConnectionId === connId;
              return (
                <button
                  key={connId}
                  onClick={() => setExplorerConnectionId(connId)}
                  className={isActive
                    ? 'text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/40'
                    : 'text-xs px-2 py-0.5 rounded text-muted hover:text-primary hover:bg-surface-secondary'}
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}

        <div className="p-4 border-b border-default font-semibold text-sm text-primary flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Database size={16} className="text-blue-400 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span>{t("sidebar.explorer")}</span>
              {activeConnectionName && (
                <span className="text-xs font-normal text-muted truncate">{activeConnectionName}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Global actions — hidden in multi-database mode (actions move to each database node) and for API-based plugins */}
            {!isMultiDb && activeCapabilities?.no_connection_required !== true && (sidebarWidth < 200 ? (
              <div className="relative">
                <button
                  onClick={() => setIsActionsDropdownOpen(!isActionsDropdownOpen)}
                  className="text-muted hover:text-secondary transition-colors p-1 hover:bg-surface-secondary rounded"
                  title={t("sidebar.actions")}
                >
                  <ChevronDown size={16} />
                </button>
                {isActionsDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsActionsDropdownOpen(false)}
                    />
                    <div className="absolute left-0 top-8 bg-elevated border border-default rounded-lg shadow-lg z-40 py-1 min-w-[200px]">
                      <button
                        onClick={() => {
                          handleImportDatabase();
                          setIsActionsDropdownOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-secondary hover:bg-surface-secondary hover:text-primary transition-colors text-left whitespace-nowrap"
                      >
                        <Upload size={16} className="text-green-400 shrink-0" />
                        <span>{t("dump.importDatabase")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setDumpModal({ database: activeDatabaseName ?? "" });
                          setIsActionsDropdownOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-secondary hover:bg-surface-secondary hover:text-primary transition-colors text-left whitespace-nowrap"
                      >
                        <Download size={16} className="text-blue-400 shrink-0" />
                        <span>{t("dump.dumpDatabase")}</span>
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await invoke("open_er_diagram_window", {
                              connectionId: activeConnectionId || "",
                              connectionName: activeConnectionName || "Unknown",
                              databaseName: activeDatabaseName || "Unknown",
                              ...(activeSchema ? { schema: activeSchema } : {}),
                            });
                          } catch (e) {
                            console.error("Failed to open ER Diagram window:", e);
                          }
                          setIsActionsDropdownOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-secondary hover:bg-surface-secondary hover:text-primary transition-colors text-left whitespace-nowrap"
                      >
                        <Network size={16} className="rotate-90 text-orange-400 shrink-0" />
                        <span>View Schema Diagram</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <button
                  onClick={() => handleImportDatabase()}
                  className="text-muted hover:text-green-400 transition-colors p-1 hover:bg-surface-secondary rounded"
                  title={t("dump.importDatabase")}
                >
                  <Upload size={16} />
                </button>
                <button
                  onClick={() => setDumpModal({ database: activeDatabaseName ?? "" })}
                  className="text-muted hover:text-blue-400 transition-colors p-1 hover:bg-surface-secondary rounded"
                  title={t("dump.dumpDatabase")}
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={async () => {
                    try {
                      await invoke("open_er_diagram_window", {
                        connectionId: activeConnectionId || "",
                        connectionName: activeConnectionName || "Unknown",
                        databaseName: activeDatabaseName || "Unknown",
                        ...(activeSchema ? { schema: activeSchema } : {}),
                      });
                    } catch (e) {
                      console.error("Failed to open ER Diagram window:", e);
                    }
                  }}
                  className="text-muted hover:text-orange-400 transition-colors p-1 hover:bg-surface-secondary rounded"
                  title="View Schema Diagram"
                >
                  <Network size={16} className="rotate-90" />
                </button>
              </>
            ))}
            <button
              onClick={onCollapse}
              className="text-muted hover:text-secondary transition-colors p-1 hover:bg-surface-secondary rounded"
              title="Collapse Explorer"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center border-b border-default bg-base px-1">
          {([
            { id: "structure" as const, icon: Layers, label: t("sidebar.structure") },
            { id: "favorites" as const, icon: Star, label: t("sidebar.favorites"), count: queries.length },
            { id: "history" as const, icon: Clock, label: t("sidebar.queryHistory"), count: historyEntries.length },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSidebarTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 text-xs font-medium transition-colors relative min-w-0 ${
                sidebarTab === tab.id
                  ? "text-primary"
                  : "text-muted hover:text-secondary"
              }`}
              title={`${tab.label}${tab.count !== undefined && tab.count > 0 ? ` (${tab.count})` : ""}`}
            >
              <tab.icon size={14} className="shrink-0" />
              {sidebarWidth >= 200 && (
                <span className="truncate">{tab.label}</span>
              )}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-[10px] text-muted shrink-0">
                  {sidebarWidth >= 200 ? `(${tab.count})` : tab.count}
                </span>
              )}
              {sidebarTab === tab.id && (
                <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-blue-500 rounded-full" />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {/* Favorites tab */}
          {sidebarTab === "favorites" && (<div className="animate-fade-in">{(() => {
            const sorted = [...queries].sort((a, b) => {
              if (!a.updated_at && !b.updated_at) return 0;
              if (!a.updated_at) return 1;
              if (!b.updated_at) return -1;
              return b.updated_at.localeCompare(a.updated_at);
            });
            const filteredQueries = favoritesFilter.trim()
              ? sorted.filter((q) => q.name.toLowerCase().includes(favoritesFilter.toLowerCase()) || q.sql.toLowerCase().includes(favoritesFilter.toLowerCase()))
              : sorted;
            const groupedFavorites = groupByDate(filteredQueries, (q) => q.updated_at ?? "1970-01-01");

            return queries.length === 0 ? (
              <div className="text-center p-4 text-xs text-muted italic">
                {t("sidebar.noSavedQueries")}
              </div>
            ) : (
              <div>
                <div className="px-2 pb-1.5">
                  <div className="relative">
                    <Search
                      size={12}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      type="text"
                      value={favoritesFilter}
                      onChange={(e) => setFavoritesFilter(e.target.value)}
                      placeholder={t("sidebar.searchFavorites")}
                      className="w-full pl-6 pr-2 py-1 text-xs bg-surface-secondary border border-default rounded text-primary placeholder:text-muted focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                </div>
                {favoritesFilter.trim() && (
                  <div className="px-3 pb-1 text-[10px] text-muted">
                    {filteredQueries.length} / {queries.length}
                  </div>
                )}
                {groupedFavorites.length === 0 ? (
                  <div className="text-center p-2 text-xs text-muted italic">
                    {t("sidebar.noFavoritesSearchResults")}
                  </div>
                ) : (
                  groupedFavorites.map(([groupKey, items]) => (
                    <div key={groupKey}>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted tracking-wider">
                        {t(`sidebar.${groupKey}`)}
                      </div>
                      {items.map((q) => (
                        <div
                          key={q.id}
                          onClick={() => setSelectedFavoriteId(q.id)}
                          onDoubleClick={() => runQuery(q.sql, q.name, undefined, false, q.database ?? undefined)}
                          onContextMenu={(e) =>
                            handleContextMenu(e, "query", q.id, q.name, q)
                          }
                          className={`pl-3 pr-3 py-1.5 cursor-pointer group transition-colors border-b border-default/30 ${
                            selectedFavoriteId === q.id
                              ? "bg-surface-secondary"
                              : "hover:bg-surface-secondary"
                          }`}
                          title={q.database ? `[${q.database}] ${q.sql}` : q.sql}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[13px] font-semibold text-primary truncate tracking-tight">{q.name}</span>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted shrink-0">
                              {q.database && (
                                <span className="flex items-center gap-0.5">
                                  <Database size={9} className="shrink-0" />
                                  <span className="truncate max-w-[80px]">{q.database}</span>
                                </span>
                              )}
                              {q.updated_at && (
                                <span>{formatHistoryTime(q.updated_at)}</span>
                              )}
                            </div>
                          </div>
                          <SqlHighlight sql={q.sql} />
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            );
          })()}</div>)}

          {/* History tab */}
          {sidebarTab === "history" && (
            <div className="animate-fade-in"><QueryHistorySection
              entries={historyEntries}
              isLoading={isHistoryLoading}
              onDoubleClick={(entry) => {
                runQuery(entry.sql, undefined, undefined, false, entry.database ?? undefined);
              }}
              onContextMenu={(e, entry) => {
                handleContextMenu(e, "history", entry.id, entry.sql, entry as unknown as ContextMenuData);
              }}
              onClearAll={() => setHistoryClearConfirm(true)}
            /></div>
          )}

          {/* Structure tab */}
          {sidebarTab === "structure" && (
            (isLoadingTables || isLoadingSchemas) ? (
              <div className="flex items-center justify-center h-20 text-muted gap-2">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">{t("sidebar.loadingSchema")}</span>
              </div>
            ) : (
              <>
              {/* Schema-capable driver: Schema tree layout */}
              {activeCapabilities?.schemas === true && schemas.length > 0 ? (
                /* Postgres schema layout (unchanged) */
                <div>
                  {needsSchemaSelection ? (
                    /* Schema picker (first connect, no saved preference) */
                    <div className="px-3 py-2">
                      <div className="text-xs font-semibold uppercase text-muted tracking-wider mb-2">
                        {t("sidebar.schemas")}
                      </div>
                      <div className="text-xs text-secondary mb-2">
                        {t("sidebar.selectSchemasHint")}
                      </div>
                      <div className="border border-default rounded-lg overflow-hidden mb-2">
                        <div className="max-h-[200px] overflow-y-auto py-1">
                          {schemas.map((schemaName) => {
                            const isSelected = pendingSchemaSelection.has(schemaName);
                            return (
                              <div
                                key={schemaName}
                                onClick={() => {
                                  const next = new Set(pendingSchemaSelection);
                                  if (isSelected) {
                                    next.delete(schemaName);
                                  } else {
                                    next.add(schemaName);
                                  }
                                  setPendingSchemaSelection(next);
                                }}
                                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                                  isSelected
                                    ? "text-primary hover:bg-surface-secondary"
                                    : "text-muted hover:bg-surface-secondary"
                                }`}
                              >
                                <div
                                  className={`w-4 h-4 flex items-center justify-center shrink-0 ${
                                    isSelected ? "text-blue-500" : "text-muted"
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
                              </div>
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
                          className="text-xs text-blue-500 hover:underline"
                        >
                          {pendingSchemaSelection.size === schemas.length
                            ? t("sidebar.deselectAll")
                            : t("sidebar.selectAll")}
                        </button>
                        <button
                          onClick={() => {
                            if (pendingSchemaSelection.size > 0) {
                              setSelectedSchemas(Array.from(pendingSchemaSelection));
                              setPendingSchemaSelection(new Set());
                            }
                          }}
                          disabled={pendingSchemaSelection.size === 0}
                          className={`ml-auto flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                            pendingSchemaSelection.size > 0
                              ? "bg-blue-500 text-white hover:bg-blue-600"
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
                            className={`p-1 rounded transition-colors ${
                              selectedSchemas.length < schemas.length
                                ? "text-blue-400 hover:text-blue-300 bg-blue-500/10"
                                : "text-muted hover:text-secondary hover:bg-surface-secondary"
                            }`}
                            title={t("sidebar.editSchemas")}
                          >
                            <Settings2 size={14} />
                          </button>
                          {isSchemaFilterOpen && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setIsSchemaFilterOpen(false)}
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
                                    className="text-xs text-blue-500 hover:underline"
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
                                      <div
                                        key={schemaName}
                                        onClick={() => {
                                          const next = new Set(pendingSchemaSelection);
                                          if (isSelected) {
                                            next.delete(schemaName);
                                          } else {
                                            next.add(schemaName);
                                          }
                                          setPendingSchemaSelection(next);
                                        }}
                                        className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                                          isSelected
                                            ? "text-primary hover:bg-surface-secondary"
                                            : "text-muted hover:bg-surface-secondary"
                                        }`}
                                      >
                                        <div
                                          className={`w-4 h-4 flex items-center justify-center shrink-0 ${
                                            isSelected ? "text-blue-500" : "text-muted"
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
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="px-3 pt-2 border-t border-default">
                                  <button
                                    onClick={() => {
                                      if (pendingSchemaSelection.size > 0) {
                                        setSelectedSchemas(Array.from(pendingSchemaSelection));
                                      }
                                      setIsSchemaFilterOpen(false);
                                    }}
                                    disabled={pendingSchemaSelection.size === 0}
                                    className={`w-full flex items-center justify-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                                      pendingSchemaSelection.size > 0
                                        ? "bg-blue-500 text-white hover:bg-blue-600"
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
                          connectionId={activeConnectionId!}
                          driver={activeDriver!}
                          schemaVersion={schemaVersion}
                          onLoadSchema={loadSchemaData}
                          onRefreshSchema={refreshSchemaData}
                          onTableClick={(name, schema) => handleTableClick(name, schema)}
                          onTableDoubleClick={(name, schema) => handleOpenTable(name, schema)}
                          onViewClick={handleViewClick}
                          onViewDoubleClick={(name, schema) => handleOpenView(name, schema)}
                          onRoutineDoubleClick={(routine, schema) => handleRoutineDoubleClick(routine, schema)}
                          onTriggerDoubleClick={(trigger, schema) => handleTriggerDoubleClick(trigger, schema)}
                          onContextMenu={handleContextMenu}
                          onAddColumn={(t_name) =>
                            setModifyColumnModal({ isOpen: true, tableName: t_name, column: null })
                          }
                          onEditColumn={(t_name, c) =>
                            setModifyColumnModal({ isOpen: true, tableName: t_name, column: c })
                          }
                          onAddIndex={(t_name) =>
                            setCreateIndexModal({ isOpen: true, tableName: t_name })
                          }
                          onDropIndex={async (t_name, name) => {
                            if (
                              await ask(
                                t("sidebar.deleteIndexConfirm", { name }),
                                { title: t("sidebar.deleteIndex"), kind: "warning" },
                              )
                            ) {
                              try {
                                await invoke("drop_index_action", {
                                  connectionId: activeConnectionId,
                                  table: t_name,
                                  indexName: name,
                                  ...(schemaName ? { schema: schemaName } : {}),
                                });
                                setSchemaVersion((v) => v + 1);
                              } catch (e) {
                                showAlert(t("sidebar.failDeleteIndex") + toErrorMessage(e), { title: t("common.error"), kind: "error" });
                              }
                            }
                          }}
                          onAddForeignKey={(t_name) =>
                            setCreateForeignKeyModal({ isOpen: true, tableName: t_name })
                          }
                          onDropForeignKey={async (t_name, name) => {
                            if (
                              await ask(
                                t("sidebar.deleteFkConfirm", { name }),
                                { title: t("sidebar.deleteFk"), kind: "warning" },
                              )
                            ) {
                              try {
                                await invoke("drop_foreign_key_action", {
                                  connectionId: activeConnectionId,
                                  table: t_name,
                                  fkName: name,
                                  ...(schemaName ? { schema: schemaName } : {}),
                                });
                                setSchemaVersion((v) => v + 1);
                              } catch (e) {
                                showAlert(toErrorMessage(e), { title: t("common.error"), kind: "error" });
                              }
                            }
                          }}
                          onCreateTable={() => setIsCreateTableModalOpen(true)}
                          onCreateView={() =>
                            setViewEditorModal({ isOpen: true, isNewView: true })
                          }
                          onCreateTrigger={(schema) =>
                            setTriggerEditorModal({ isOpen: true, isNewTrigger: true, schema })
                          }
                          showTriggers={activeCapabilities?.triggers === true}
                        />
                      ))}
                    </>
                  )}
                </div>
              ) : isMultiDatabaseCapable(activeCapabilities) && selectedDatabases.length > 1 ? (
                /* Multi-database MySQL layout */
                <div>
                  {/* Database header: label + manage button */}
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-xs font-semibold uppercase text-muted tracking-wider">
                      {t("sidebar.databases")} ({selectedDatabases.length})
                    </span>
                    <div className="relative">
                      <button
                        onClick={async () => {
                          if (!isDbManagerOpen) {
                            setPendingDbSelection(new Set(selectedDatabases));
                            setIsLoadingAllDbs(true);
                            try {
                              const all = await invoke<string[]>("get_available_databases", { connectionId: activeConnectionId });
                              setAllAvailableDatabases(all);
                            } catch (e) {
                              console.error("Failed to load available databases:", e);
                            } finally {
                              setIsLoadingAllDbs(false);
                            }
                          }
                          setIsDbManagerOpen(!isDbManagerOpen);
                        }}
                        className={`p-1 rounded transition-colors ${
                          selectedDatabases.length < allAvailableDatabases.length && allAvailableDatabases.length > 0
                            ? "text-blue-400 hover:text-blue-300 bg-blue-500/10"
                            : "text-muted hover:text-secondary hover:bg-surface-secondary"
                        }`}
                        title={t("sidebar.manageDatabases")}
                      >
                        <Settings2 size={14} />
                      </button>
                      {isDbManagerOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setIsDbManagerOpen(false)}
                          />
                          <div className="absolute right-0 top-8 bg-elevated border border-default rounded-lg shadow-lg z-40 py-2 min-w-[200px] max-h-[320px] flex flex-col">
                            <div className="flex items-center justify-between px-3 pb-2 border-b border-default">
                              <span className="text-xs font-semibold text-secondary">
                                {t("sidebar.manageDatabases")}
                              </span>
                              <button
                                onClick={() => {
                                  if (pendingDbSelection.size === allAvailableDatabases.length) {
                                    setPendingDbSelection(new Set());
                                  } else {
                                    setPendingDbSelection(new Set(allAvailableDatabases));
                                  }
                                }}
                                className="text-xs text-blue-500 hover:underline"
                              >
                                {pendingDbSelection.size === allAvailableDatabases.length
                                  ? t("sidebar.deselectAll")
                                  : t("sidebar.selectAll")}
                              </button>
                            </div>
                            <div className="overflow-y-auto py-1 flex-1">
                              {isLoadingAllDbs ? (
                                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
                                  <Loader2 size={12} className="animate-spin" />
                                  {t("sidebar.loadingSchema")}
                                </div>
                              ) : allAvailableDatabases.map((dbName) => {
                                const isSelected = pendingDbSelection.has(dbName);
                                return (
                                  <div
                                    key={dbName}
                                    onClick={() => {
                                      const next = new Set(pendingDbSelection);
                                      if (isSelected) {
                                        next.delete(dbName);
                                      } else {
                                        next.add(dbName);
                                      }
                                      setPendingDbSelection(next);
                                    }}
                                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                                      isSelected ? "text-primary hover:bg-surface-secondary" : "text-muted hover:bg-surface-secondary"
                                    }`}
                                  >
                                    <div className={`w-4 h-4 flex items-center justify-center shrink-0 ${isSelected ? "text-blue-500" : "text-muted"}`}>
                                      {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                                    </div>
                                    <span className="text-sm truncate select-none">{dbName}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="px-3 pt-2 border-t border-default">
                              <button
                                onClick={() => {
                                  if (pendingDbSelection.size > 0) {
                                    setSelectedDatabases(Array.from(pendingDbSelection));
                                  }
                                  setIsDbManagerOpen(false);
                                }}
                                disabled={pendingDbSelection.size === 0}
                                className={`w-full flex items-center justify-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                                  pendingDbSelection.size > 0
                                    ? "bg-blue-500 text-white hover:bg-blue-600"
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

                  {/* Database filter input */}
                  <div className="px-3 pb-1.5">
                    <div className="relative flex items-center">
                      <Search size={11} className="absolute left-2 text-muted pointer-events-none" />
                      <input
                        type="text"
                        value={dbFilter}
                        onChange={(e) => setDbFilter(e.target.value)}
                        placeholder={t("sidebar.filterDatabases")}
                        className="w-full bg-surface-secondary text-xs text-secondary placeholder:text-muted rounded pl-6 pr-6 py-1 border border-default focus:outline-none focus:border-blue-500/50"
                      />
                      {dbFilter && (
                        <button
                          onClick={() => setDbFilter("")}
                          className="absolute right-1.5 text-muted hover:text-primary"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {(dbFilter
                    ? selectedDatabases.filter((db) => db.toLowerCase().includes(dbFilter.toLowerCase()))
                    : selectedDatabases
                  ).map((dbName) => (
                    <SidebarDatabaseItem
                      key={dbName}
                      databaseName={dbName}
                      databaseData={databaseDataMap[dbName]}
                      activeTable={activeTable}
                      activeSchema={activeSchema}
                      connectionId={activeConnectionId!}
                      driver={activeDriver!}
                      schemaVersion={schemaVersion}
                      onLoadDatabase={loadDatabaseData}
                      onRefreshDatabase={refreshDatabaseData}
                      onTableClick={(name, db) => handleTableClick(name, db)}
                      onTableDoubleClick={(name, db) => handleOpenDatabaseTable(name, db)}
                      onViewClick={handleViewClick}
                      onViewDoubleClick={(name, db) => handleOpenDatabaseView(name, db)}
                      onRoutineDoubleClick={(routine, db) => handleRoutineDoubleClick(routine, db)}
                      onTriggerDoubleClick={(trigger, db) => handleTriggerDoubleClick(trigger, db)}
                      onContextMenu={handleContextMenu}
                      onAddColumn={(t_name) =>
                        setModifyColumnModal({ isOpen: true, tableName: t_name, column: null })
                      }
                      onEditColumn={(t_name, c) =>
                        setModifyColumnModal({ isOpen: true, tableName: t_name, column: c })
                      }
                      onAddIndex={(t_name) =>
                        setCreateIndexModal({ isOpen: true, tableName: t_name })
                      }
                      onDropIndex={async (t_name, name) => {
                        if (
                          await ask(
                            t("sidebar.deleteIndexConfirm", { name }),
                            { title: t("sidebar.deleteIndex"), kind: "warning" },
                          )
                        ) {
                          try {
                            await invoke("drop_index_action", {
                              connectionId: activeConnectionId,
                              table: t_name,
                              indexName: name,
                              schema: dbName,
                            });
                            setSchemaVersion((v) => v + 1);
                          } catch (e) {
                            showAlert(t("sidebar.failDeleteIndex") + toErrorMessage(e), { title: t("common.error"), kind: "error" });
                          }
                        }
                      }}
                      onAddForeignKey={(t_name) =>
                        setCreateForeignKeyModal({ isOpen: true, tableName: t_name })
                      }
                      onDropForeignKey={async (t_name, name) => {
                        if (
                          await ask(
                            t("sidebar.deleteFkConfirm", { name }),
                            { title: t("sidebar.deleteFk"), kind: "warning" },
                          )
                        ) {
                          try {
                            await invoke("drop_foreign_key_action", {
                              connectionId: activeConnectionId,
                              table: t_name,
                              fkName: name,
                              schema: dbName,
                            });
                            setSchemaVersion((v) => v + 1);
                          } catch (e) {
                            showAlert(toErrorMessage(e), { title: t("common.error"), kind: "error" });
                          }
                        }
                      }}
                      capabilities={activeCapabilities}
                      onCreateTable={() => setIsCreateTableModalOpen(true)}
                      onCreateView={() =>
                        setViewEditorModal({ isOpen: true, isNewView: true })
                      }
                      onCreateTrigger={(schema) =>
                        setTriggerEditorModal({ isOpen: true, isNewTrigger: true, schema })
                      }
                      onDump={activeCapabilities?.no_connection_required !== true ? (db) => setDumpModal({ database: db }) : undefined}
                      onImport={activeCapabilities?.no_connection_required !== true ? (db) => handleImportDatabase(db) : undefined}
                      onViewDiagram={activeCapabilities?.no_connection_required !== true ? async (db) => {
                        try {
                          await invoke("open_er_diagram_window", {
                            connectionId: activeConnectionId || "",
                            connectionName: activeConnectionName || "Unknown",
                            databaseName: db,
                          });
                        } catch (e) {
                          console.error("Failed to open ER Diagram window:", e);
                        }
                      } : undefined}
                    />
                  ))}
                </div>
              ) : (
                <>
                  {/* MySQL/SQLite: Flat layout */}
                  {(() => {
                    const dbLabel = isMultiDatabaseCapable(activeCapabilities) && selectedDatabases.length === 1
                      ? selectedDatabases[0]
                      : activeDatabaseName;
                    return dbLabel ? (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-default">
                        <Database size={14} className="text-blue-400 shrink-0" />
                        <span className="text-sm font-medium text-secondary truncate">
                          {dbLabel}
                        </span>
                      </div>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between px-3 py-1">
                    <span className="text-[10px] text-muted opacity-80 uppercase tracking-wider">
                      {t("sidebar.objectSummary")}
                    </span>
                    <span className="text-[10px] text-muted opacity-60">
                      {formatObjectCount(tables.length, views.length, routines.length, triggers.length)}
                    </span>
                  </div>

                  {/* Tables */}
                  <Accordion
                    title={`${t("sidebar.tables")} (${tables.length})`}
                    isOpen={tablesOpen}
                    onToggle={() => setTablesOpen(!tablesOpen)}
                    actions={
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (refreshTables) refreshTables();
                          }}
                          className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                          title={t("sidebar.refreshTables") || "Refresh Tables"}
                        >
                          <RefreshCw size={14} />
                        </button>
                        {supportsManageTables(activeCapabilities) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsCreateTableModalOpen(true);
                          }}
                          className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                          title="Create New Table"
                        >
                          <Plus size={14} />
                        </button>
                        )}
                      </div>
                    }
                  >
                    {tables.length > 0 && (
                      <div className="px-2 py-1">
                        <div className="relative flex items-center">
                          <Search size={11} className="absolute left-2 text-muted pointer-events-none" />
                          <input
                            type="text"
                            value={tableFilter}
                            onChange={(e) => setTableFilter(e.target.value)}
                            placeholder={t("sidebar.filterTables")}
                            className="w-full bg-surface-secondary text-xs text-secondary placeholder:text-muted rounded pl-6 pr-6 py-1 border border-default focus:outline-none focus:border-blue-500/50"
                          />
                          {tableFilter && (
                            <button
                              onClick={() => setTableFilter("")}
                              className="absolute right-1.5 text-muted hover:text-primary"
                            >
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {(() => {
                      const filtered = tableFilter
                        ? tables.filter((tbl) => tbl.name.toLowerCase().includes(tableFilter.toLowerCase()))
                        : tables;
                      return filtered.length === 0 ? (
                        <div className="text-center p-2 text-xs text-muted italic">
                          {tableFilter ? t("sidebar.noTablesMatch") : t("sidebar.noTables")}
                        </div>
                      ) : (
                        <div>
                          {filtered.map((table) => (
                            <SidebarTableItem
                              key={table.name}
                              table={table}
                              activeTable={activeTable}
                              onTableClick={handleTableClick}
                              onTableDoubleClick={handleOpenTable}
                              onContextMenu={handleContextMenu}
                              connectionId={activeConnectionId!}
                              driver={activeDriver!}
                              canManage={supportsManageTables(activeCapabilities)}
                              onAddColumn={(t_name) =>
                                setModifyColumnModal({ isOpen: true, tableName: t_name, column: null })
                              }
                              onEditColumn={(t_name, c) =>
                                setModifyColumnModal({ isOpen: true, tableName: t_name, column: c })
                              }
                              onAddIndex={(t_name) =>
                                setCreateIndexModal({ isOpen: true, tableName: t_name })
                              }
                              onDropIndex={async (t_name, name) => {
                                if (
                                  await ask(
                                    t("sidebar.deleteIndexConfirm", { name }),
                                    { title: t("sidebar.deleteIndex"), kind: "warning" },
                                  )
                                ) {
                                  try {
                                    await invoke("drop_index_action", {
                                      connectionId: activeConnectionId,
                                      table: t_name,
                                      indexName: name,
                                    });
                                    setSchemaVersion((v) => v + 1);
                                  } catch (e) {
                                    showAlert(t("sidebar.failDeleteIndex") + toErrorMessage(e), { title: t("common.error"), kind: "error" });
                                  }
                                }
                              }}
                              onAddForeignKey={(t_name) =>
                                setCreateForeignKeyModal({ isOpen: true, tableName: t_name })
                              }
                              onDropForeignKey={async (t_name, name) => {
                                if (
                                  await ask(
                                    t("sidebar.deleteFkConfirm", { name }),
                                    { title: t("sidebar.deleteFk"), kind: "warning" },
                                  )
                                ) {
                                  try {
                                    await invoke("drop_foreign_key_action", {
                                      connectionId: activeConnectionId,
                                      table: t_name,
                                      fkName: name,
                                    });
                                    setSchemaVersion((v) => v + 1);
                                  } catch (e) {
                                    showAlert(toErrorMessage(e), { title: t("common.error"), kind: "error" });
                                  }
                                }
                              }}
                              schemaVersion={schemaVersion}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </Accordion>

                  {/* Views */}
                  {activeCapabilities?.views !== false && (
                  <Accordion
                    title={`${t("sidebar.views")} (${views.length})`}
                    isOpen={viewsOpen}
                    onToggle={() => setViewsOpen(!viewsOpen)}
                    actions={
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (refreshViews) refreshViews();
                          }}
                          className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                          title={t("sidebar.refreshViews") || "Refresh Views"}
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewEditorModal({ isOpen: true, isNewView: true });
                          }}
                          className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                          title={t("sidebar.createView") || "Create New View"}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    }
                  >
                    {views.length === 0 ? (
                      <div className="text-center p-2 text-xs text-muted italic">
                        {t("sidebar.noViews")}
                      </div>
                    ) : (
                      <div>
                        {views.map((view) => (
                          <SidebarViewItem
                            key={view.name}
                            view={view}
                            activeView={activeView}
                            onViewClick={handleViewClick}
                            onViewDoubleClick={handleOpenView}
                            onContextMenu={handleContextMenu}
                            connectionId={activeConnectionId!}
                            driver={activeDriver!}
                          />
                        ))}
                      </div>
                    )}
                  </Accordion>
                  )}

                  {/* Triggers (flat layout) */}
                  {activeCapabilities?.triggers === true && (
                    <Accordion
                      title={`${t("sidebar.triggers")} (${triggers.length})`}
                      isOpen={triggersOpenFlat}
                      onToggle={() => setTriggersOpenFlat(!triggersOpenFlat)}
                      actions={
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (refreshTriggers) refreshTriggers();
                            }}
                            className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                            title={t("sidebar.refreshTriggers") || "Refresh Triggers"}
                          >
                            <RefreshCw size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setTriggerEditorModal({ isOpen: true, isNewTrigger: true });
                            }}
                            className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                            title={t("sidebar.createTrigger") || "Create New Trigger"}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      }
                    >
                      {triggers.length > 0 && (
                        <div className="px-2 py-1">
                          <div className="relative flex items-center">
                            <Search size={11} className="absolute left-2 text-muted pointer-events-none" />
                            <input
                              type="text"
                              value={triggerFilterFlat}
                              onChange={(e) => setTriggerFilterFlat(e.target.value)}
                              placeholder={t("sidebar.filterTriggers")}
                              className="w-full bg-surface-secondary text-xs text-secondary placeholder:text-muted rounded pl-6 pr-6 py-1 border border-default focus:outline-none focus:border-blue-500/50"
                              onClick={(e) => e.stopPropagation()}
                            />
                            {triggerFilterFlat && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setTriggerFilterFlat(""); }}
                                className="absolute right-1.5 text-muted hover:text-primary"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {(() => {
                        const filtered = triggerFilterFlat
                          ? triggers.filter((tr) => tr.name.toLowerCase().includes(triggerFilterFlat.toLowerCase()))
                          : triggers;
                        return filtered.length === 0 ? (
                          <div className="text-center p-2 text-xs text-muted italic">
                            {triggerFilterFlat ? t("sidebar.noTriggersMatch") : t("sidebar.noTriggers")}
                          </div>
                        ) : (
                          <div>
                            {filtered.map((trigger) => (
                              <SidebarTriggerItem
                                key={trigger.name}
                                trigger={trigger}
                                connectionId={activeConnectionId!}
                                onContextMenu={handleContextMenu}
                                onDoubleClick={handleTriggerDoubleClick}
                              />
                            ))}
                          </div>
                        );
                      })()}
                    </Accordion>
                  )}

                  {/* Routines */}
                  {activeCapabilities?.routines === true && (
                    <Accordion
                      title={`${t("sidebar.routines")} (${routines.length})`}
                      isOpen={routinesOpen}
                      onToggle={() => setRoutinesOpen(!routinesOpen)}
                      actions={
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (refreshRoutines) refreshRoutines();
                            }}
                            className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                            title={t("sidebar.refreshRoutines") || "Refresh Routines"}
                          >
                            <RefreshCw size={14} />
                          </button>
                        </div>
                      }
                    >
                      {routines.length === 0 ? (
                        <div className="text-center p-2 text-xs text-muted italic">
                          {t("sidebar.noRoutines")}
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          {/* Functions */}
                          {groupedRoutines.functions.length > 0 && (
                            <div className="mb-2">
                              <button
                                onClick={() => setFunctionsOpen(!functionsOpen)}
                                className="flex items-center gap-1 px-2 py-1 w-full text-left text-xs font-semibold text-muted uppercase tracking-wider hover:text-secondary transition-colors"
                              >
                                {functionsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                <span>{t("sidebar.functions")}</span>
                                <span className="ml-auto text-[10px] opacity-50">{groupedRoutines.functions.length}</span>
                              </button>
                              {functionsOpen && groupedRoutines.functions.map((routine) => (
                                <SidebarRoutineItem
                                  key={routine.name}
                                  routine={routine}
                                  connectionId={activeConnectionId!}
                                  onContextMenu={handleContextMenu}
                                  onDoubleClick={handleRoutineDoubleClick}
                                />
                              ))}
                            </div>
                          )}

                          {/* Procedures */}
                          {groupedRoutines.procedures.length > 0 && (
                            <div>
                              <button
                                onClick={() => setProceduresOpen(!proceduresOpen)}
                                className="flex items-center gap-1 px-2 py-1 w-full text-left text-xs font-semibold text-muted uppercase tracking-wider hover:text-secondary transition-colors"
                              >
                                {proceduresOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                <span>{t("sidebar.procedures")}</span>
                                <span className="ml-auto text-[10px] opacity-50">{groupedRoutines.procedures.length}</span>
                              </button>
                              {proceduresOpen && groupedRoutines.procedures.map((routine) => (
                                <SidebarRoutineItem
                                  key={routine.name}
                                  routine={routine}
                                  connectionId={activeConnectionId!}
                                  onContextMenu={handleContextMenu}
                                  onDoubleClick={handleRoutineDoubleClick}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </Accordion>
                  )}
                </>
              )}
            </>
            )
          )}
        </div>
      </aside>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          boundaryRight={64 + sidebarWidth}
          onClose={() => setContextMenu(null)}
          items={
            contextMenu.type === "table"
              ? (() => {
                  const ctxSchema = contextMenu.data && "schema" in contextMenu.data ? contextMenu.data.schema : undefined;
                  return [
                    {
                      label: t("sidebar.showData"),
                      icon: PlaySquare,
                      action: () => {
                        const quotedTable = quoteTableRef(contextMenu.id, activeDriver, ctxSchema);
                        runQuery(`SELECT * FROM ${quotedTable}`, undefined, contextMenu.id, false, ctxSchema);
                      },
                    },
                    {
                      label: t("sidebar.newConsole"),
                      icon: FileCode,
                      action: () => {
                        const spec = newConsoleForTable(contextMenu.id, activeDriver, ctxSchema);
                        runQuery(spec.sql, spec.title, undefined, true, spec.schema);
                      },
                    },
                    {
                      label: t("sidebar.countRows"),
                      icon: Hash,
                      action: () => {
                        const quotedTable = quoteTableRef(contextMenu.id, activeDriver, ctxSchema);
                        runQuery(`SELECT COUNT(*) as count FROM ${quotedTable}`, undefined, undefined, false, ctxSchema);
                      },
                    },
                    {
                      label: t("sidebar.viewSchema"),
                      icon: FileText,
                      action: () => setSchemaModal({ tableName: contextMenu.id, schema: ctxSchema }),
                    },
                    activeCapabilities?.no_connection_required !== true ? {
                      label: t("sidebar.viewERDiagram"),
                      icon: Network,
                      action: async () => {
                        try {
                          await invoke("open_er_diagram_window", {
                            connectionId: activeConnectionId || "",
                            connectionName: activeConnectionName || "Unknown",
                            databaseName: activeDatabaseName || "Unknown",
                            focusTable: contextMenu.id,
                            ...(ctxSchema ? { schema: ctxSchema } : {}),
                          });
                        } catch (e) {
                          console.error("Failed to open ER Diagram window:", e);
                        }
                      },
                    } : null,
                    supportsManageTables(activeCapabilities) ? {
                      label: t("sidebar.generateSQL"),
                      icon: FileCode,
                      action: () => setGenerateSQLModal(contextMenu.id),
                    } : null,
                    supportsManageTables(activeCapabilities) ? {
                      label: t("clipboardImport.contextMenuLabel"),
                      icon: Clipboard,
                      action: () => setIsClipboardImportOpen(true),
                    } : null,
                    {
                      label: t("sidebar.copyName"),
                      icon: Copy,
                      action: () => navigator.clipboard.writeText(contextMenu.id),
                    },
                    supportsManageTables(activeCapabilities) ? {
                      label: t("sidebar.addColumn"),
                      icon: Plus,
                      action: () =>
                        setModifyColumnModal({ isOpen: true, tableName: contextMenu.id, column: null }),
                    } : null,
                    supportsManageTables(activeCapabilities) ? {
                      label: t("sidebar.deleteTable"),
                      icon: Trash2,
                      danger: true,
                      action: async () => {
                        const quotedTable = quoteTableRef(contextMenu.id, activeDriver, ctxSchema);
                        if (
                          await ask(
                            t("sidebar.deleteTableConfirm", { table: contextMenu.id }),
                            { title: t("sidebar.deleteTable"), kind: "warning" },
                          )
                        ) {
                          try {
                            await invoke("execute_query", {
                              connectionId: activeConnectionId,
                              query: `DROP TABLE ${quotedTable}`,
                              ...(ctxSchema ? { schema: ctxSchema } : {}),
                            });
                            if (refreshTables) refreshTables();
                          } catch (e) {
                            console.error(e);
                            showAlert(t("sidebar.failDeleteTable") + String(e), { kind: "error" });
                          }
                        }
                      },
                    } : null,
                  ].filter(Boolean) as ContextMenuItem[];
                })()
              : contextMenu.type === "index"
                ? [
                    {
                      label: t("sidebar.copyName"),
                      icon: Copy,
                      action: () => navigator.clipboard.writeText(contextMenu.id),
                    },
                    supportsManageTables(activeCapabilities) ? {
                      label: t("sidebar.deleteIndex"),
                      icon: Trash2,
                      danger: true,
                      action: async () => {
                        if (contextMenu.data && "tableName" in contextMenu.data) {
                          const t_name = contextMenu.data.tableName;
                          const ctxSchema = "schema" in contextMenu.data ? contextMenu.data.schema : undefined;
                          if (
                            await ask(
                              t("sidebar.deleteIndexConfirm", { name: contextMenu.id }),
                              { title: t("sidebar.deleteIndex"), kind: "warning" },
                            )
                          ) {
                            try {
                              await invoke("drop_index_action", {
                                connectionId: activeConnectionId,
                                table: t_name,
                                indexName: contextMenu.id,
                                ...(ctxSchema ? { schema: ctxSchema } : {}),
                              });
                              setSchemaVersion((v) => v + 1);
                            } catch (e) {
                              showAlert(
                                t("sidebar.failDeleteIndex") + String(e),
                                { title: t("common.error"), kind: "error" },
                              );
                            }
                          }
                        }
                      },
                    } : null,
                  ].filter(Boolean) as ContextMenuItem[]
                : contextMenu.type === "foreign_key"
                  ? [
                      {
                        label: t("sidebar.copyName"),
                        icon: Copy,
                        action: () => navigator.clipboard.writeText(contextMenu.id),
                      },
                      supportsManageTables(activeCapabilities) ? {
                        label: t("sidebar.deleteFk"),
                        icon: Trash2,
                        danger: true,
                        action: async () => {
                          if (contextMenu.data && "tableName" in contextMenu.data) {
                            const t_name = contextMenu.data.tableName;
                            const ctxSchema = "schema" in contextMenu.data ? contextMenu.data.schema : undefined;
                            if (
                              await ask(
                                t("sidebar.deleteFkConfirm", { name: contextMenu.id }),
                                { title: t("sidebar.deleteFk"), kind: "warning" },
                              )
                            ) {
                              try {
                                await invoke("drop_foreign_key_action", {
                                  connectionId: activeConnectionId,
                                  table: t_name,
                                  fkName: contextMenu.id,
                                  ...(ctxSchema ? { schema: ctxSchema } : {}),
                                });
                                setSchemaVersion((v) => v + 1);
                              } catch (e) {
                                showAlert(String(e), { kind: "error" });
                              }
                            }
                          }
                        },
                      } : null,
                    ].filter(Boolean) as ContextMenuItem[]
                  : contextMenu.type === "folder_indexes"
                    ? supportsManageTables(activeCapabilities)
                      ? [
                          {
                            label: t("sidebar.addIndex"),
                            icon: Plus,
                            action: () => {
                              if (contextMenu.data && "tableName" in contextMenu.data) {
                                setCreateIndexModal({ isOpen: true, tableName: contextMenu.data.tableName });
                              }
                            },
                          },
                        ]
                      : []
                    : contextMenu.type === "folder_fks"
                      ? supportsManageTables(activeCapabilities)
                        ? [
                            {
                              label: t("sidebar.addFk"),
                              icon: Plus,
                              action: () => {
                                if (contextMenu.data && "tableName" in contextMenu.data) {
                                  setCreateForeignKeyModal({ isOpen: true, tableName: contextMenu.data.tableName });
                                }
                              },
                            },
                          ]
                        : []
                      : contextMenu.type === "view"
                        ? (() => {
                            const viewCtxSchema = contextMenu.data && "schema" in contextMenu.data ? contextMenu.data.schema : undefined;
                            return [
                              {
                                label: t("sidebar.showData"),
                                icon: PlaySquare,
                                action: () => {
                                  const quotedView = quoteTableRef(contextMenu.id, activeDriver, viewCtxSchema);
                                  runQuery(`SELECT * FROM ${quotedView}`, undefined, contextMenu.id);
                                },
                              },
                              {
                                label: t("sidebar.countRows"),
                                icon: Hash,
                                action: () => {
                                  const quotedView = quoteTableRef(contextMenu.id, activeDriver, viewCtxSchema);
                                  runQuery(`SELECT COUNT(*) as count FROM ${quotedView}`);
                                },
                              },
                              {
                                label: t("sidebar.editView"),
                                icon: Edit,
                                action: () => {
                                  setViewEditorModal({ isOpen: true, viewName: contextMenu.id, isNewView: false });
                                },
                              },
                              {
                                label: t("sidebar.copyName"),
                                icon: Copy,
                                action: () => navigator.clipboard.writeText(contextMenu.id),
                              },
                              {
                                label: t("sidebar.dropView"),
                                icon: Trash2,
                                danger: true,
                                action: async () => {
                                  if (
                                    await ask(
                                      t("sidebar.dropViewConfirm", { view: contextMenu.id }),
                                      { title: t("sidebar.dropView"), kind: "warning" },
                                    )
                                  ) {
                                    try {
                                      await invoke("drop_view", {
                                        connectionId: activeConnectionId,
                                        viewName: contextMenu.id,
                                        ...(activeSchema ? { schema: activeSchema } : {}),
                                      });
                                      if (refreshViews) refreshViews();
                                    } catch (e) {
                                      console.error(e);
                                      showAlert(t("sidebar.failDropView") + String(e), { kind: "error" });
                                    }
                                  }
                                },
                              },
                            ];
                          })()
                        : contextMenu.type === "routine"
                          ? [
                              {
                                label: t("sidebar.viewDefinition"),
                                icon: FileText,
                                action: async () => {
                                  try {
                                    const routineType =
                                      contextMenu.data && 'routine_type' in contextMenu.data
                                        ? (contextMenu.data).routine_type
                                        : "PROCEDURE";
                                    const definition = await invoke<string>("get_routine_definition", {
                                      connectionId: activeConnectionId,
                                      routineName: contextMenu.id,
                                      routineType: routineType,
                                      ...(activeSchema ? { schema: activeSchema } : {}),
                                    });
                                    runQuery(definition, `${contextMenu.id} Definition`, undefined, true);
                                  } catch (e) {
                                    console.error(e);
                                    showAlert(
                                      t("sidebar.failGetRoutineDefinition") + String(e),
                                      { kind: "error" }
                                    );
                                  }
                                },
                              },
                              {
                                label: t("sidebar.copyName"),
                                icon: Copy,
                                action: () => navigator.clipboard.writeText(contextMenu.id),
                              },
                            ]
                          : contextMenu.type === "trigger"
                            ? (() => {
                                const triggerData = contextMenu.data && 'table_name' in contextMenu.data
                                  ? contextMenu.data as unknown as TriggerInfo & { schema?: string }
                                  : null;
                                const triggerSchema = triggerData?.schema ?? activeSchema ?? undefined;
                                return [
                                  {
                                    label: t("sidebar.viewTriggerDefinition"),
                                    icon: FileText,
                                    action: async () => {
                                      try {
                                        const definition = await invoke<string>("get_trigger_definition", {
                                          connectionId: activeConnectionId,
                                          triggerName: contextMenu.id,
                                          tableName: triggerData?.table_name ?? "",
                                          ...(triggerSchema ? { schema: triggerSchema } : {}),
                                        });
                                        runQuery(definition, `${contextMenu.id} Definition`, undefined, true, triggerSchema, true);
                                      } catch (e) {
                                        console.error(e);
                                        showAlert(
                                          t("sidebar.failGetTriggerDefinition") + String(e),
                                          { kind: "error" }
                                        );
                                      }
                                    },
                                  },
                                  {
                                    label: t("sidebar.editTrigger"),
                                    icon: Edit,
                                    action: () => {
                                      setTriggerEditorModal({
                                        isOpen: true,
                                        triggerName: contextMenu.id,
                                        tableName: triggerData?.table_name,
                                        schema: triggerSchema,
                                        isNewTrigger: false,
                                      });
                                    },
                                  },
                                  {
                                    label: t("sidebar.copyName"),
                                    icon: Copy,
                                    action: () => navigator.clipboard.writeText(contextMenu.id),
                                  },
                                  {
                                    label: t("sidebar.dropTrigger"),
                                    icon: Trash2,
                                    danger: true,
                                    action: async () => {
                                      if (
                                        await ask(
                                          t("sidebar.dropTriggerConfirm", { trigger: contextMenu.id }),
                                          { title: t("sidebar.dropTrigger"), kind: "warning" },
                                        )
                                      ) {
                                        try {
                                          await invoke("drop_trigger", {
                                            connectionId: activeConnectionId,
                                            triggerName: contextMenu.id,
                                            tableName: triggerData?.table_name ?? "",
                                            ...(triggerSchema ? { schema: triggerSchema } : {}),
                                          });
                                          if (refreshTriggers) refreshTriggers();
                                        } catch (e) {
                                          console.error(e);
                                          showAlert(t("sidebar.failDropTrigger") + String(e), { kind: "error" });
                                        }
                                      }
                                    },
                                  },
                                ];
                              })()
                          : contextMenu.type === "database"
                            ? [
                                {
                                  label: t("sidebar.newConsole"),
                                  icon: FileCode,
                                  action: () => {
                                    const spec = newConsoleForDatabase(contextMenu.id);
                                    runQuery(spec.sql, spec.title, undefined, true, spec.schema);
                                  },
                                },
                                {
                                  label: t("dump.importDatabase"),
                                  icon: Upload,
                                  action: () => handleImportDatabase(contextMenu.id),
                                },
                                {
                                  label: t("dump.dumpDatabase"),
                                  icon: Download,
                                  action: () => setDumpModal({ database: contextMenu.id }),
                                },
                                {
                                  label: t("sidebar.viewERDiagram"),
                                  icon: Network,
                                  action: async () => {
                                    try {
                                      await invoke("open_er_diagram_window", {
                                        connectionId: activeConnectionId || "",
                                        connectionName: activeConnectionName || "Unknown",
                                        databaseName: contextMenu.id,
                                      });
                                    } catch (e) {
                                      console.error("Failed to open ER Diagram window:", e);
                                    }
                                  },
                                },
                                {
                                  label: t("sidebar.refreshTables"),
                                  icon: RefreshCw,
                                  action: () => refreshDatabaseData(contextMenu.id),
                                },
                              ]
                          : contextMenu.type === "history"
                            ? (() => {
                                const historyEntry = contextMenu.data as unknown as QueryHistoryEntry;
                                return [
                                  {
                                    label: t("sidebar.copyQuery"),
                                    icon: Copy,
                                    action: () => navigator.clipboard.writeText(historyEntry.sql),
                                  },
                                  {
                                    label: t("sidebar.insertToEditor"),
                                    icon: FileInput,
                                    action: () => runQuery(historyEntry.sql, undefined, undefined, true, historyEntry.database ?? undefined),
                                  },
                                  {
                                    label: t("sidebar.runQuery"),
                                    icon: Play,
                                    action: () => runQuery(historyEntry.sql, undefined, undefined, false, historyEntry.database ?? undefined),
                                  },
                                  {
                                    label: t("sidebar.openInNewTab"),
                                    icon: Plus,
                                    action: () => runQuery(historyEntry.sql, undefined, undefined, true, historyEntry.database ?? undefined),
                                  },
                                  {
                                    label: t("sidebar.addToFavorites"),
                                    icon: Star,
                                    action: () => {
                                      setQueryModal({ isOpen: true });
                                      // Pre-fill the modal with history SQL via a small timeout
                                      // so the modal mounts first, then we set the initial values
                                      setHistoryToFavoriteSQL(historyEntry.sql);
                                      setHistoryToFavoriteDB(historyEntry.database ?? null);
                                    },
                                  },
                                  { separator: true },
                                  {
                                    label: t("sidebar.delete"),
                                    icon: Trash2,
                                    danger: true,
                                    action: () => setHistoryDeleteConfirm(historyEntry.id),
                                  },
                                  {
                                    label: t("sidebar.clearAllHistory"),
                                    icon: Trash2,
                                    danger: true,
                                    action: () => setHistoryClearConfirm(true),
                                  },
                                ] as ContextMenuItem[];
                              })()
                          : [
                              // Saved Query Actions (Default fallback)
                              {
                                label: t("sidebar.execute"),
                                icon: Play,
                                action: () => {
                                  if (contextMenu.data && "sql" in contextMenu.data) {
                                    const sq = contextMenu.data as SavedQuery;
                                    runQuery(sq.sql, sq.name, undefined, false, sq.database ?? undefined);
                                  }
                                },
                              },
                              {
                                label: t("sidebar.edit"),
                                icon: Edit,
                                action: () => {
                                  if (contextMenu.data && "sql" in contextMenu.data) {
                                    setQueryModal({ isOpen: true, query: contextMenu.data as SavedQuery });
                                  }
                                },
                              },
                              {
                                label: t("sidebar.delete"),
                                icon: Trash2,
                                danger: true,
                                action: () => {
                                  setFavoriteDeleteConfirm(contextMenu.id);
                                },
                              },
                            ]
          }
        />
      )}

      {schemaModal && (
        <SchemaModal
          isOpen={true}
          tableName={schemaModal.tableName}
          schema={schemaModal.schema}
          onClose={() => setSchemaModal(null)}
        />
      )}

      {isCreateTableModalOpen && (
        <CreateTableModal
          isOpen={isCreateTableModalOpen}
          onClose={() => setIsCreateTableModalOpen(false)}
          onSuccess={() => {
            if (refreshTables) refreshTables();
            setSchemaVersion((v) => v + 1);
          }}
        />
      )}

      {isClipboardImportOpen && (
        <ClipboardImportModal
          isOpen={isClipboardImportOpen}
          onClose={() => setIsClipboardImportOpen(false)}
          onSuccess={() => {
            if (refreshTables) refreshTables();
            setSchemaVersion((v) => v + 1);
            setIsClipboardImportOpen(false);
          }}
        />
      )}

      {queryModal.isOpen && (
        <QueryModal
          isOpen={queryModal.isOpen}
          onClose={() => {
            setQueryModal({ isOpen: false });
            setHistoryToFavoriteSQL(null);
            setHistoryToFavoriteDB(null);
          }}
          title={queryModal.query ? "Edit Query" : "Save Query"}
          initialName={queryModal.query?.name ?? ""}
          initialSql={queryModal.query?.sql ?? historyToFavoriteSQL ?? ""}
          initialDatabase={queryModal.query?.database ?? historyToFavoriteDB}
          databases={isMultiDb ? selectedDatabases : undefined}
          onSave={async (name: string, sql: string, database?: string | null) => {
            if (queryModal.query) {
              await updateQuery(queryModal.query.id, name, sql, database);
            } else if (historyToFavoriteSQL) {
              await saveQuery(name, sql, database ?? historyToFavoriteDB);
            }
            setHistoryToFavoriteSQL(null);
            setHistoryToFavoriteDB(null);
          }}
        />
      )}

      {modifyColumnModal.isOpen && activeConnectionId && (
        <ModifyColumnModal
          isOpen={modifyColumnModal.isOpen}
          onClose={() => setModifyColumnModal({ ...modifyColumnModal, isOpen: false })}
          onSuccess={() => setSchemaVersion((v) => v + 1)}
          connectionId={activeConnectionId}
          tableName={modifyColumnModal.tableName}
          driver={activeDriver || "sqlite"}
          column={modifyColumnModal.column}
        />
      )}

      {createIndexModal.isOpen && activeConnectionId && (
        <CreateIndexModal
          isOpen={createIndexModal.isOpen}
          onClose={() => setCreateIndexModal({ ...createIndexModal, isOpen: false })}
          onSuccess={() => setSchemaVersion((v) => v + 1)}
          connectionId={activeConnectionId}
          tableName={createIndexModal.tableName}
          driver={activeDriver || "sqlite"}
        />
      )}

      {createForeignKeyModal.isOpen && activeConnectionId && (
        <CreateForeignKeyModal
          isOpen={createForeignKeyModal.isOpen}
          onClose={() => setCreateForeignKeyModal({ ...createForeignKeyModal, isOpen: false })}
          onSuccess={() => setSchemaVersion((v) => v + 1)}
          connectionId={activeConnectionId}
          tableName={createForeignKeyModal.tableName}
          driver={activeDriver || "sqlite"}
        />
      )}

      {generateSQLModal && (
        <GenerateSQLModal
          isOpen={true}
          tableName={generateSQLModal}
          onClose={() => setGenerateSQLModal(null)}
        />
      )}

      {dumpModal && activeConnectionId && (
        <DumpDatabaseModal
          isOpen={true}
          onClose={() => setDumpModal(null)}
          connectionId={activeConnectionId}
          databaseName={dumpModal.database || activeDatabaseName || "Database"}
          tables={(
            activeCapabilities?.schemas && activeSchema
              ? (schemaDataMap[activeSchema]?.tables ?? [])
              : (databaseDataMap[dumpModal.database]?.tables ?? tables)
          ).map((t) => t.name)}
        />
      )}

      {importModal && activeConnectionId && (
        <ImportDatabaseModal
          isOpen={true}
          onClose={() => setImportModal(null)}
          connectionId={activeConnectionId}
          databaseName={importModal.database || activeDatabaseName || "Database"}
          filePath={importModal.filePath}
          onSuccess={() => {
            if (refreshTables) refreshTables();
          }}
        />
      )}

      {viewEditorModal.isOpen && activeConnectionId && (
        <ViewEditorModal
          isOpen={viewEditorModal.isOpen}
          onClose={() => setViewEditorModal({ isOpen: false })}
          connectionId={activeConnectionId}
          viewName={viewEditorModal.viewName}
          isNewView={viewEditorModal.isNewView}
          onSuccess={() => {
            if (refreshViews) refreshViews();
          }}
        />
      )}

      {triggerEditorModal.isOpen && activeConnectionId && (
        <TriggerEditorModal
          isOpen={triggerEditorModal.isOpen}
          onClose={() => setTriggerEditorModal({ isOpen: false })}
          connectionId={activeConnectionId}
          triggerName={triggerEditorModal.triggerName}
          tableName={triggerEditorModal.tableName}
          schema={triggerEditorModal.schema}
          driver={activeDriver ?? undefined}
          isNewTrigger={triggerEditorModal.isNewTrigger}
          onSuccess={() => {
            if (refreshTriggers) refreshTriggers();
          }}
        />
      )}

      {/* Delete favorite confirmation */}
      <ConfirmModal
        isOpen={favoriteDeleteConfirm !== null}
        onClose={() => setFavoriteDeleteConfirm(null)}
        title={t("sidebar.confirmDeleteTitle")}
        message={t("sidebar.confirmDeleteQuery", { name: queries.find((q) => q.id === favoriteDeleteConfirm)?.name ?? "" })}
        onConfirm={() => {
          if (favoriteDeleteConfirm) {
            deleteQuery(favoriteDeleteConfirm);
          }
          setFavoriteDeleteConfirm(null);
        }}
      />

      {/* Delete single history entry confirmation */}
      <ConfirmModal
        isOpen={historyDeleteConfirm !== null}
        onClose={() => setHistoryDeleteConfirm(null)}
        title={t("sidebar.confirmDeleteTitle")}
        message={t("sidebar.confirmDeleteHistoryEntry")}
        onConfirm={() => {
          if (historyDeleteConfirm) {
            deleteHistoryEntry(historyDeleteConfirm);
          }
          setHistoryDeleteConfirm(null);
        }}
      />

      {/* Clear all history confirmation */}
      <ConfirmModal
        isOpen={historyClearConfirm}
        onClose={() => setHistoryClearConfirm(false)}
        title={t("sidebar.confirmClearHistoryTitle")}
        message={t("sidebar.confirmClearHistory")}
        onConfirm={() => {
          clearHistory();
          setHistoryClearConfirm(false);
        }}
      />
    </>
  );
};
