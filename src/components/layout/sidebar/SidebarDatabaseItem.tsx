import React, { useState } from "react";
import { supportsManageTables } from "../../../utils/driverCapabilities";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Database,
  Plus,
  RefreshCw,
  Download,
  Upload,
  Network,
  Search,
  X,
} from "lucide-react";
import { Accordion } from "./Accordion";
import { SidebarTableItem } from "./SidebarTableItem";
import { SidebarViewItem } from "./SidebarViewItem";
import { SidebarRoutineItem } from "./SidebarRoutineItem";
import { SidebarTriggerItem } from "./SidebarTriggerItem";
import type { SchemaData, RoutineInfo, TriggerInfo } from "../../../contexts/DatabaseContext";
import type { TableColumn } from "../../../types/schema";
import type { ContextMenuData } from "../../../types/sidebar";
import type { DriverCapabilities } from "../../../types/plugins";
import { groupRoutinesByType } from "../../../utils/routines";
import { formatObjectCount } from "../../../utils/schema";

interface SidebarDatabaseItemProps {
  databaseName: string;
  databaseData: SchemaData | undefined;
  activeTable: string | null;
  activeSchema: string | null;
  connectionId: string;
  driver: string;
  schemaVersion: number;
  onLoadDatabase: (database: string) => void;
  onRefreshDatabase: (database: string) => void;
  onTableClick: (name: string, database: string) => void;
  onTableDoubleClick: (name: string, database: string) => void;
  onViewClick: (name: string) => void;
  onViewDoubleClick: (name: string, database: string) => void;
  onRoutineDoubleClick: (routine: RoutineInfo, database: string) => void;
  onTriggerDoubleClick: (trigger: TriggerInfo, database: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    type: string,
    id: string,
    label: string,
    data?: ContextMenuData,
  ) => void;
  onAddColumn: (tableName: string) => void;
  onEditColumn: (tableName: string, col: TableColumn) => void;
  onAddIndex: (tableName: string) => void;
  onDropIndex: (tableName: string, indexName: string) => void;
  onAddForeignKey: (tableName: string) => void;
  onDropForeignKey: (tableName: string, fkName: string) => void;
  onCreateTable: () => void;
  onCreateView: () => void;
  onCreateTrigger: (schema: string) => void;
  onDump?: (database: string) => void;
  onImport?: (database: string) => void;
  onViewDiagram?: (database: string) => void;
  capabilities?: DriverCapabilities | null;
}

