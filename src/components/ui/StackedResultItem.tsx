import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  XCircle,
  Database,
  Code2,
  ChevronDown,
  ChevronRight,
  Pencil,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import clsx from "clsx";
import { ResultEntryContent } from "./ResultEntryContent";
import { PaginationControls } from "./PaginationControls";
import { ResizeHandle } from "../notebook/ResizeHandle";
import { formatDuration } from "../../utils/formatTime";
import { getEntryDisplayLabel, getStackedGridHeight } from "../../utils/multiResult";
import type { QueryResultEntry } from "../../types/editor";

interface StackedResultItemProps {
  entry: QueryResultEntry;
  connectionId: string | null;
  copyFormat: "csv" | "json" | "sql-insert";
  csvDelimiter: string;
  csvIncludeHeaders: boolean;
  collapsed: boolean;
  aiEnabled: boolean;
  aiRenaming: boolean;
  onToggleCollapse: () => void;
  onPageChange: (page: number) => void;
  onRename: (label: string) => void;
  onRerun: () => void;
  onAiRename: () => void;
  onClose: () => void;
}

export function StackedResultItem({
  entry,
  connectionId,
  copyFormat,
  csvDelimiter,
  csvIncludeHeaders,
  collapsed,
  aiEnabled,
  aiRenaming,
  onToggleCollapse,
  onPageChange,
  onRename,
  onRerun,
  onAiRename,
  onClose,
}: StackedResultItemProps) {
  const { t } = useTranslation();
  const [queryExpanded, setQueryExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const displayLabel = getEntryDisplayLabel(
    entry,
    t("editor.multiResult.queryPrefix"),
  );
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const rowCount = entry.result?.rows.length ?? 0;
  const autoHeight = entry.result
    ? getStackedGridHeight(rowCount)
    : 120;
  const [userHeight, setUserHeight] = useState<number | null>(null);
  const gridHeight = userHeight ?? autoHeight;

  const handleResize = useCallback((h: number) => {
    setUserHeight(h);
  }, []);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    setEditValue(entry.label || displayLabel);
    setIsEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== displayLabel) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const hasResult = !entry.isLoading && !entry.error && entry.result;

  return (
    <div className="border-b border-default">
      {/* Header — clickable collapse + label + actions */}
      <div
        className={clsx(
          "flex items-center gap-2 px-3 py-1.5 text-xs select-none group cursor-pointer",
          "bg-elevated hover:bg-surface-secondary transition-colors",
          collapsed && "border-b-0",
        )}
        onClick={(e) => {
          if (isEditing) return;
          if ((e.target as HTMLElement).closest("button, input")) return;
          onToggleCollapse();
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {/* Collapse chevron */}
        <span className="shrink-0 text-muted">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>

        {/* Status icon */}
        {entry.isLoading ? (
          <Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />
        ) : entry.error ? (
          <XCircle size={12} className="text-red-400 shrink-0" />
        ) : (
          <Database size={12} className="text-green-400 shrink-0" />
        )}

        {/* Editable label */}
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setIsEditing(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-transparent border-b border-blue-500 text-white text-xs font-medium outline-none px-0 min-w-[80px]"
          />
        ) : (
          <span
            className="font-medium text-primary shrink-0"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
          >
            {displayLabel}
          </span>
        )}

        {/* Rename button */}
        {!isEditing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
            className="p-0.5 rounded-sm hover:bg-surface-secondary text-muted hover:text-white shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            title={t("editor.multiResult.rename")}
          >
            <Pencil size={10} />
          </button>
        )}

        {/* AI rename button */}
        {aiEnabled && !isEditing && !entry.isLoading && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAiRename();
            }}
            disabled={aiRenaming}
            className="p-0.5 rounded-sm hover:bg-surface-secondary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
            title={aiRenaming ? t("editor.multiResult.generatingName") : t("editor.multiResult.aiGenerateName")}
          >
            {aiRenaming ? (
              <Loader2 size={10} className="animate-spin text-muted" />
            ) : (
              <Sparkles size={10} className="text-purple-300" />
            )}
          </button>
        )}

        {/* Rerun button */}
        {!entry.isLoading && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRerun();
            }}
            className="p-0.5 rounded-sm hover:bg-surface-secondary text-muted hover:text-white shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            title={t("editor.multiResult.rerun")}
          >
            <Play size={10} fill="currentColor" />
          </button>
        )}

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="p-0.5 rounded-sm hover:bg-surface-secondary text-muted hover:text-white shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title={t("editor.multiResult.close")}
        >
          <X size={12} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Inline summary when collapsed or always */}
        {hasResult && (
          <div className="flex items-center gap-2 shrink-0">
            {entry.result!.pagination?.has_more && (
              <span className="px-1.5 py-0.5 bg-yellow-900/30 text-yellow-400 rounded text-[10px] font-semibold uppercase tracking-wide border border-yellow-500/30">
                {t("editor.autoPaginated")}
              </span>
            )}
            <span className="text-muted text-[11px]">
              {t("editor.rowsRetrieved", { count: entry.result!.rows.length })}
              {entry.executionTime !== null && (
                <span className="font-mono ml-1">
                  ({formatDuration(entry.executionTime)})
                </span>
              )}
            </span>
            {entry.result!.pagination && (
              <PaginationControls
                pagination={entry.result!.pagination}
                isLoading={entry.isLoading}
                onPageChange={onPageChange}
              />
            )}
          </div>
        )}

        {/* Error indicator in header when collapsed */}
        {collapsed && entry.error && (
          <span className="text-red-400 text-[11px] truncate max-w-[300px]">
            {entry.error.split("\n")[0]}
          </span>
        )}
      </div>

      {/* Collapsible body */}
      {!collapsed && (
        <>
          {/* Query preview — collapsible */}
          {entry.query && (
            <div
              className="bg-surface-secondary border-b border-default px-3 py-1 flex items-start gap-2 cursor-pointer select-none"
              onClick={() => setQueryExpanded((v) => !v)}
            >
              <Code2 size={12} className="text-muted shrink-0 mt-0.5" />
              <pre
                className={clsx(
                  "flex-1 text-[11px] font-mono text-secondary whitespace-pre-wrap break-all m-0",
                  !queryExpanded && "line-clamp-1",
                )}
              >
                {entry.query.trim()}
              </pre>
              <button className="text-muted hover:text-white shrink-0 mt-0.5">
                {queryExpanded ? (
                  <ChevronDown size={12} className="rotate-180" />
                ) : (
                  <ChevronDown size={12} />
                )}
              </button>
            </div>
          )}

          {/* Result content */}
          {entry.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-muted text-xs">
              <div className="w-3 h-3 border-2 border-surface-secondary border-t-blue-500 rounded-full animate-spin" />
              <span>{t("editor.executingQuery")}</span>
            </div>
          ) : entry.error ? (
            <div className="max-h-[150px] overflow-auto">
              <ResultEntryContent
                entry={entry}
                connectionId={connectionId}
                copyFormat={copyFormat}
                csvDelimiter={csvDelimiter}
                csvIncludeHeaders={csvIncludeHeaders}
                onPageChange={onPageChange}
                compact
              />
            </div>
          ) : entry.result ? (
            <>
              <div style={{ height: gridHeight }} className="overflow-hidden">
                <ResultEntryContent
                  entry={entry}
                  connectionId={connectionId}
                  copyFormat={copyFormat}
                  csvDelimiter={csvDelimiter}
                  csvIncludeHeaders={csvIncludeHeaders}
                  onPageChange={onPageChange}
                  compact
                />
              </div>
              <ResizeHandle
                onResize={handleResize}
                minHeight={70}
                maxHeight={800}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
