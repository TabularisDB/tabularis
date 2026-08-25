import { useTranslation } from "react-i18next";
import { RotateCcw, X } from "lucide-react";
import type { CellExecutionEntry } from "../../types/notebook";

interface CellHistoryPanelProps {
  history: CellExecutionEntry[];
  onRestore: (index: number) => void;
  onClose: () => void;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function HistoryEntry({
  entry,
  index,
  onRestore,
}: {
  entry: CellExecutionEntry;
  index: number;
  onRestore: () => void;
}) {
  const isError = !!entry.error;

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 hover:bg-surface-secondary rounded transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted">
            {formatTimestamp(entry.timestamp)}
          </span>
          {entry.executionTime != null && (
            <span className="text-[10px] text-muted">
              {Math.round(entry.executionTime)}ms
            </span>
          )}
          {isError && (
            <span className="text-[10px] text-red-400 font-semibold">
              ERROR
            </span>
          )}
          {!isError && entry.result && (
            <span className="text-[10px] text-green-400">
              {entry.result.rows.length} rows
            </span>
          )}
        </div>
        <pre className="text-[10px] text-secondary font-mono truncate mt-0.5">
          {entry.query}
        </pre>
      </div>
      <button
        type="button"
        onClick={onRestore}
        className="p-1 text-muted hover:text-blue-400 rounded transition-colors opacity-0 group-hover:opacity-100 shrink-0"
        title={`Restore execution #${index + 1}`}
      >
        <RotateCcw size={12} />
      </button>
    </div>
  );
}

export function CellHistoryPanel({
  history,
  onRestore,
  onClose,
}: CellHistoryPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="border-t border-default bg-elevated">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] text-muted font-semibold uppercase">
          {t("editor.notebook.executionHistory")} ({history.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 text-muted hover:text-secondary rounded transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      <div className="max-h-[200px] overflow-auto px-1 pb-2">
        {history.length === 0 ? (
          <p className="text-[10px] text-muted px-2 py-1">
            {t("editor.notebook.noHistory")}
          </p>
        ) : (
          history.map((entry, index) => (
            <HistoryEntry
              key={entry.timestamp}
              entry={entry}
              index={index}
              onRestore={() => onRestore(index)}
            />
          ))
        )}
      </div>
    </div>
  );
}
