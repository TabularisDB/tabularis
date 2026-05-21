import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Trash2,
  Play,
  Eye,
  Pencil,
  Loader2,
  Database,
  GripVertical,
  Zap,
  History,
} from "lucide-react";
import type { NotebookCellType } from "../../types/notebook";
import { CellNameAiButton } from "./CellNameAiButton";

interface NotebookCellHeaderProps {
  cellType: NotebookCellType;
  index: number;
  totalCells: number;
  isPreview?: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onRun?: () => void;
  onTogglePreview?: () => void;
  isLoading?: boolean;
  activeSchema?: string;
  selectedDatabases?: string[];
  onSchemaChange?: (schema: string) => void;
  dragHandleProps?: {
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
    draggable: boolean;
  };
  isParallel?: boolean;
  onToggleParallel?: () => void;
  historyCount?: number;
  onToggleHistory?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse: () => void;
  cellName?: string;
  onNameChange: (name: string) => void;
  cellContent?: string;
}

function CellTypeBadge({ cellType }: { cellType: NotebookCellType }) {
  const { t } = useTranslation();

  if (cellType === "sql") {
    return (
      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
        {t("editor.notebook.sqlCell")}
      </span>
    );
  }

  return (
    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
      {t("editor.notebook.markdownCell")}
    </span>
  );
}

function ActionButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1 text-muted hover:text-primary hover:bg-surface-secondary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

