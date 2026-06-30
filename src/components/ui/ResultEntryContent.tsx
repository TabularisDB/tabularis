import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import { DataGrid } from "./DataGrid";
import { ErrorDisplay } from "./ErrorDisplay";
import { PaginationControls } from "./PaginationControls";
import { formatDuration } from "../../utils/formatTime";
import { getStackedGridHeight } from "../../utils/multiResult";
import type { QueryResultEntry } from "../../types/editor";

interface ResultEntryContentProps {
  entry: QueryResultEntry;
  connectionId: string | null;
  copyFormat: "csv" | "json" | "sql-insert";
  csvDelimiter: string;
  csvIncludeHeaders: boolean;
  onPageChange: (page: number) => void;
  compact?: boolean;
}

export function ResultEntryContent({
  entry,
  connectionId,
  copyFormat,
  csvDelimiter,
  csvIncludeHeaders,
  onPageChange,
  compact,
}: ResultEntryContentProps) {
  const { t } = useTranslation();

  if (entry.isLoading) {
    if (compact) {
      return (
        <div className="flex items-center gap-2 px-3 py-4 text-muted text-xs">
          <div className="w-3 h-3 border-2 border-surface-secondary border-t-blue-500 rounded-full animate-spin" />
          <span>{t("editor.executingQuery")}</span>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted">
        <div className="w-12 h-12 border-4 border-surface-secondary border-t-blue-500 rounded-full animate-spin mb-4" />
        <p className="text-sm">{t("editor.executingQuery")}</p>
      </div>
    );
  }

  if (entry.error) {
    return (
      <div className={compact ? "max-h-[150px] overflow-auto" : undefined}>
        <ErrorDisplay error={entry.error} t={t} />
      </div>
    );
  }

  if (!entry.result) {
    if (compact) return null;
    return (
      <div className="flex items-center justify-center h-full text-surface-tertiary text-sm">
        {t("editor.executePrompt")}
      </div>
    );
  }

  // A statement that returns no result set (INSERT/UPDATE/DELETE/DDL such as
  // CREATE/ALTER/DROP VIEW) still succeeded — surface that explicitly instead
  // of an empty grid with a misleading "0 rows retrieved" header.
  if (entry.result.columns.length === 0) {
    const affected = entry.result.affected_rows ?? 0;
    const time =
      entry.executionTime !== null ? (
        <span className="text-muted font-mono">
          ({formatDuration(entry.executionTime)})
        </span>
      ) : null;

    if (compact) {
      return (
        <div className="flex items-center gap-2 px-3 py-3 text-xs">
          <CheckCircle2 size={14} className="text-green-500 shrink-0" />
          <span className="text-primary">{t("editor.queryExecuted")}</span>
          {affected > 0 && (
            <span className="text-secondary">
              {t("editor.rowsAffected", { count: affected })}
            </span>
          )}
          {time}
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-center px-4">
        <CheckCircle2 size={32} className="text-green-500" />
        <p className="text-sm font-medium text-primary">
          {t("editor.queryExecuted")}
        </p>
        <p className="text-xs text-secondary flex items-center gap-2">
          {affected > 0 && (
            <span>{t("editor.rowsAffected", { count: affected })}</span>
          )}
          {time}
        </p>
      </div>
    );
  }

  if (compact) {
    const gridHeight = getStackedGridHeight(entry.result.rows.length);
    return (
      <div style={{ height: gridHeight }} className="overflow-hidden">
        <DataGrid
          key={`${entry.id}-${entry.result.rows.length}`}
          columns={entry.result.columns}
          data={entry.result.rows}
          tableName={null}
          pkColumns={null}
          connectionId={connectionId}
          selectedRows={new Set()}
          onSelectionChange={() => {}}
          copyFormat={copyFormat}
          csvDelimiter={csvDelimiter}
          csvIncludeHeaders={csvIncludeHeaders}
          readonly={true}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Status bar */}
      <div className="p-2 bg-elevated text-xs text-secondary border-b border-default flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <span>
            {t("editor.rowsRetrieved", {
              count: entry.result.rows.length,
            })}{" "}
            {entry.executionTime !== null && (
              <span className="text-muted ml-2 font-mono">
                ({formatDuration(entry.executionTime)})
              </span>
            )}
          </span>
          {entry.result.pagination?.has_more && (
            <span className="px-2 py-0.5 bg-yellow-900/30 text-yellow-400 rounded text-[10px] font-semibold uppercase tracking-wide border border-yellow-500/30">
              {t("editor.autoPaginated")}
            </span>
          )}
        </div>
        {entry.result.pagination && (
          <PaginationControls
            pagination={entry.result.pagination}
            isLoading={entry.isLoading}
            onPageChange={onPageChange}
          />
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <DataGrid
          key={`${entry.id}-${entry.result.rows.length}`}
          columns={entry.result.columns}
          data={entry.result.rows}
          tableName={null}
          pkColumns={null}
          connectionId={connectionId}
          selectedRows={new Set()}
          onSelectionChange={() => {}}
          copyFormat={copyFormat}
          csvDelimiter={csvDelimiter}
          csvIncludeHeaders={csvIncludeHeaders}
          readonly={true}
        />
      </div>
    </div>
  );
}
