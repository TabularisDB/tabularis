import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useAlert } from "../../hooks/useAlert";
import { useDatabase } from "../../hooks/useDatabase";
import { Modal } from "../ui/Modal";
import { Loader2, Download, Database, Square, CheckSquare } from "lucide-react";
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
  const { activeSchema } = useDatabase();
  const { showAlert } = useAlert();
  const [includeStructure, setIncludeStructure] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(
    new Set(tables),
  );
  const [isExporting, setIsExporting] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // in seconds
  const [startTime, setStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedTables(new Set(tables));
      setElapsedTime(0);
      setStartTime(null);
    }
  }, [isOpen, tables]);

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
    setSelectedTables(selectAllTables(selectedTables, tables));
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

      // Rust command expects `options` struct
      await invoke("dump_database", {
        connectionId,
        filePath,
        options: {
          structure: includeStructure,
          data: includeData,
          tables: Array.from(selectedTables),
        },
        ...(activeSchema ? { schema: activeSchema } : {}),
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
                    <span className="text-xs font-semibold uppercase text-muted">{t("dump.selectTables")} ({selectedTables.size}/{tables.length})</span>
                    <button 
                        onClick={handleSelectAll} 
                        className="text-xs text-blue-500 hover:underline"
                        disabled={isExporting}
                    >
                        {selectedTables.size === tables.length ? t("dump.deselectAll") : t("dump.selectAll")}
                    </button>
                </div>
                <div className="overflow-y-auto p-2 grid grid-cols-2 gap-2">
                    {tables.map(table => {
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
                    })}
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
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center gap-2 transition-colors"
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
