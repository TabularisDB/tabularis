import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Check,
  XCircle,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowRightToLine,
  ArrowLeftToLine,
  Trash2,
  Database,
  Pencil,
} from "lucide-react";
import clsx from "clsx";
import { DataGrid } from "./DataGrid";
import { ErrorDisplay } from "./ErrorDisplay";
import { ContextMenu } from "./ContextMenu";
import { formatDuration } from "../../utils/formatTime";
import { getTabScrollState } from "../../utils/tabScroll";
import {
  findActiveEntry,
  countSucceeded,
  countFailed,
  totalExecutionTime,
} from "../../utils/multiResult";
import type { QueryResultEntry } from "../../types/editor";

interface MultiResultPanelProps {
  results: QueryResultEntry[];
  activeResultId: string | undefined;
  tabId: string;
  isAllDone: boolean;
  connectionId: string | null;
  copyFormat: "csv" | "json";
  csvDelimiter: string;
  onSelectResult: (entryId: string) => void;
  onRerunEntry: (entryId: string) => void;
  onPageChange: (entryId: string, page: number) => void;
  onCloseEntry: (entryId: string) => void;
  onCloseOtherEntries: (entryId: string) => void;
  onCloseEntriesToRight: (entryId: string) => void;
  onCloseEntriesToLeft: (entryId: string) => void;
  onCloseAllEntries: () => void;
  onRenameEntry: (entryId: string, label: string) => void;
}

