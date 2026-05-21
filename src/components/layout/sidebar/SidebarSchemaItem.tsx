import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  RefreshCw,
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
import { groupRoutinesByType } from "../../../utils/routines";
import { formatObjectCount } from "../../../utils/schema";

interface SidebarSchemaItemProps {
  schemaName: string;
  schemaData: SchemaData | undefined;
  activeTable: string | null;
  activeSchema: string | null;
  connectionId: string;
  driver: string;
  schemaVersion: number;
  onLoadSchema: (schema: string) => void;
  onRefreshSchema: (schema: string) => void;
  onTableClick: (name: string, schema: string) => void;
  onTableDoubleClick: (name: string, schema: string) => void;
  onViewClick: (name: string) => void;
  onViewDoubleClick: (name: string, schema: string) => void;
  onRoutineDoubleClick: (routine: RoutineInfo, schema: string) => void;
  onTriggerDoubleClick: (trigger: TriggerInfo, schema: string) => void;
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
  showTriggers?: boolean;
}

export const SidebarSchemaItem = ({
  schemaName,
  schemaData,
  activeTable,
  activeSchema,
  connectionId,
  driver,
  schemaVersion,
  onLoadSchema,
  onRefreshSchema,
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
  showTriggers = false,
}: SidebarSchemaItemProps) => {
  const { t } = useTranslation();

  const [isExpanded, setIsExpanded] = useState(
    activeSchema === schemaName,
  );
  const [prevActiveSchema, setPrevActiveSchema] = useState(activeSchema);
  const [tablesOpen, setTablesOpen] = useState(true);
  const [viewsOpen, setViewsOpen] = useState(true);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [functionsOpen, setFunctionsOpen] = useState(true);
  const [proceduresOpen, setProceduresOpen] = useState(true);
  const [tableFilter, setTableFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");

  // Adjust isExpanded during render when activeSchema changes (avoids useEffect)
  if (activeSchema !== prevActiveSchema) {
    setPrevActiveSchema(activeSchema);
    if (activeSchema === schemaName) {
      setIsExpanded(true);
    }
  }

  const tables = schemaData?.tables ?? [];
  const filteredTables = tableFilter
    ? tables.filter((t) => t.name.toLowerCase().includes(tableFilter.toLowerCase()))
    : tables;
  const views = schemaData?.views ?? [];
  const routines = schemaData?.routines ?? [];
  const triggers = schemaData?.triggers ?? [];
  const filteredTriggers = triggerFilter
    ? triggers.filter((tr) => tr.name.toLowerCase().includes(triggerFilter.toLowerCase()))
    : triggers;
  const isLoading = schemaData?.isLoading ?? false;
  const isLoaded = schemaData?.isLoaded ?? false;

  const groupedRoutines = routines.length > 0 ? groupRoutinesByType(routines) : { procedures: [], functions: [] };

  const handleToggle = () => {
    const willExpand = !isExpanded;
    setIsExpanded(willExpand);
    if (willExpand && !isLoaded && !isLoading) {
      onLoadSchema(schemaName);
    }
  };

  const itemCount = isLoaded
    ? formatObjectCount(tables.length, views.length, routines.length, triggers.length)
    : "";

  return (
    <div className="flex flex-col">
      {/* Schema header */}
      <div
        className="flex items-center justify-between px-2 py-1.5 group/schema cursor-pointer hover:bg-surface-secondary transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isExpanded ? (
            <ChevronDown size={14} className="text-muted shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-muted shrink-0" />
          )}
          <Layers
            size={14}
            className={
              activeSchema === schemaName
                ? "text-blue-400 shrink-0"
                : "text-muted group-hover/schema:text-blue-400 shrink-0"
            }
          />
          <span className="text-sm font-medium text-secondary truncate">
            {schemaName}
          </span>
          {isLoaded && (
            <span className="ml-auto text-[10px] text-muted opacity-60 shrink-0">
              {itemCount}
            </span>
          )}
        </div>
        {isExpanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefreshSchema(schemaName);
            }}
            className="p-0.5 rounded hover:bg-surface-secondary text-muted hover:text-primary transition-colors opacity-0 group-hover/schema:opacity-100"
            title={t("sidebar.refreshTables") || "Refresh"}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {/* Schema contents */}
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
                        activeTable={activeSchema === schemaName ? activeTable : null}
                        onTableClick={(name) => onTableClick(name, schemaName)}
                        onTableDoubleClick={(name) => onTableDoubleClick(name, schemaName)}
                        onContextMenu={onContextMenu}
                        connectionId={connectionId}
                        driver={driver}
                        onAddColumn={onAddColumn}
                        onEditColumn={onEditColumn}
                        onAddIndex={onAddIndex}
                        onDropIndex={onDropIndex}
                        onAddForeignKey={onAddForeignKey}
                        onDropForeignKey={onDropForeignKey}
                        schemaVersion={schemaVersion}
                        schema={schemaName}
                      />
                    ))}
                  </div>
                )}
              </Accordion>

              {/* Views */}
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
                        onViewDoubleClick={(name) => onViewDoubleClick(name, schemaName)}
                        onContextMenu={onContextMenu}
                        connectionId={connectionId}
                        driver={driver}
                        schema={schemaName}
                      />
                    ))}
                  </div>
                )}
              </Accordion>

              {/* Triggers */}
              {showTriggers && (
                <Accordion
                  title={`${t("sidebar.triggers")} (${triggers.length})`}
                  isOpen={triggersOpen}
                  onToggle={() => setTriggersOpen(!triggersOpen)}
                  actions={
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateTrigger(schemaName);
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
                          onDoubleClick={(tr) => onTriggerDoubleClick(tr, schemaName)}
                          schema={schemaName}
                        />
                      ))}
                    </div>
                  )}
                </Accordion>
              )}

              {/* Routines */}
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
                            connectionId={connectionId}
                            onContextMenu={onContextMenu}
                            onDoubleClick={(r) => onRoutineDoubleClick(r, schemaName)}
                            schema={schemaName}
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
                            connectionId={connectionId}
                            onContextMenu={onContextMenu}
                            onDoubleClick={(r) => onRoutineDoubleClick(r, schemaName)}
                            schema={schemaName}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Accordion>
            </>
          )}
        </div>
      )}
    </div>
  );
};
