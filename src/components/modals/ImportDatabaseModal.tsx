import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { Loader2, Database, X, CheckCircle2, XCircle } from "lucide-react";
import { formatElapsedTime } from "../../utils/formatTime";
import { useDatabase } from "../../hooks/useDatabase";

interface ImportProgress {
  statements_executed: number;
  total_statements: number;
  percentage: number;
  current_operation: string;
}

interface ImportDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  databaseName: string;
  filePath: string;
  onSuccess?: () => void;
}

export const ImportDatabaseModal = ({
  isOpen,
  onClose,
  connectionId,
  databaseName,
  filePath,
  onSuccess,
}: ImportDatabaseModalProps) => {
  const { t } = useTranslation();
  const { activeSchema } = useDatabase();
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // in seconds
  const [startTime, setStartTime] = useState<number | null>(null);

  const startImport = useCallback(async () => {
    setIsImporting(true);
    setError(null);
    setSuccess(false);
    setStartTime(Date.now());
    setElapsedTime(0);

    try {
      await invoke("import_database", {
        connectionId,
        filePath,
        ...(activeSchema ? { schema: activeSchema } : {}),
      });

      setSuccess(true);
      setIsImporting(false);

      if (onSuccess) {
        onSuccess();
      }

      // Auto-close after 2 seconds on success
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (e) {
      const errorMsg = String(e);
      setError(errorMsg);
      setIsImporting(false);

      if (!errorMsg.includes("cancelled")) {
        await message(t("dump.importFailure") + ": " + errorMsg, {
          kind: "error",
        });
      }
    }
  }, [connectionId, filePath, activeSchema, onSuccess, onClose, t]);

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsImporting(false);
      setProgress(null);
      setError(null);
      setSuccess(false);
      setElapsedTime(0);
      setStartTime(null);
      return;
    }

    // Start import automatically when modal opens
    startImport();

    // Listen to progress events
    const unlisten = listen<ImportProgress>("import_progress", (event) => {
      setProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isOpen, startImport]);

  // Timer for elapsed time
  useEffect(() => {
    if (!isImporting || !startTime) return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [isImporting, startTime]);

  const handleCancel = async () => {
    if (!isImporting) {
      onClose();
      return;
    }

    try {
      await invoke("cancel_import", { connectionId });
      await message(t("dump.importCancelled"), { kind: "info" });
      onClose();
    } catch (e) {
      console.error("Failed to cancel import:", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-base border border-default rounded-lg shadow-xl w-[600px] flex flex-col">
        <div className="p-4 border-b border-default flex justify-between items-center">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database size={18} />
            {t("dump.importTitle")} - {databaseName}
          </h2>
          <button
            onClick={handleCancel}
            className="text-muted hover:text-primary text-xl leading-none"
            disabled={success}
          >
            &times;
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          {/* Status Icon */}
          <div className="flex justify-center">
            {isImporting && (
              <Loader2
                size={48}
                className="animate-spin text-blue-500"
              />
            )}
            {success && (
              <CheckCircle2
                size={48}
                className="text-green-500"
              />
            )}
            {error && !isImporting && (
              <XCircle
                size={48}
                className="text-red-500"
              />
            )}
          </div>

          {/* Progress Information */}
          {progress && (
            <div className="space-y-3">
              {/* Progress Bar - show determinate or indeterminate based on total */}
              {progress.total_statements > 0 && progress.percentage > 0 ? (
                <>
                  <div className="w-full bg-surface-secondary rounded-full h-3 overflow-hidden border border-default">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>

                  {/* Stats */}
                  <div className="flex justify-between text-sm text-muted">
                    <span>
                      {t("dump.statementsExecuted", {
                        count: progress.statements_executed,
                        total: progress.total_statements,
                      })}
                    </span>
                    <span className="font-semibold text-primary">
                      {progress.percentage.toFixed(1)}%
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {/* Indeterminate progress bar when total is unknown */}
                  <div className="w-full bg-surface-secondary rounded-full h-3 overflow-hidden border border-default">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-blue-600 animate-pulse w-full" />
                  </div>

                  {/* Show only executed count */}
                  <div className="text-center text-sm text-muted">
                    <span className="font-semibold text-primary">
                      {progress.statements_executed.toLocaleString()}
                    </span>{" "}
                    statements imported
                  </div>
                </>
              )}

              {/* Current Operation */}
              <div className="text-center text-xs text-muted italic">
                {progress.current_operation}
              </div>
            </div>
          )}

          {/* Elapsed Time */}
          {(isImporting || success || error) && elapsedTime > 0 && (
            <div className="text-center text-sm text-muted">
              {t("dump.elapsedTime")}: <span className="font-mono font-semibold text-primary">{formatElapsedTime(elapsedTime)}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="text-center text-green-500 font-medium">
              {t("dump.importSuccess")}
            </div>
          )}

          {/* Error Message */}
          {error && !isImporting && (
            <div className="text-center text-red-500 text-sm">
              {error.includes("cancelled")
                ? t("dump.importCancelled")
                : t("dump.importFailed")}
            </div>
          )}

          {/* File Info */}
          <div className="text-xs text-muted text-center mt-2">
            {t("dump.importingFrom")}: {filePath.split(/[/\\]/).pop()}
          </div>
        </div>

        <div className="p-4 border-t border-default flex justify-end gap-2">
          {isImporting ? (
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-2 transition-colors"
            >
              <X size={16} />
              {t("common.cancel")}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded hover:bg-surface-secondary transition-colors"
            >
              {success ? t("common.close") : t("common.cancel")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
