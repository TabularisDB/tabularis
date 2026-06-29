import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Play,
  Download,
  Upload,
  Loader2,
  OctagonX,
  FileCode,
  FileText,
  Database,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronDown,
  Undo2,
  Redo2,
  History,
} from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";

interface NotebookToolbarProps {
  onAddSqlCell: () => void;
  onAddMarkdownCell: () => void;
  onRunAll: () => void;
  onExport: () => void;
  onExportHtml: () => void;
  onImport: () => void;
  isRunning: boolean;
  stopOnError: boolean;
  onToggleStopOnError: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onToggleHistory: () => void;
  historyOpen: boolean;
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
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
      className="flex items-center gap-1.5 px-2 py-1 text-xs text-secondary hover:text-primary hover:bg-surface-secondary rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-5 bg-default mx-1 shrink-0" />;
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5 shrink-0">{children}</div>;
}

export function NotebookToolbar({
  onAddSqlCell,
  onAddMarkdownCell,
  onRunAll,
  onExport,
  onExportHtml,
  onImport,
  isRunning,
  stopOnError,
  onToggleStopOnError,
  onCollapseAll,
  onExpandAll,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onToggleHistory,
  historyOpen,
}: NotebookToolbarProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const openMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu((prev) => (prev ? null : { x: rect.left, y: rect.bottom, items }));
  };

  const addItems: ContextMenuItem[] = [
    { label: t("editor.notebook.sqlCell"), icon: Database, action: onAddSqlCell },
    {
      label: t("editor.notebook.markdownCell"),
      icon: FileText,
      action: onAddMarkdownCell,
    },
  ];

  const exportItems: ContextMenuItem[] = [
    { label: t("editor.notebook.export"), icon: Download, action: onExport },
    {
      label: t("editor.notebook.exportHtml"),
      icon: FileCode,
      action: onExportHtml,
    },
  ];

  return (
    <div className="@container h-10 bg-elevated border-b border-default flex items-center px-2 gap-0.5 shrink-0 overflow-x-auto">
      <button
        type="button"
        onClick={(e) => openMenu(e, addItems)}
        title={t("editor.notebook.addCell")}
        className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-primary hover:bg-surface-secondary rounded transition-colors shrink-0"
      >
        <Plus size={14} />
        <span className="hidden @[440px]:inline">
          {t("editor.notebook.addCell")}
        </span>
        <ChevronDown size={12} className="text-muted" />
      </button>

      <Separator />

      <ToolbarGroup>
        <ToolbarButton
          onClick={onUndo}
          disabled={!canUndo}
          title={t("editor.notebook.undo")}
        >
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={onRedo}
          disabled={!canRedo}
          title={t("editor.notebook.redo")}
        >
          <Redo2 size={14} />
        </ToolbarButton>
        <button
          type="button"
          onClick={onToggleHistory}
          title={t("editor.notebook.history.title")}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors shrink-0 ${
            historyOpen
              ? "bg-surface-secondary text-primary"
              : "text-secondary hover:text-primary hover:bg-surface-secondary"
          }`}
        >
          <History size={14} />
        </button>
      </ToolbarGroup>

      <Separator />

      <ToolbarGroup>
        <ToolbarButton
          onClick={onRunAll}
          disabled={isRunning}
          title={t("editor.notebook.runAllTooltip")}
        >
          {isRunning ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} className="text-green-400" />
          )}
          <span className="hidden @[440px]:inline">
            {t("editor.notebook.runAll")}
          </span>
        </ToolbarButton>

        <button
          type="button"
          onClick={onToggleStopOnError}
          title={t("editor.notebook.stopOnErrorTooltip")}
          className={`flex items-center gap-1 px-1.5 py-1 text-[10px] rounded transition-colors shrink-0 ${
            stopOnError
              ? "bg-red-500/15 text-red-400 font-semibold"
              : "text-muted hover:text-secondary hover:bg-surface-secondary"
          }`}
        >
          <OctagonX size={12} />
          <span className="hidden @[540px]:inline">
            {t("editor.notebook.stopOnError")}
          </span>
        </button>
      </ToolbarGroup>

      <Separator />

      <ToolbarGroup>
        <ToolbarButton
          onClick={onCollapseAll}
          title={t("editor.notebook.collapseAll")}
        >
          <ChevronsDownUp size={14} />
          <span className="hidden @[720px]:inline">
            {t("editor.notebook.collapseAll")}
          </span>
        </ToolbarButton>
        <ToolbarButton
          onClick={onExpandAll}
          title={t("editor.notebook.expandAll")}
        >
          <ChevronsUpDown size={14} />
          <span className="hidden @[720px]:inline">
            {t("editor.notebook.expandAll")}
          </span>
        </ToolbarButton>
      </ToolbarGroup>

      <div className="flex-1 min-w-2" />

      <ToolbarGroup>
        <ToolbarButton
          onClick={(e) => openMenu(e, exportItems)}
          title={t("editor.notebook.export")}
        >
          <Download size={14} />
          <span className="hidden @[560px]:inline">
            {t("editor.notebook.export")}
          </span>
          <ChevronDown size={12} className="text-muted" />
        </ToolbarButton>

        <ToolbarButton onClick={onImport} title={t("editor.notebook.import")}>
          <Upload size={14} />
          <span className="hidden @[640px]:inline">
            {t("editor.notebook.import")}
          </span>
        </ToolbarButton>
      </ToolbarGroup>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
