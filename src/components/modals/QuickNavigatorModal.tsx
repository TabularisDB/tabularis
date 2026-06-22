import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useLingui } from "@lingui/react/macro";
import { quickNavigatorType } from "../../i18n/registries/quickNavigatorType";
import { Search, X, Table, Eye, Code2, Zap, Database, Play, Copy, Hash, FileText, FileCode } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { useAlert } from "../../hooks/useAlert";
import { quoteTableRef } from "../../utils/identifiers";
import { isMultiDatabaseCapable, getDatabaseList } from "../../utils/database";
import { getNavigatorItems, filterNavigatorItems } from "../../utils/quickNavigator";
import { newConsoleForTable } from "../../utils/newConsole";
import type { RoutineInfo, TriggerInfo } from "../../contexts/DatabaseContext";

interface QuickNavigatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateSql?: (tableName: string) => void;
  onInspect?: (tableName: string, schema?: string) => void;
}

export const QuickNavigatorModal = ({ isOpen, onClose, onGenerateSql, onInspect }: QuickNavigatorModalProps) => {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const listRef = useRef<HTMLDivElement>(null);

  const {
    activeConnectionId,
    activeDriver,
    activeCapabilities,
    tables,
    views,
    routines,
    triggers,
    schemaDataMap,
    databaseDataMap,
    activeSchema,
    setActiveTable,
    schemas,
    loadSchemaData,
    loadDatabaseData,
    connections,
  } = useDatabase();

  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Find the active connection configuration
  const activeConn = useMemo(() => {
    return connections.find((c) => c.id === activeConnectionId);
  }, [connections, activeConnectionId]);

  // Resolve the configured database list for the connection
  const configuredDatabases = useMemo(() => {
    if (!activeConn) return [];
    return getDatabaseList(activeConn.params.database);
  }, [activeConn]);

  // Load metadata for all schemas/databases in the background when the modal is open
  useEffect(() => {
    if (!isOpen || !activeConnectionId) return;

    const loadAll = async () => {
      const isMultiDb = isMultiDatabaseCapable(activeCapabilities);
      const hasSchemas = activeCapabilities?.schemas;

      if (hasSchemas && schemas) {
        schemas.forEach((schema) => {
          loadSchemaData(schema);
        });
      } else if (isMultiDb && configuredDatabases) {
        configuredDatabases.forEach((db) => {
          loadDatabaseData(db);
        });
      }
    };

    loadAll();
  }, [isOpen, activeConnectionId, activeCapabilities, schemas, configuredDatabases, loadSchemaData, loadDatabaseData]);

  // Gather all schema items based on database capabilities
  const items = useMemo(() => {
    return getNavigatorItems({
      activeConnectionId,
      hasSchemas: !!activeCapabilities?.schemas,
      isMultiDb: isMultiDatabaseCapable(activeCapabilities),
      schemas,
      schemaDataMap,
      configuredDatabases,
      databaseDataMap,
      tables,
      views,
      routines,
      triggers,
      activeSchema,
    });
  }, [
    activeConnectionId,
    activeCapabilities,
    schemas,
    schemaDataMap,
    configuredDatabases,
    databaseDataMap,
    tables,
    views,
    routines,
    triggers,
    activeSchema,
  ]);

  // Check if we have multiple databases/schemas to show group headers
  const showGroupHeaders = useMemo(() => {
    const isMultiDb = isMultiDatabaseCapable(activeCapabilities);
    const hasSchemas = activeCapabilities?.schemas;
    return !!(hasSchemas || isMultiDb);
  }, [activeCapabilities]);

  // Dynamically filter items as user types
  const filteredItems = useMemo(() => {
    return filterNavigatorItems(items, search);
  }, [items, search]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  // Handle open actions
  const handleSelect = useCallback(async (item: typeof items[number]) => {
    onClose();
    const { name, type, schema } = item;

    if (type === "table") {
      if (isMultiDatabaseCapable(activeCapabilities)) {
        if (schema) setActiveTable(name, schema);
        const quotedTable = quoteTableRef(name, activeDriver);
        navigate("/editor", {
          state: {
            initialQuery: `SELECT * FROM ${quotedTable}`,
            tableName: name,
            schema,
            title: schema ? `${name} (${schema})` : name,
            targetConnectionId: activeConnectionId,
          },
        });
      } else {
        if (schema) {
          setActiveTable(name, schema);
        }
        const quotedTable = quoteTableRef(name, activeDriver, schema);
        navigate("/editor", {
          state: {
            initialQuery: `SELECT * FROM ${quotedTable}`,
            tableName: name,
            schema,
            targetConnectionId: activeConnectionId,
          },
        });
      }
    } else if (type === "view") {
      if (isMultiDatabaseCapable(activeCapabilities)) {
        const quotedView = quoteTableRef(name, activeDriver);
        navigate("/editor", {
          state: {
            initialQuery: `SELECT * FROM ${quotedView}`,
            tableName: name,
            schema,
            title: schema ? `${name} (${schema})` : name,
            targetConnectionId: activeConnectionId,
          },
        });
      } else {
        const quotedView = quoteTableRef(name, activeDriver, schema);
        navigate("/editor", {
          state: {
            initialQuery: `SELECT * FROM ${quotedView}`,
            tableName: name,
            schema,
            targetConnectionId: activeConnectionId,
          },
        });
      }
    } else if (type === "routine") {
      try {
        const definition = await invoke<string>("get_routine_definition", {
          connectionId: activeConnectionId,
          routineName: name,
          routineType: (item.item as RoutineInfo).routine_type,
          ...(schema ? { schema } : {}),
        });
        navigate("/editor", {
          state: {
            initialQuery: definition,
            queryName: `${name} Definition`,
            preventAutoRun: true,
            schema,
            targetConnectionId: activeConnectionId,
          },
        });
      } catch (e) {
        console.error(e);
        showAlert(
          t`Failed to get routine definition: ` + String(e),
          { kind: "error" }
        );
      }
    } else if (type === "trigger") {
      try {
        const definition = await invoke<string>("get_trigger_definition", {
          connectionId: activeConnectionId,
          triggerName: name,
          tableName: (item.item as TriggerInfo).table_name,
          ...(schema ? { schema } : {}),
        });
        navigate("/editor", {
          state: {
            initialQuery: definition,
            queryName: `${name} Definition`,
            preventAutoRun: true,
            schema,
            readOnly: true,
            targetConnectionId: activeConnectionId,
          },
        });
      } catch (e) {
        console.error(e);
        showAlert(
          t`Failed to get trigger definition: ` + String(e),
          { kind: "error" }
        );
      }
    }
  }, [
    activeConnectionId,
    activeCapabilities,
    activeDriver,
    navigate,
    onClose,
    setActiveTable,
    showAlert,
    t,
  ]);

  // Open the editor with a COUNT(*) query for the table/view
  const handleCountRows = useCallback((item: typeof items[number]) => {
    onClose();
    const { name, schema } = item;
    const quotedTable = isMultiDatabaseCapable(activeCapabilities)
      ? quoteTableRef(name, activeDriver)
      : quoteTableRef(name, activeDriver, schema);
    navigate("/editor", {
      state: {
        initialQuery: `SELECT COUNT(*) as count FROM ${quotedTable}`,
        schema,
        targetConnectionId: activeConnectionId,
      },
    });
  }, [activeCapabilities, activeConnectionId, activeDriver, navigate, onClose]);

  // Open a new console pre-filled with a SELECT on the table, without running it
  const handleNewConsole = useCallback((item: typeof items[number]) => {
    onClose();
    const spec = newConsoleForTable(item.name, activeDriver, item.schema);
    navigate("/editor", {
      state: {
        initialQuery: spec.sql,
        queryName: spec.title,
        preventAutoRun: true,
        schema: spec.schema,
        targetConnectionId: activeConnectionId,
      },
    });
  }, [activeConnectionId, activeDriver, navigate, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredItems.length > 0 ? (prev + 1) % filteredItems.length : 0
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredItems.length > 0
            ? (prev - 1 + filteredItems.length) % filteredItems.length
            : 0
        );
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const activeItem = filteredItems[selectedIndex];
        if (activeItem) {
          handleSelect(activeItem);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, filteredItems, selectedIndex, handleSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-[100] backdrop-blur-sm pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[60vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-default bg-base">
          <Search size={18} className="text-secondary shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            className="flex-1 bg-transparent text-primary placeholder-muted outline-none text-sm"
            placeholder={t`Search tables, views, routines, triggers...`}
            autoFocus
          />
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Results List */}
        <div ref={listRef} className="overflow-y-auto flex-1 flex flex-col py-1">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted text-sm">
              {t`No matching elements found`}
            </div>
          ) : (
            (() => {
              let lastSchema: string | undefined = undefined;
              return filteredItems.map((item, idx) => {
                const isActive = idx === selectedIndex;
                const showHeader = showGroupHeaders && item.schema && item.schema !== lastSchema;
                if (showHeader) {
                  lastSchema = item.schema;
                }

                let typeColor = "text-blue-400";
                let typeIcon = <Table size={14} className={typeColor} />;
                if (item.type === "view") {
                  typeColor = "text-purple-400";
                  typeIcon = <Eye size={14} className={typeColor} />;
                } else if (item.type === "routine") {
                  typeColor = "text-green-500";
                  typeIcon = <Code2 size={14} className={typeColor} />;
                } else if (item.type === "trigger") {
                  typeColor = "text-orange-400";
                  typeIcon = <Zap size={14} className={typeColor} />;
                }

                return (
                  <div key={`${item.type}-${item.schema || ""}-${item.name}`}>
                    {showHeader && (
                      <div className="px-4 py-1.5 text-[11px] font-bold text-muted bg-surface-secondary/15 uppercase tracking-wider select-none flex items-center gap-1.5 first:mt-0 mt-2 border-b border-default/30">
                        <Database size={10} className="text-blue-400/80 shrink-0" />
                        <span className="truncate">{item.schema}</span>
                      </div>
                    )}
                    <div
                      onClick={() => handleSelect(item)}
                      data-active={isActive}
                      className={`flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer group transition-colors ${
                        isActive
                          ? "bg-surface-secondary text-primary"
                          : "text-secondary hover:bg-surface-secondary hover:text-primary"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="shrink-0">{typeIcon}</div>
                        <div className="flex items-baseline gap-2 min-w-0 truncate">
                          <span className="text-sm font-medium truncate">{item.name}</span>
                          {item.detail && (
                            <span className="text-xs text-muted truncate">{item.detail}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Entity quick actions */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                          {item.type === "table" && (
                            <>
                              {onInspect && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onClose();
                                    onInspect(item.name, item.schema);
                                  }}
                                  className="p-1 rounded hover:bg-surface-tertiary text-muted hover:text-blue-400 transition-colors"
                                  title={t`Inspect structure`}
                                >
                                  <FileText size={12} />
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNewConsole(item);
                                }}
                                className="p-1 rounded hover:bg-surface-tertiary text-muted hover:text-yellow-500 transition-colors"
                                title={t`New console`}
                              >
                                <FileCode size={12} />
                              </button>
                              {onGenerateSql && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onClose();
                                    onGenerateSql(item.name);
                                  }}
                                  className="p-1 rounded hover:bg-surface-tertiary text-muted hover:text-purple-400 transition-colors"
                                  title={t`Generate SQL templates`}
                                >
                                  <Code2 size={12} />
                                </button>
                              )}
                            </>
                          )}
                          {(item.type === "table" || item.type === "view") && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCountRows(item);
                                }}
                                className="p-1 rounded hover:bg-surface-tertiary text-muted hover:text-orange-400 transition-colors"
                                title={t`Count rows`}
                              >
                                <Hash size={12} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelect(item);
                                }}
                                className="p-1 rounded hover:bg-surface-tertiary text-muted hover:text-green-500 transition-colors"
                                title={t`Run SELECT query`}
                              >
                                <Play size={12} />
                              </button>
                            </>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(item.name);
                              onClose();
                            }}
                            className="p-1 rounded hover:bg-surface-tertiary text-muted hover:text-primary transition-colors"
                            title={t`Copy name`}
                          >
                            <Copy size={12} />
                          </button>
                        </div>

                        <span className="text-[10px] uppercase font-bold text-muted border border-default/50 px-1.5 py-0.5 rounded tracking-wider shrink-0 select-none">
                          {i18n._(quickNavigatorType[item.type])}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              });
            })()
          )}
        </div>

        {/* Footer info & keyboard guides */}
        <div className="px-4 py-2 border-t border-default bg-base/50 flex justify-between text-[11px] text-muted select-none">
          <span>
            {filteredItems.length === 1
              ? t`1 element`
              : t`${filteredItems.length} elements`}
          </span>
          <div className="flex gap-4">
            <span>{t`↑↓ to navigate, Enter to open`}</span>
            <span>{t({ message: "Esc to close", context: "editor.quickNavigator.escHint" })}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
