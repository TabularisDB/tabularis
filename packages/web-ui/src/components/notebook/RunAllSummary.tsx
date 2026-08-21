import { useTranslation } from "react-i18next";
import { X, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { RunAllResult } from "../../types/notebook";

interface RunAllSummaryProps {
  result: RunAllResult;
  onDismiss: () => void;
  onScrollToCell?: (cellId: string) => void;
}

export function RunAllSummary({
  result,
  onDismiss,
  onScrollToCell,
}: RunAllSummaryProps) {
  const { t } = useTranslation();
  const hasErrors = result.failed > 0;

  return (
    <div
      className={`mx-4 mb-3 rounded-lg border ${
        hasErrors
          ? "border-red-500/30 bg-red-500/5"
          : "border-green-500/30 bg-green-500/5"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          {hasErrors ? (
            <AlertTriangle size={14} className="text-red-400" />
          ) : (
            <CheckCircle2 size={14} className="text-green-400" />
          )}
          <span className={hasErrors ? "text-red-400" : "text-green-400"}>
            {t("editor.notebook.runAllComplete")}
          </span>
          <span className="text-muted">
            {result.succeeded > 0 && (
              <span className="text-green-400">
                {result.succeeded} {t("editor.notebook.succeeded")}
              </span>
            )}
            {result.failed > 0 && (
              <span className="text-red-400">
                {result.succeeded > 0 && ", "}
                {result.failed} {t("editor.notebook.failed")}
              </span>
            )}
            {result.skipped > 0 && (
              <span className="text-muted">
                {(result.succeeded > 0 || result.failed > 0) && ", "}
                {result.skipped} {t("editor.notebook.skipped")}
              </span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="p-0.5 text-muted hover:text-secondary rounded transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {result.errors.length > 0 && (
        <div className="px-3 pb-2 space-y-1">
          {result.errors.map((err) => (
            <div
              key={err.cellId}
              className="flex items-start gap-2 text-[11px]"
            >
              <button
                type="button"
                onClick={() => onScrollToCell?.(err.cellId)}
                className="text-red-400 hover:text-red-300 underline whitespace-nowrap shrink-0"
              >
                Cell #{err.cellIndex + 1}
              </button>
              <span className="text-muted truncate">{err.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
