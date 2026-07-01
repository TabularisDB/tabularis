import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useAlert } from "../../hooks/useAlert";
import { useDatabase } from "../../hooks/useDatabase";
import type { TableInfo } from "../../contexts/DatabaseContext";
import { isMultiDatabaseCapable, isSchemaBasedMultiDb } from "../../utils/database";
import { resolveActiveSchema } from "../../utils/schema";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import { Loader2, Download, Database, Layers, Square, CheckSquare } from "lucide-react";
import {
  validateDumpOptions,
  toggleTableSelection,
  selectAllTables,
} from "../../utils/dumpUtils";
import { formatElapsedTime } from "../../utils/formatTime";

interface DumpDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  databaseName: string;
  tables: string[];
}

export const DumpDatabaseModal = ({
  isOpen,
  onClose,
  connectionId,
  databaseName,
  tables,
}: DumpDatabaseModalProps) => {
  const { t } = useTranslation();
  const { activeSchema, activeCapabilities, databaseDataMap, refreshDatabaseData } =
    useDatabase();
  const { showAlert } = useAlert();
  const [includeStructure, setIncludeStructure] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(
    new Set(tables),
  );
  const [isExporting, setIsExporting] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // in seconds
  const [startTime, setStartTime] = useState<number | null>(null);

  const isMultiDb = isMultiDatabaseCapable(activeCapabilities);
  // Schema-based multi-database (PostgreSQL): databases contain schemas, so
  // `databaseDataMap[db].tables` is always empty — table lists live per schema
  // and load lazily. The backend dump is scoped to a single schema too
  // (`schema.unwrap_or("public")`), so a schema picker lets the user choose
  // which schema of the target database to dump; the table list mirrors it.
  const isSchemaBased = isSchemaBasedMultiDb(activeCapabilities);
  const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);
  const [pickedSchema, setPickedSchema] = useState<string | null>(null);
  const dumpSchema = isSchemaBased
    ? (pickedSchema ?? activeSchema ?? "public")
    : (activeSchema ?? "public");

  // Load the target database's schema list whenever the dialog opens so the
  // picker reflects that database (not the connection's primary one).
  useEffect(() => {
    if (!isOpen || !isSchemaBased) {
      setAvailableSchemas([]);
      setPickedSchema(null);
      return;
    }
    let cancelled = false;
    invoke<string[]>("get_schemas", {
      connectionId,
      ...(databaseName ? { database: databaseName } : {}),
    })
      .then((schemas) => {
        if (cancelled) return;
        setAvailableSchemas(schemas);
        // Keep a still-valid pick, otherwise the connection's active schema,
        // otherwise a sensible default ("public" or the first schema).
        setPickedSchema((prev) => resolveActiveSchema(prev, activeSchema, schemas));
      })
      .catch((e) => console.error("Failed to load schemas for dump:", e));
    return () => {
      cancelled = true;
    };
    // activeSchema only seeds the default pick; reacting to it would reset the
    // user's choice while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isSchemaBased, connectionId, databaseName]);

  // On a flat multi-database connection (e.g. MySQL) the dump targets a specific
  // database whose cached table list may be missing or belong to a different
  // database. Reload it whenever the dialog opens so the dump reflects the
  // target database's current schema. A ref keeps refreshDatabaseData out of the
  // dependency list (its identity changes on every store update, which would
  // otherwise loop).
  const refreshRef = useRef(refreshDatabaseData);
  refreshRef.current = refreshDatabaseData;
  useEffect(() => {
    if (isOpen && isMultiDb && !isSchemaBased && databaseName) {
      refreshRef.current(databaseName);
    }
  }, [isOpen, isMultiDb, isSchemaBased, databaseName]);

  // Schema-based drivers: fetch the table list of the schema the dump will
  // actually export, routed to the target database's pool — the sidebar cache
  // can't be used because per-schema data loads lazily and may be absent.
  const [schemaTables, setSchemaTables] = useState<string[] | null>(null);
  const [schemaTablesLoading, setSchemaTablesLoading] = useState(false);
  useEffect(() => {
    if (!isOpen || !isSchemaBased) {
      setSchemaTables(null);
      return;
    }
    let cancelled = false;
    setSchemaTablesLoading(true);
    invoke<TableInfo[]>("get_tables", {
      connectionId,
      schema: dumpSchema,
      ...(databaseName ? { database: databaseName } : {}),
    })
      .then((res) => {
        if (!cancelled) setSchemaTables(res.map((tbl) => tbl.name));
      })
      .catch((e) => {
        console.error("Failed to load tables for dump:", e);
        if (!cancelled) setSchemaTables([]);
      })
      .finally(() => {
        if (!cancelled) setSchemaTablesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, isSchemaBased, connectionId, dumpSchema, databaseName]);

  // For multi-database connections read the table list straight from the target
  // database's freshly-loaded data (never the active-database fallback); other
  // drivers keep using the list resolved by the parent.
  const targetDbData = isMultiDb && !isSchemaBased ? databaseDataMap[databaseName] : undefined;
  const tablesLoading = isSchemaBased
    ? schemaTablesLoading
    : isMultiDb
      ? (targetDbData?.isLoading ?? false)
      : false;
  const effectiveTables = useMemo(
    () =>
      isSchemaBased
        ? (schemaTables ?? [])
        : isMultiDb
          ? (targetDbData?.tables ?? []).map((tbl) => tbl.name)
          : tables,
    [isSchemaBased, schemaTables, isMultiDb, targetDbData, tables],
  );

  // Detect content changes without reacting to array-reference churn; the actual
  // list is read from a ref so table names containing the separator stay intact.
  const tablesKey = effectiveTables.join("\n");
  const effectiveTablesRef = useRef(effectiveTables);
  effectiveTablesRef.current = effectiveTables;

  useEffect(() => {
    if (isOpen) {
      setSelectedTables(new Set(effectiveTablesRef.current));
      setElapsedTime(0);
      setStartTime(null);
    }
  }, [isOpen, tablesKey]);

  // Timer for elapsed time
  useEffect(() => {
    if (!isExporting || !startTime) return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [isExporting, startTime]);

  const handleToggleTable = (table: string) => {
    setSelectedTables(toggleTableSelection(selectedTables, table));
  };

  const handleSelectAll = () => {
    setSelectedTables(selectAllTables(selectedTables, effectiveTables));
  };

  const handleExport = async () => {
    const validation = validateDumpOptions(
      includeStructure,
      includeData,
      selectedTables,
    );

    if (!validation.isValid && validation.errorKey) {
      showAlert(t(validation.errorKey), { kind: "error" });
      return;
    }

    try {
      const filePath = await save({
        filters: [
          {
            name: "SQL File",
            extensions: ["sql"],
          },
        ],
        defaultPath: `${databaseName}_dump_${new Date().toISOString().slice(0, 10)}.sql`,
      });

      if (!filePath) return;

      setIsExporting(true);
      setStartTime(Date.now());
      setElapsedTime(0);

      // On multi-database connections (e.g. MySQL) scope the dump to the selected
      // database so it does not fall back to the connection's primary database.
      const databaseParam =
        isMultiDb && databaseName ? { database: databaseName } : {};

      // Schema-based drivers (PostgreSQL) dump the schema picked in the dialog;
      // other drivers keep the connection's active schema.
      const schemaForDump = isSchemaBased ? dumpSchema : activeSchema;

      // Rust command expects `options` struct
      await invoke("dump_database", {
        connectionId,
        filePath,
        options: {
          structure: includeStructure,
          data: includeData,
          tables: Array.from(selectedTables),
        },
        ...(schemaForDump ? { schema: schemaForDump } : {}),
        ...databaseParam,
      });

      showAlert(t("dump.success"), { kind: "info" });
      onClose();
    } catch (e) {
      // Check if it's a cancellation error (optional logic, but usually we just log)
      console.error(e);
      showAlert(t("dump.failure") + String(e), { kind: "error" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleStop = async () => {
    try {
      await invoke("cancel_dump", { connectionId });
    } catch (e) {
      console.error("Failed to cancel dump:", e);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
       <div className="bg-base border border-default rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
          <div className="p-4 border-b border-default flex justify-between items-center">
            <h2 className="text-lg font-semibold flex items-center gap-2">
                <Database size={18} />
                {t("dump.title")} - {databaseName}
            </h2>
            <button onClick={onClose} className="text-muted hover:text-primary text-xl leading-none" disabled={isExporting}>&times;</button>
          </div>

          <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">
            {/* Schema picker (schema-based drivers, i.e. PostgreSQL): the dump
                covers one schema of the target database — let the user pick it. */}
            {isSchemaBased && availableSchemas.length > 0 && (
              <div className="flex items-center gap-3 p-3 bg-surface-secondary rounded border border-default">
                <span className="flex items-center gap-2 text-sm text-secondary shrink-0">
                  <Layers size={14} className="text-accent shrink-0" />
                  {t("sidebar.schema")}
                </span>
                <Select
                  value={dumpSchema}
                  options={availableSchemas}
                  onChange={(s) => setPickedSchema(s)}
                  placeholder={t("sidebar.schema")}
                  className="flex-1"
                  triggerClassName="px-3 py-1.5 text-sm"
                  disabled={isExporting}
                />
              </div>
            )}

            {/* Options */}
            <div className="flex gap-6 p-3 bg-surface-secondary rounded border border-default">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={includeStructure}
                        onChange={e => setIncludeStructure(e.target.checked)}
                        className="rounded border-default bg-base focus:ring-blue-500 w-4 h-4"
                        disabled={isExporting}
                    />
                    <span>{t("dump.includeStructure")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={includeData}
                        onChange={e => setIncludeData(e.target.checked)}
                        className="rounded border-default bg-base focus:ring-blue-500 w-4 h-4"
                        disabled={isExporting}
                    />
                    <span>{t("dump.includeData")}</span>
                </label>
            </div>

            {/* Table Selection */}
            <div className="flex-1 flex flex-col border border-default rounded overflow-hidden max-h-[400px]">
                <div className="p-2 bg-surface-secondary border-b border-default flex justify-between items-center shrink-0">
                    <span className="text-xs font-semibold uppercase text-muted">{t("dump.selectTables")} ({selectedTables.size}/{effectiveTables.length})</span>
                    <button
                        onClick={handleSelectAll}
                        className="text-xs text-blue-500 hover:underline"
                        disabled={isExporting || tablesLoading}
                    >
                        {selectedTables.size === effectiveTables.length ? t("dump.deselectAll") : t("dump.selectAll")}
                    </button>
                </div>
                <div className="overflow-y-auto p-2 grid grid-cols-2 gap-2">
                    {tablesLoading && effectiveTables.length === 0 ? (
                        <div className="col-span-2 flex items-center justify-center gap-2 p-4 text-muted text-sm">
                            <Loader2 size={16} className="animate-spin" />
                        </div>
                    ) : (
                        effectiveTables.map(table => {
                            const isSelected = selectedTables.has(table);
                            return (
                                <div key={table}
                                    onClick={() => !isExporting && handleToggleTable(table)}
                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer border transition-colors ${isSelected ? 'bg-blue-500/10 border-blue-500/50' : 'hover:bg-surface-secondary border-transparent'} ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    <div className={`w-4 h-4 flex items-center justify-center ${isSelected ? 'text-blue-500' : 'text-muted'}`}>
                                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                    </div>
                                    <span className="truncate text-sm select-none" title={table}>{table}</span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Elapsed Time */}
            {isExporting && elapsedTime > 0 && (
              <div className="text-center text-sm text-muted">
                {t("dump.elapsedTime")}: <span className="font-mono font-semibold text-primary">{formatElapsedTime(elapsedTime)}</span>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-default flex justify-end gap-2 shrink-0">
             <button
                onClick={onClose}
                disabled={isExporting}
                className="px-4 py-2 rounded hover:bg-surface-secondary transition-colors"
             >
                {t("common.cancel")}
             </button>
             {isExporting ? (
                 <button
                    onClick={handleStop}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-2 transition-colors"
                 >
                    <Loader2 size={16} className="animate-spin" />
                    {t("editor.stop")}
                 </button>
             ) : (
                 <button
                    onClick={handleExport}
                    disabled={tablesLoading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                    <Download size={16} />
                    {t("dump.export")}
                 </button>
             )}
          </div>
       </div>
    </Modal>
  );
};