export const SidebarDatabaseItem = ({
  databaseName,
  databaseData,
  activeTable,
  activeSchema,
  connectionId,
  driver,
  schemaVersion,
  onLoadDatabase,
  onRefreshDatabase,
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
  onViewDiagram,
  capabilities,
}: SidebarDatabaseItemProps) => {
  const { t } = useTranslation();

  const [isExpanded, setIsExpanded] = useState(activeSchema === databaseName);
  const [tablesOpen, setTablesOpen] = useState(true);
  const [viewsOpen, setViewsOpen] = useState(true);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [functionsOpen, setFunctionsOpen] = useState(true);
  const [proceduresOpen, setProceduresOpen] = useState(true);
  const [tableFilter, setTableFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");

  const tables = databaseData?.tables ?? [];
  const filteredTables = tableFilter
    ? tables.filter((t) => t.name.toLowerCase().includes(tableFilter.toLowerCase()))
    : tables;
  const views = databaseData?.views ?? [];
  const routines = databaseData?.routines ?? [];
  const triggers = databaseData?.triggers ?? [];
  const filteredTriggers = triggerFilter
    ? triggers.filter((tr) => tr.name.toLowerCase().includes(triggerFilter.toLowerCase()))
    : triggers;
  const isLoading = databaseData?.isLoading ?? false;
  const isLoaded = databaseData?.isLoaded ?? false;

  const groupedRoutines = routines.length > 0
    ? groupRoutinesByType(routines)
    : { procedures: [], functions: [] };

  const handleToggle = () => {
    const willExpand = !isExpanded;
    setIsExpanded(willExpand);
    if (willExpand && !isLoaded && !isLoading) {
      onLoadDatabase(databaseName);
    }
  };

  const itemCount = isLoaded
    ? formatObjectCount(tables.length, views.length, routines.length, triggers.length)
    : "";

  return (
    <div className="flex flex-col">
      {/* Database header */}
      <div
        className="flex items-center justify-between px-2 py-1.5 group/db cursor-pointer hover:bg-surface-secondary transition-colors"
        onClick={handleToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, "database", databaseName, databaseName);
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isExpanded ? (
            <ChevronDown size={14} className="text-muted shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-muted shrink-0" />
          )}
          <Database
            size={14}
            className={
              activeSchema === databaseName
                ? "text-blue-400 shrink-0"
                : "text-muted group-hover/db:text-blue-400 shrink-0"
            }
          />
          <span className="text-sm font-medium text-secondary truncate">
            {databaseName}
          </span>
          {isLoaded && (
            <span className="ml-1 text-[10px] text-muted opacity-60 shrink-0">
              {itemCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onImport && (
            <button
              onClick={(e) => { e.stopPropagation(); onImport(databaseName); }}
              className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-green-400 transition-colors"
              title={t("dump.importDatabase")}
            >
              <Upload size={13} />
            </button>
          )}
          {onDump && (
            <button
              onClick={(e) => { e.stopPropagation(); onDump(databaseName); }}
              className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-blue-400 transition-colors"
              title={t("dump.dumpDatabase")}
            >
              <Download size={13} />
            </button>
          )}
          {onViewDiagram && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewDiagram(databaseName); }}
              className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-orange-400 transition-colors"
              title={t("sidebar.viewERDiagram")}
            >
              <Network size={13} className="rotate-90" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRefreshDatabase(databaseName); }}
            className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
            title={t("sidebar.refreshTables")}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Database contents */}
      {isExpanded && (
        <div className="ml-3 border-l border-default">
          {isLoading && !isLoaded ? (
            <div className="flex items-center gap-2 p-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" />
              {t("sidebar.loadingSchema")}
            </div>
          ) : (
            <>
              {/* Tables */}
              <Accordion
                title={`${t("sidebar.tables")} (${tables.length})`}
                isOpen={tablesOpen}
                onToggle={() => setTablesOpen(!tablesOpen)}
                actions={
                  supportsManageTables(capabilities) ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateTable();
                      }}
                      className="p-1 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors"
                      title="Create New Table"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  ) : undefined
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
                        onClick={(e) => e.stopPropagation()}
                      />
                      {tableFilter && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setTableFilter(""); }}
                          className="absolute right-1.5 text-muted hover:text-primary"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {filteredTables.length === 0 ? (
                  <div className="text-center p-2 text-xs text-muted italic">
                    {tableFilter ? t("sidebar.noTablesMatch") : t("sidebar.noTables")}
                  </div>
                ) : (
                  <div>
                    {filteredTables.map((table) => (
                      <SidebarTableItem
                        key={table.name}
                        table={table}
                        activeTable={activeSchema === databaseName ? activeTable : null}
                        onTableClick={(name) => onTableClick(name, databaseName)}
                        onTableDoubleClick={(name) => onTableDoubleClick(name, databaseName)}
                        onContextMenu={onContextMenu}
                        connectionId={connectionId}
                        driver={driver}
                        canManage={supportsManageTables(capabilities)}
                        onAddColumn={onAddColumn}
                        onEditColumn={onEditColumn}
                        onAddIndex={onAddIndex}
                        onDropIndex={onDropIndex}
                        onAddForeignKey={onAddForeignKey}
                        onDropForeignKey={onDropForeignKey}
                        schemaVersion={schemaVersion}
                        schema={databaseName}
                      />
                    ))}
                  </div>
                )}
              </Accordion>

              {/* Views */}
              {capabilities?.views !== false && (
              <Accordion
                title={`${t("sidebar.views")} (${views.length})`}
                isOpen={viewsOpen}
                onToggle={() => setViewsOpen(!viewsOpen)}
                actions={
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateView();
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
                        activeView={null}
                        onViewClick={onViewClick}
                        onViewDoubleClick={(name) => onViewDoubleClick(name, databaseName)}
                        onContextMenu={onContextMenu}
                        connectionId={connectionId}
                        driver={driver}
                        schema={databaseName}
                      />
                    ))}
                  </div>
                )}
              </Accordion>
              )}

              {/* Triggers */}
              {capabilities?.triggers === true && (
                <Accordion
                  title={`${t("sidebar.triggers")} (${triggers.length})`}
                  isOpen={triggersOpen}
                  onToggle={() => setTriggersOpen(!triggersOpen)}
                  actions={
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateTrigger(databaseName);
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
                          value={triggerFilter}
                          onChange={(e) => setTriggerFilter(e.target.value)}
                          placeholder={t("sidebar.filterTriggers")}
                          className="w-full bg-surface-secondary text-xs text-secondary placeholder:text-muted rounded pl-6 pr-6 py-1 border border-default focus:outline-none focus:border-blue-500/50"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {triggerFilter && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setTriggerFilter(""); }}
                            className="absolute right-1.5 text-muted hover:text-primary"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {filteredTriggers.length === 0 ? (
                    <div className="text-center p-2 text-xs text-muted italic">
                      {triggerFilter ? t("sidebar.noTriggersMatch") : t("sidebar.noTriggers")}
                    </div>
                  ) : (
                    <div>
                      {filteredTriggers.map((trigger) => (
                        <SidebarTriggerItem
                          key={trigger.name}
                          trigger={trigger}
                          connectionId={connectionId}
                          onContextMenu={onContextMenu}
                          onDoubleClick={(tr) => onTriggerDoubleClick(tr, databaseName)}
                          schema={databaseName}
                        />
                      ))}
                    </div>
                  )}
                </Accordion>
              )}

              {/* Routines */}
              {capabilities?.routines === true && (
              <Accordion
                title={`${t("sidebar.routines")} (${routines.length})`}
                isOpen={routinesOpen}
                onToggle={() => setRoutinesOpen(!routinesOpen)}
              >
                {routines.length === 0 ? (
                  <div className="text-center p-2 text-xs text-muted italic">
                    {t("sidebar.noRoutines")}
                  </div>
                ) : (
                  <div className="flex flex-col">
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
                            connectionId={connectionId}
                            onContextMenu={onContextMenu}
                            onDoubleClick={(r) => onRoutineDoubleClick(r, databaseName)}
                            schema={databaseName}
                          />
                        ))}
                      </div>
                    )}

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
                            connectionId={connectionId}
                            onContextMenu={onContextMenu}
                            onDoubleClick={(r) => onRoutineDoubleClick(r, databaseName)}
                            schema={databaseName}
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
        </div>
      )}
    </div>
  );
};
