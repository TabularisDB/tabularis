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
  ArrowRightToLine,
  ArrowLeftToLine,
  Trash2,
  Database,
  Pencil,
  ChevronDown,
  ChevronUp,
  Code2,
  Sparkles,
  PanelTop,
  Rows3,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { ResultEntryContent } from "./ResultEntryContent";
import { StackedResultItem } from "./StackedResultItem";
import { ContextMenu } from "./ContextMenu";
import { formatDuration } from "../../utils/formatTime";
import { getTabScrollState } from "../../utils/tabScroll";
import {
  findActiveEntry,
  countSucceeded,
  countFailed,
  totalExecutionTime,
  getEntryDisplayLabel,
} from "../../utils/multiResult";
import { useSettings } from "../../hooks/useSettings";
import type { QueryResultEntry } from "../../types/editor";

interface MultiResultPanelProps {
  results: QueryResultEntry[];
  activeResultId: string | undefined;
  tabId: string;
  connectionId: string | null;
  copyFormat: "csv" | "json" | "sql-insert";
  csvDelimiter: string;
  csvIncludeHeaders: boolean;
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
  aiEnabled,
  aiRenaming,
  queryPrefix,
  onSelect,
  onRerun,
  onClose,
  onRename,
  onAiRename,
  onContextMenu,
}: {
  entry: QueryResultEntry;
  isActive: boolean;
  initialEditing: boolean;
  aiEnabled: boolean;
  aiRenaming: boolean;
  queryPrefix: string;
  onSelect: () => void;
  onRerun: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onAiRename: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const displayLabel = getEntryDisplayLabel(entry, queryPrefix);
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

      {/* AI rename button — hover only */}
      {aiEnabled && !entry.isLoading && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAiRename();
          }}
          disabled={aiRenaming}
          className="p-0.5 rounded-sm hover:bg-surface-secondary transition-opacity shrink-0 opacity-0 group-hover:opacity-100 disabled:opacity-50"
          title={aiRenaming ? t("editor.multiResult.generatingName") : t("editor.multiResult.aiGenerateName")}
        >
          {aiRenaming ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Sparkles size={10} className="text-purple-300" />
          )}
        </button>
      )}

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
  connectionId,
  copyFormat,
  csvDelimiter,
  csvIncludeHeaders,
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
  const { settings } = useSettings();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entryId: string;
  } | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [queryExpanded, setQueryExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"tabs" | "stacked">("tabs");
  const [aiRenamingEntryId, setAiRenamingEntryId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const activeEntry = findActiveEntry(results, activeResultId);
  const succeeded = countSucceeded(results);
  const failed = countFailed(results);
  const totalTime = totalExecutionTime(results);
  const queryPrefix = t("editor.multiResult.queryPrefix");

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

  useEffect(() => {
    setQueryExpanded(false);
  }, [activeResultId]);

  const pending = results.filter((r) => r.isLoading).length;
  const isRunning = pending > 0;

  // Live wall-clock timer: the elapsed time ticks up while statements are
  // still running, instead of only appearing once the whole batch finishes.
  // Anchored to the run's start; the precise server-measured total replaces it
  // when done. setState only happens in timer/rAF callbacks (never in the
  // effect body) to avoid cascading synchronous renders.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const start = performance.now();
    const frame = requestAnimationFrame(() =>
      setElapsed(performance.now() - start),
    );
    const id = setInterval(() => setElapsed(performance.now() - start), 100);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, [isRunning]);

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

  const handleAiRename = async (entryId: string) => {
    const entry = results.find((r) => r.id === entryId);
    if (!entry?.query.trim() || !settings.aiProvider) return;
    setAiRenamingEntryId(entryId);
    try {
      const name = await invoke<string>("generate_tab_rename", {
        req: {
          provider: settings.aiProvider,
          model: settings.aiModel || "",
          query: entry.query,
        },
      });
      onRenameEntry(entryId, name.trim());
    } catch (e) {
      console.error("Failed to generate tab name:", e);
    } finally {
      setAiRenamingEntryId(null);
    }
  };

  const aiEnabled = !!(settings.aiEnabled && settings.aiProvider);

  const viewToggle = results.length > 1 && (
    <button
      onClick={() => setViewMode((v) => (v === "tabs" ? "stacked" : "tabs"))}
      className="flex items-center justify-center w-8 h-full text-muted border-l border-default shrink-0 transition-colors hover:text-white hover:bg-surface-secondary"
      title={viewMode === "tabs" ? t("editor.multiResult.viewStacked") : t("editor.multiResult.viewTabs")}
    >
      {viewMode === "tabs" ? <Rows3 size={14} /> : <PanelTop size={14} />}
    </button>
  );

  // Counts update live as each statement resolves, so the badge reflects
  // progress in real time: succeeded / failed accumulate while a spinning
  // count shows how many statements are still running. The elapsed time ticks
  // up live while running, then snaps to the precise server-measured total.
  const summaryBadge = (succeeded > 0 || failed > 0 || pending > 0) && (
    <div className="flex items-center gap-2 px-3 h-full text-[10px] text-muted border-l border-default shrink-0">
      <span>
        {succeeded > 0 && (
          <span className="text-green-400">{succeeded}<Check size={9} className="inline ml-0.5" /></span>
        )}
        {failed > 0 && (
          <span className="text-red-400 ml-1.5">{failed}<XCircle size={9} className="inline ml-0.5" /></span>
        )}
        {pending > 0 && (
          <span className="text-blue-400 ml-1.5">{pending}<Loader2 size={9} className="inline ml-0.5 animate-spin" /></span>
        )}
      </span>
      {isRunning ? (
        <span className="font-mono text-blue-400">{formatDuration(elapsed)}</span>
      ) : (
        totalTime > 0 && (
          <span className="font-mono text-muted">{formatDuration(totalTime)}</span>
        )
      )}
    </div>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {viewMode === "tabs" ? (
        <>
          {/* Tab bar */}
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
                  aiEnabled={aiEnabled}
                  aiRenaming={aiRenamingEntryId === entry.id}
                  queryPrefix={queryPrefix}
                  onSelect={() => { if (shouldEdit) setEditingEntryId(null); onSelectResult(entry.id); }}
                  onRerun={() => onRerunEntry(entry.id)}
                  onClose={() => onCloseEntry(entry.id)}
                  onRename={(label) => onRenameEntry(entry.id, label)}
                  onAiRename={() => handleAiRename(entry.id)}
                  onContextMenu={(e) => handleContextMenu(entry.id, e)}
                />
                );
              })}
            </div>
            {summaryBadge}
            {viewToggle}
          </div>

          {/* Query preview */}
          {activeEntry.query && (
            <div
              className="bg-surface-secondary border-b border-default px-3 py-1.5 flex items-start gap-2 cursor-pointer select-none group/qp"
              onClick={() => setQueryExpanded((v) => !v)}
            >
              <Code2 size={12} className="text-muted shrink-0 mt-0.5" />
              <pre
                className={clsx(
                  "flex-1 text-[11px] font-mono text-secondary whitespace-pre-wrap break-all m-0",
                  !queryExpanded && "line-clamp-1",
                )}
              >
                {activeEntry.query.trim()}
              </pre>
              <button className="text-muted hover:text-white shrink-0 mt-0.5">
                {queryExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
          )}

          {/* Active entry content */}
          <div className="flex-1 min-h-0 flex flex-col">
            <ResultEntryContent
              entry={activeEntry}
              connectionId={connectionId}
              copyFormat={copyFormat}
              csvDelimiter={csvDelimiter}
              csvIncludeHeaders={csvIncludeHeaders}
              onPageChange={(page) => onPageChange(activeEntry.id, page)}
            />
          </div>
        </>
      ) : (
        <>
          {/* Stacked header */}
          <div className="flex items-center bg-elevated border-b border-default h-9 shrink-0">
            <div className="flex items-center gap-2 px-3 flex-1 text-xs text-secondary">
              <Database size={12} className="text-muted shrink-0" />
              <span className="font-medium text-primary">
                {t("editor.multiResult.results")}
              </span>
              <span className="text-muted">
                ({results.length})
              </span>
            </div>
            {summaryBadge}
            {/* Collapse all / Expand all */}
            <button
              onClick={() => {
                const allCollapsed = collapsedIds.size === results.length;
                setCollapsedIds(
                  allCollapsed ? new Set() : new Set(results.map((r) => r.id)),
                );
              }}
              className="flex items-center justify-center w-8 h-full text-muted border-l border-default shrink-0 transition-colors hover:text-white hover:bg-surface-secondary"
              title={
                collapsedIds.size === results.length
                  ? t("editor.multiResult.expandAll")
                  : t("editor.multiResult.collapseAll")
              }
            >
              {collapsedIds.size === results.length ? (
                <ChevronsUpDown size={14} />
              ) : (
                <ChevronsDownUp size={14} />
              )}
            </button>
            {viewToggle}
          </div>

          {/* Stacked results */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {results.map((entry) => (
              <StackedResultItem
                key={entry.id}
                entry={entry}
                connectionId={connectionId}
                copyFormat={copyFormat}
                csvDelimiter={csvDelimiter}
                csvIncludeHeaders={csvIncludeHeaders}
                collapsed={collapsedIds.has(entry.id)}
                aiEnabled={aiEnabled}
                aiRenaming={aiRenamingEntryId === entry.id}
                onToggleCollapse={() =>
                  setCollapsedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.id)) next.delete(entry.id);
                    else next.add(entry.id);
                    return next;
                  })
                }
                onPageChange={(page) => onPageChange(entry.id, page)}
                onRename={(label) => onRenameEntry(entry.id, label)}
                onRerun={() => onRerunEntry(entry.id)}
                onAiRename={() => handleAiRename(entry.id)}
                onClose={() => onCloseEntry(entry.id)}
              />
            ))}
          </div>
        </>
      )}

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
            ...(aiEnabled
              ? [
                  {
                    label: aiRenamingEntryId === contextMenu.entryId
                      ? t("editor.multiResult.generatingName")
                      : t("editor.multiResult.aiGenerateName"),
                    icon: Sparkles,
                    action: () => handleAiRename(contextMenu.entryId),
                    disabled: aiRenamingEntryId !== null,
                  },
                ]
              : []),
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
