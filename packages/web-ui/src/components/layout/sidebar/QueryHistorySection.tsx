import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search, Trash2, Loader2, Database, AlertTriangle, X } from "lucide-react";
import { groupByDate, formatHistoryTime } from "../../../utils/dateGroups";
import { SqlHighlight } from "../../ui/SqlHighlight";
import { formatSqlPreview } from "../../../utils/sqlHighlight";
import { useSettings } from "../../../hooks/useSettings";
import type {
  QueryHistoryEntry,
  QueryHistoryRecoveryNotice,
} from "../../../types/queryHistory";

interface QueryHistorySectionProps {
  entries: QueryHistoryEntry[];
  isLoading: boolean;
  recoveryNotice: QueryHistoryRecoveryNotice | null;
  onDismissRecoveryNotice: () => void;
  onDoubleClick: (entry: QueryHistoryEntry) => void;
  onContextMenu: (
    e: React.MouseEvent,
    entry: QueryHistoryEntry,
  ) => void;
  onClearAll: () => void;
}

export function QueryHistorySection({
  entries,
  isLoading,
  recoveryNotice,
  onDismissRecoveryNotice,
  onDoubleClick,
  onContextMenu,
  onClearAll,
}: QueryHistorySectionProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const lower = search.toLowerCase();
    return entries.filter((e) => e.sql.toLowerCase().includes(lower));
  }, [entries, search]);

  const groupedEntries = useMemo(
    () => groupByDate(filteredEntries, (e) => e.executedAt, settings.displayTimezone),
    [filteredEntries, settings.displayTimezone],
  );

  const formatDuration = (ms: number | null): string => {
    if (ms === null) return "";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const recoveryBanner = recoveryNotice ? (
    <div className="m-2 p-2.5 bg-accent-warning/10 border border-accent-warning/40 rounded text-[11px] text-accent-warning leading-snug">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-accent-warning" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold mb-1">
            {t("sidebar.historyRecoveredTitle")}
          </div>
          <div className="text-accent-warning/80">
            {t("sidebar.historyRecoveredBody")}
          </div>
          <div
            className="mt-1 font-mono text-[10px] text-accent-warning/70 break-all"
            title={recoveryNotice.backupPath}
          >
            {recoveryNotice.backupPath}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismissRecoveryNotice}
          className="shrink-0 text-accent-warning/60 hover:text-accent-warning transition-colors"
          title={t("sidebar.historyRecoveredDismiss")}
          aria-label={t("sidebar.historyRecoveredDismiss")}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  ) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20 text-muted gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">{t("sidebar.loadingSchema")}</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div>
        {recoveryBanner}
        <div className="text-center p-4 text-xs text-muted italic">
          {t("sidebar.noQueryHistory")}
        </div>
      </div>
    );
  }

  return (
    <div>
      {recoveryBanner}
      {/* Header with search and clear */}
      <div className="px-2 pb-1.5 flex items-center gap-1">
        <div className="relative flex-1">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("sidebar.searchHistory")}
            className="w-full pl-6 pr-2 py-1 text-xs bg-surface-secondary border border-default rounded text-primary placeholder:text-muted focus:outline-none focus:border-focus/50"
          />
        </div>
        <button
          onClick={onClearAll}
          className="p-1 text-muted hover:text-accent-error transition-colors shrink-0"
          title={t("sidebar.clearAllHistory")}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Search result count */}
      {search.trim() && (
        <div className="px-3 pb-1 text-[10px] text-muted">
          {filteredEntries.length} / {entries.length}
        </div>
      )}

      {/* Grouped entries */}
      {groupedEntries.length === 0 ? (
        <div className="text-center p-2 text-xs text-muted italic">
          {t("sidebar.noHistorySearchResults")}
        </div>
      ) : (
        groupedEntries.map(([groupKey, items]) => (
          <div key={groupKey}>
            <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted tracking-wider">
              {t(`sidebar.${groupKey}`)}
            </div>
            {items.map((entry) => (
              <button
                type="button"
                key={entry.id}
                aria-pressed={selectedId === entry.id}
                onClick={() => setSelectedId(entry.id)}
                onDoubleClick={() => onDoubleClick(entry)}
                onKeyDown={(e) => {
                  // Enter opens the entry like a double click; Space keeps selecting it.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setSelectedId(entry.id);
                    onDoubleClick(entry);
                  }
                }}
                onContextMenu={(e) => onContextMenu(e, entry)}
                className={`block w-full text-left pl-3 pr-3 py-1.5 cursor-pointer group transition-colors border-b border-default/30 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                  selectedId === entry.id
                    ? entry.status === "error"
                      ? "bg-accent-error/15"
                      : "bg-surface-secondary"
                    : entry.status === "error"
                      ? "hover:bg-accent-error/10"
                      : "hover:bg-surface-secondary"
                }`}
                title={entry.database ? `[${entry.database}] ${entry.sql}` : entry.sql}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted min-w-0">
                    <span>{formatHistoryTime(entry.executedAt, settings.displayTimezone)}</span>
                    {entry.executionTimeMs !== null && (
                      <span className="text-muted/60">{formatDuration(entry.executionTimeMs)}</span>
                    )}
                  </div>
                  {entry.database && (
                    <div className="flex items-center gap-0.5 text-[10px] text-muted shrink-0">
                      <Database size={9} className="shrink-0" />
                      <span className="truncate max-w-[80px]">{entry.database}</span>
                    </div>
                  )}
                </div>
                {entry.status === "error" ? (
                  <pre
                    className="text-[11px] leading-[1.4] font-mono whitespace-pre-wrap break-all text-accent-error/70 overflow-hidden"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {formatSqlPreview(entry.sql)}
                  </pre>
                ) : (
                  <SqlHighlight sql={entry.sql} />
                )}
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