function ResultTab({
  entry,
  isActive,
  initialEditing,
  onSelect,
  onRerun,
  onClose,
  onRename,
  onContextMenu,
}: {
  entry: QueryResultEntry;
  isActive: boolean;
  initialEditing: boolean;
  onSelect: () => void;
  onRerun: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const displayLabel =
    entry.label ||
    t("editor.multiResult.query", { index: entry.queryIndex + 1 });
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [editValue, setEditValue] = useState(
    initialEditing ? (entry.label || displayLabel) : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      className={clsx(
        "flex items-center gap-2 px-3 h-full border-r border-default cursor-pointer min-w-[120px] max-w-[220px] text-xs transition-all group relative select-none",
        isActive
          ? "bg-base text-primary font-medium"
          : "text-muted hover:bg-surface-secondary hover:text-secondary",
      )}
    >
      {/* Active indicator — top bar */}
      {isActive && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500" />
      )}

      {/* Loading indicator — bottom bar */}
      {entry.isLoading && (
        <div className="absolute bottom-0 left-0 h-0.5 bg-blue-500 animate-pulse w-full" />
      )}

      {/* Status icon */}
      {entry.isLoading ? (
        <Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />
      ) : entry.error ? (
        <XCircle size={12} className="text-red-400 shrink-0" />
      ) : (
        <Database size={12} className="text-green-400 shrink-0" />
      )}

      {/* Label */}
      <span className="truncate flex-1 flex items-center gap-1">
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
            className="bg-transparent border-b border-blue-500 text-white text-xs font-medium outline-none w-full px-0"
          />
        ) : (
          <span
            className="truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
            title={entry.query}
          >
            {displayLabel}
          </span>
        )}
      </span>

      {/* Rerun button — hover only */}
      {!entry.isLoading && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRerun();
          }}
          className="p-0.5 rounded-sm hover:bg-surface-secondary transition-opacity shrink-0 opacity-0 group-hover:opacity-100"
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
        className={clsx(
          "p-0.5 rounded-sm hover:bg-surface-secondary transition-opacity shrink-0",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function MultiResultPanel({
  results,
  activeResultId,
  isAllDone,
  connectionId,
  copyFormat,
  csvDelimiter,
  onSelectResult,
  onRerunEntry,
  onPageChange,
  onCloseEntry,
  onCloseOtherEntries,
  onCloseEntriesToRight,
  onCloseEntriesToLeft,
  onCloseAllEntries,
  onRenameEntry,
}: MultiResultPanelProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entryId: string;
  } | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const activeEntry = findActiveEntry(results, activeResultId);
  const succeeded = countSucceeded(results);
  const failed = countFailed(results);
  const totalTime = totalExecutionTime(results);

  const updateScrollArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const state = getTabScrollState(el);
    setCanScrollLeft(state.canScrollLeft);
    setCanScrollRight(state.canScrollRight);
  }, []);

  useEffect(() => {
    updateScrollArrows();
  }, [results, updateScrollArrows]);

  const scrollTabs = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction === "left" ? -200 : 200,
      behavior: "smooth",
    });
  };

  if (!activeEntry) return null;

  const handleContextMenu = (entryId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entryId });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Tab bar — mirrors main editor tab bar */}
      <div className="flex items-center bg-elevated border-b border-default h-9 shrink-0">
        <button
          onClick={() => scrollTabs("left")}
          disabled={!canScrollLeft}
          className="flex items-center justify-center w-7 h-full text-muted border-r border-default shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:text-white hover:enabled:bg-surface-secondary"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => scrollTabs("right")}
          disabled={!canScrollRight}
          className="flex items-center justify-center w-7 h-full text-muted border-r border-default shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:text-white hover:enabled:bg-surface-secondary"
        >
          <ChevronRight size={14} />
        </button>
        <div
          ref={scrollRef}
          onScroll={updateScrollArrows}
          className="flex flex-1 overflow-x-auto no-scrollbar h-full"
        >
          {results.map((entry) => {
            const shouldEdit = editingEntryId === entry.id;
            return (
            <ResultTab
              key={shouldEdit ? `${entry.id}-edit` : entry.id}
              entry={entry}
              isActive={entry.id === activeEntry.id}
              initialEditing={shouldEdit}
              onSelect={() => { if (shouldEdit) setEditingEntryId(null); onSelectResult(entry.id); }}
              onRerun={() => onRerunEntry(entry.id)}
              onClose={() => onCloseEntry(entry.id)}
              onRename={(label) => onRenameEntry(entry.id, label)}
              onContextMenu={(e) => handleContextMenu(entry.id, e)}
            />
            );
          })}
        </div>
        {/* Summary badge */}
        {isAllDone && (
          <div className="flex items-center gap-2 px-3 h-full text-[10px] text-muted border-l border-default shrink-0">
            <span>
              {succeeded > 0 && (
                <span className="text-green-400">{succeeded}<Check size={9} className="inline ml-0.5" /></span>
              )}
              {failed > 0 && (
                <span className="text-red-400 ml-1.5">{failed}<XCircle size={9} className="inline ml-0.5" /></span>
              )}
            </span>
            {totalTime > 0 && (
              <span className="font-mono text-muted">
                {formatDuration(totalTime)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Active entry content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeEntry.isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <div className="w-12 h-12 border-4 border-surface-secondary border-t-blue-500 rounded-full animate-spin mb-4"></div>
            <p className="text-sm">{t("editor.executingQuery")}</p>
          </div>
        ) : activeEntry.error ? (
          <ErrorDisplay error={activeEntry.error} t={t} />
        ) : activeEntry.result ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="p-2 bg-elevated text-xs text-secondary border-b border-default flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <span>
                  {t("editor.rowsRetrieved", {
                    count: activeEntry.result.rows.length,
                  })}{" "}
                  {activeEntry.executionTime !== null && (
                    <span className="text-muted ml-2 font-mono">
                      ({formatDuration(activeEntry.executionTime)})
                    </span>
                  )}
                </span>
                {activeEntry.result.pagination?.has_more && (
                  <span className="px-2 py-0.5 bg-yellow-900/30 text-yellow-400 rounded text-[10px] font-semibold uppercase tracking-wide border border-yellow-500/30">
                    {t("editor.autoPaginated")}
                  </span>
                )}
              </div>
              {/* Pagination Controls */}
              {activeEntry.result.pagination && (
                <div className="flex items-center gap-1 bg-surface-secondary rounded border border-strong">
                  <button
                    disabled={
                      activeEntry.result.pagination.page === 1 ||
                      activeEntry.isLoading
                    }
                    onClick={() => onPageChange(activeEntry.id, 1)}
                    className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                    title="First Page"
                  >
                    <ChevronsLeft size={14} />
                  </button>
                  <button
                    disabled={
                      activeEntry.result.pagination.page === 1 ||
                      activeEntry.isLoading
                    }
                    onClick={() =>
                      onPageChange(
                        activeEntry.id,
                        activeEntry.result!.pagination!.page - 1,
                      )
                    }
                    className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                    title="Previous Page"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <div className="px-3 text-secondary text-xs font-medium min-w-[80px] text-center py-1">
                    {activeEntry.result.pagination.total_rows !== null
                      ? t("editor.pageOf", {
                          current: activeEntry.result.pagination.page,
                          total: Math.ceil(
                            activeEntry.result.pagination.total_rows /
                              activeEntry.result.pagination.page_size,
                          ),
                        })
                      : t("editor.page", {
                          current: activeEntry.result.pagination.page,
                        })}
                  </div>
                  <button
                    disabled={
                      !activeEntry.result.pagination.has_more ||
                      activeEntry.isLoading
                    }
                    onClick={() =>
                      onPageChange(
                        activeEntry.id,
                        activeEntry.result!.pagination!.page + 1,
                      )
                    }
                    className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                    title="Next Page"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    disabled={
                      activeEntry.result.pagination.total_rows === null ||
                      activeEntry.isLoading
                    }
                    onClick={() =>
                      onPageChange(
                        activeEntry.id,
                        Math.ceil(
                          activeEntry.result!.pagination!.total_rows! /
                            activeEntry.result!.pagination!.page_size,
                        ),
                      )
                    }
                    className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                    title="Last Page"
                  >
                    <ChevronsRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <DataGrid
                key={`${activeEntry.id}-${activeEntry.result.rows.length}`}
                columns={activeEntry.result.columns}
                data={activeEntry.result.rows}
                tableName={null}
                pkColumn={null}
                connectionId={connectionId}
                selectedRows={new Set()}
                onSelectionChange={() => {}}
                copyFormat={copyFormat}
                csvDelimiter={csvDelimiter}
                readonly={true}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-surface-tertiary text-sm">
            {t("editor.executePrompt")}
          </div>
        )}
      </div>

      {/* Tab context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: t("editor.multiResult.rename"),
              icon: Pencil,
              action: () => setEditingEntryId(contextMenu.entryId),
            },
            { separator: true },
            {
              label: t("editor.closeTab"),
              icon: X,
              action: () => onCloseEntry(contextMenu.entryId),
            },
            {
              label: t("editor.closeOthers"),
              icon: XCircle,
              action: () => onCloseOtherEntries(contextMenu.entryId),
              disabled: results.length <= 1,
            },
            {
              label: t("editor.closeRight"),
              icon: ArrowRightToLine,
              action: () => onCloseEntriesToRight(contextMenu.entryId),
              disabled:
                results.findIndex((r) => r.id === contextMenu.entryId) ===
                results.length - 1,
            },
            {
              label: t("editor.closeLeft"),
              icon: ArrowLeftToLine,
              action: () => onCloseEntriesToLeft(contextMenu.entryId),
              disabled:
                results.findIndex((r) => r.id === contextMenu.entryId) === 0,
            },
            { separator: true },
            {
              label: t("editor.closeAll"),
              icon: Trash2,
              danger: true,
              action: () => onCloseAllEntries(),
            },
          ]}
        />
      )}
    </div>
  );
}