export function NotebookCellHeader({
  cellType,
  index,
  totalCells,
  isPreview,
  onMoveUp,
  onMoveDown,
  onDelete,
  onRun,
  onTogglePreview,
  isLoading,
  activeSchema,
  selectedDatabases,
  onSchemaChange,
  dragHandleProps,
  isParallel,
  onToggleParallel,
  historyCount,
  onToggleHistory,
  isCollapsed,
  onToggleCollapse,
  cellName,
  onNameChange,
  cellContent,
}: NotebookCellHeaderProps) {
  const { t } = useTranslation();
  const [isDbOpen, setIsDbOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(cellName ?? "");
  const dbButtonRef = useRef<HTMLButtonElement>(null);
  const [dbDropdownPosition, setDbDropdownPosition] = useState({ top: 0, left: 0 });
  const showDbSelector = cellType === "sql" && selectedDatabases && selectedDatabases.length > 1 && activeSchema && onSchemaChange;

  const updateDbDropdownPosition = useCallback(() => {
    if (dbButtonRef.current) {
      const rect = dbButtonRef.current.getBoundingClientRect();
      setDbDropdownPosition({ top: rect.bottom + 4, left: rect.left });
    }
  }, []);

  useEffect(() => {
    if (!isDbOpen) return;
    updateDbDropdownPosition();
    const handle = () => updateDbDropdownPosition();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [isDbOpen, updateDbDropdownPosition]);

  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-elevated border-b border-default relative z-10">
      <div className="flex items-center gap-2">
        {dragHandleProps && (
          <div
            className="cursor-grab active:cursor-grabbing text-muted hover:text-secondary transition-colors"
            draggable={dragHandleProps.draggable}
            onDragStart={dragHandleProps.onDragStart}
            onDragEnd={dragHandleProps.onDragEnd}
          >
            <GripVertical size={14} />
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-0.5 text-muted hover:text-primary transition-colors rounded"
          title={t(isCollapsed ? "editor.notebook.expandCell" : "editor.notebook.collapseCell")}
        >
          <ChevronRight
            size={14}
            className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          />
        </button>
        <CellTypeBadge cellType={cellType} />
        <span className="text-[10px] text-muted">#{index + 1}</span>
        {isEditingName ? (
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={() => {
              onNameChange(nameInput.trim());
              setIsEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onNameChange(nameInput.trim());
                setIsEditingName(false);
              }
              if (e.key === "Escape") {
                setNameInput(cellName ?? "");
                setIsEditingName(false);
              }
            }}
            className="text-[10px] text-secondary bg-base border border-strong rounded px-1 py-0.5 outline-none focus:border-blue-500 w-32"
            placeholder={t("editor.notebook.cellNamePlaceholder")}
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameInput(cellName ?? "");
              setIsEditingName(true);
            }}
            className="text-[10px] text-muted hover:text-secondary transition-colors truncate max-w-[200px]"
            title={t("editor.notebook.editCellName")}
          >
            {cellName || t("editor.notebook.cellNamePlaceholder")}
          </button>
        )}
        {cellContent && (
          <CellNameAiButton content={cellContent} onNameGenerated={onNameChange} />
        )}
        {showDbSelector && (
          <div className="relative">
            <button
              ref={dbButtonRef}
              type="button"
              onClick={() => {
                if (!isDbOpen) updateDbDropdownPosition();
                setIsDbOpen((v) => !v);
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-secondary border border-strong rounded text-[10px] text-secondary hover:text-primary hover:bg-surface transition-colors"
              title={t("editor.activeDatabase")}
            >
              <Database size={10} className="text-muted shrink-0" />
              <span className="max-w-[100px] truncate">{activeSchema}</span>
              <ChevronDown size={10} className="text-muted shrink-0" />
            </button>
            {isDbOpen &&
              createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[150]"
                    onClick={() => setIsDbOpen(false)}
                  />
                  <div
                    className="fixed min-w-[120px] max-h-[230px] overflow-y-auto bg-surface-secondary border border-strong rounded shadow-xl z-[200] flex flex-col py-1"
                    style={{ top: dbDropdownPosition.top, left: dbDropdownPosition.left }}
                  >
                    {selectedDatabases.map((db) => (
                      <button
                        key={db}
                        type="button"
                        onClick={() => {
                          onSchemaChange(db);
                          setIsDbOpen(false);
                        }}
                        className={`text-left px-2.5 py-1 text-[11px] hover:bg-surface transition-colors flex items-center gap-1.5 ${
                          activeSchema === db
                            ? "text-white font-medium"
                            : "text-secondary"
                        }`}
                      >
                        <Database size={10} className="text-muted shrink-0" />
                        {db}
                      </button>
                    ))}
                  </div>
                </>,
                document.body,
              )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        {cellType === "sql" && onRun && (
          <ActionButton onClick={onRun} title={t("editor.notebook.runCell")} disabled={isLoading}>
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
          </ActionButton>
        )}

        {cellType === "sql" && onToggleParallel && (
          <button
            type="button"
            onClick={onToggleParallel}
            title={t("editor.notebook.parallelExecution")}
            className={`p-1 rounded transition-colors ${
              isParallel
                ? "text-yellow-400 bg-yellow-500/15"
                : "text-muted hover:text-primary hover:bg-surface-secondary"
            }`}
          >
            <Zap size={14} />
          </button>
        )}

        {cellType === "sql" && onToggleHistory && (
          <button
            type="button"
            onClick={onToggleHistory}
            title={t("editor.notebook.executionHistory")}
            className="p-1 text-muted hover:text-primary hover:bg-surface-secondary rounded transition-colors relative"
          >
            <History size={14} />
            {historyCount != null && historyCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 text-[8px] bg-blue-500 text-white rounded-full w-3 h-3 flex items-center justify-center leading-none">
                {historyCount > 9 ? "+" : historyCount}
              </span>
            )}
          </button>
        )}

        {cellType === "markdown" && onTogglePreview && (
          <ActionButton onClick={onTogglePreview} title={t("editor.notebook.togglePreview")}>
            {isPreview ? <Pencil size={14} /> : <Eye size={14} />}
          </ActionButton>
        )}

        <ActionButton
          onClick={onMoveUp}
          disabled={index === 0}
          title={t("editor.notebook.moveCellUp")}
        >
          <ChevronUp size={14} />
        </ActionButton>

        <ActionButton
          onClick={onMoveDown}
          disabled={index === totalCells - 1}
          title={t("editor.notebook.moveCellDown")}
        >
          <ChevronDown size={14} />
        </ActionButton>

        <ActionButton onClick={onDelete} title={t("editor.notebook.deleteCell")}>
          <Trash2 size={14} />
        </ActionButton>
      </div>
    </div>
  );
}
