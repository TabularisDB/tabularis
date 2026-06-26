import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Loader2,
  BookOpen,
  RefreshCw,
  Pencil,
  Trash2,
  Download,
  Upload,
  FileCode,
} from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { useSettings } from "../../../hooks/useSettings";
import { useAlert } from "../../../hooks/useAlert";
import { formatHistoryTime } from "../../../utils/dateGroups";
import {
  listNotebooks,
  loadNotebook,
  createNotebookFromState,
  NOTEBOOKS_CHANGED_EVENT,
} from "../../../utils/notebookStore";
import {
  serializeNotebook,
  deserializeNotebook,
} from "../../../utils/notebookFile";
import { exportNotebookToHtml } from "../../../utils/notebookHtmlExport";
import { ConfirmModal } from "../../modals/ConfirmModal";
import { ContextMenu, type ContextMenuItem } from "../../ui/ContextMenu";
import type { NotebookMetadata } from "../../../types/notebook";

interface NotebooksSectionProps {
  /** Active connection — notebooks shown belong to it. */
  connectionId: string | null;
  openNotebookIds: Set<string>;
  onOpen: (notebook: NotebookMetadata) => void;
  onRename: (notebookId: string, title: string) => Promise<void>;
  onDelete: (notebookId: string) => Promise<void>;
}

export function NotebooksSection({
  connectionId,
  openNotebookIds,
  onOpen,
  onRename,
  onDelete,
}: NotebooksSectionProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { showAlert } = useAlert();
  const [notebooks, setNotebooks] = useState<NotebookMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<NotebookMetadata | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nb: NotebookMetadata;
  } | null>(null);

  const reload = useCallback(async () => {
    if (!connectionId) {
      setNotebooks([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const list = await listNotebooks(connectionId);
      list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      setNotebooks(list);
    } catch {
      setNotebooks([]);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    setEditingId(null);
    reload();
  }, [reload]);

  // Refresh whenever a notebook is created/imported/renamed/deleted anywhere
  // (e.g. the "New Notebook" toolbar button), so the list stays current.
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener(NOTEBOOKS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(NOTEBOOKS_CHANGED_EVENT, handler);
  }, [reload]);

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    if (!lower) return notebooks;
    return notebooks.filter((nb) => nb.title.toLowerCase().includes(lower));
  }, [notebooks, search]);

  const startRename = (nb: NotebookMetadata) => {
    setEditingId(nb.id);
    setEditingTitle(nb.title);
  };

  const commitRename = async () => {
    const id = editingId;
    if (!id) return;
    setEditingId(null);
    const title = editingTitle.trim();
    const current = notebooks.find((n) => n.id === id);
    if (!title || !current || title === current.title) return;
    // The store emits NOTEBOOKS_CHANGED_EVENT, which triggers reload().
    await onRename(id, title);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    await onDelete(id);
  };

  const handleExport = async (nb: NotebookMetadata) => {
    if (!connectionId) return;
    try {
      const state = await loadNotebook(nb.id, connectionId);
      const file = serializeNotebook(
        nb.title,
        state.cells,
        state.params,
        state.stopOnError,
      );
      const safeName = nb.title.replace(/[^a-zA-Z0-9_-]/g, "_");
      const target = await save({
        defaultPath: `${safeName}.tabularis-notebook`,
        filters: [
          { name: "Tabularis Notebook", extensions: ["tabularis-notebook"] },
        ],
      });
      if (!target) return;
      await writeTextFile(target, JSON.stringify(file, null, 2));
      showAlert(t("editor.notebook.exportSuccess"), { kind: "info" });
    } catch (e) {
      showAlert(String(e), { kind: "error", title: t("common.error") });
    }
  };

  const handleExportHtml = async (nb: NotebookMetadata) => {
    if (!connectionId) return;
    try {
      const state = await loadNotebook(nb.id, connectionId);
      const html = exportNotebookToHtml(nb.title, state.cells);
      const safeName = nb.title.replace(/[^a-zA-Z0-9_-]/g, "_");
      const target = await save({
        defaultPath: `${safeName}.html`,
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!target) return;
      await writeTextFile(target, html);
      showAlert(t("editor.notebook.exportSuccess"), { kind: "info" });
    } catch (e) {
      showAlert(String(e), { kind: "error", title: t("common.error") });
    }
  };

  const handleImport = async () => {
    if (!connectionId) return;
    const filePath = await open({
      filters: [
        { name: "Tabularis Notebook", extensions: ["tabularis-notebook"] },
      ],
    });
    if (!filePath || typeof filePath !== "string") return;
    try {
      const content = await readTextFile(filePath);
      const { title, cells, params, stopOnError } =
        deserializeNotebook(content);
      const { notebookId } = await createNotebookFromState(
        title,
        { cells, params, stopOnError },
        connectionId,
      );
      showAlert(t("editor.notebook.importSuccess"), { kind: "info" });
      // createNotebookFromState emits NOTEBOOKS_CHANGED_EVENT → reload().
      onOpen({ id: notebookId, title });
    } catch {
      showAlert(t("editor.notebook.invalidFile"), { kind: "error" });
    }
  };

  const contextMenuItems = (nb: NotebookMetadata): ContextMenuItem[] => [
    {
      label: t("sidebar.notebooks.rename"),
      icon: Pencil,
      action: () => startRename(nb),
    },
    {
      label: t("editor.notebook.export"),
      icon: Download,
      action: () => handleExport(nb),
    },
    {
      label: t("editor.notebook.exportHtml"),
      icon: FileCode,
      action: () => handleExportHtml(nb),
    },
    {
      label: t("editor.notebook.import"),
      icon: Upload,
      action: () => handleImport(),
    },
    { separator: true },
    {
      label: t("sidebar.notebooks.delete"),
      icon: Trash2,
      danger: true,
      action: () => setPendingDelete(nb),
    },
  ];

  return (
    <div className="animate-fade-in">
      <div className="px-2 pb-1.5 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("sidebar.notebooks.search")}
            className="w-full pl-6 pr-2 py-1 text-xs bg-surface-secondary border border-default rounded text-primary placeholder:text-muted focus:outline-none focus:border-blue-500/50"
          />
        </div>
        <button
          onClick={handleImport}
          disabled={!connectionId}
          className="p-1.5 text-muted hover:text-secondary rounded transition-colors shrink-0 disabled:opacity-40"
          title={t("editor.notebook.import")}
        >
          <Upload size={12} />
        </button>
        <button
          onClick={reload}
          className="p-1.5 text-muted hover:text-secondary rounded transition-colors shrink-0"
          title={t("sidebar.notebooks.refresh")}
        >
          <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-20 text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : notebooks.length === 0 ? (
        <div className="text-center p-4 text-xs text-muted italic">
          {t("sidebar.notebooks.empty")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center p-2 text-xs text-muted italic">
          {t("sidebar.notebooks.noSearchResults")}
        </div>
      ) : (
        filtered.map((nb) => (
          <div
            key={nb.id}
            onDoubleClick={() => editingId !== nb.id && onOpen(nb)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, nb });
            }}
            className="pl-3 pr-2 py-1.5 cursor-pointer group transition-colors border-b border-default/30 hover:bg-surface-secondary"
            title={nb.title}
          >
            {editingId === nb.id ? (
              <input
                type="text"
                value={editingTitle}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingId(null);
                }}
                placeholder={t("sidebar.notebooks.renamePlaceholder")}
                className="w-full px-1.5 py-0.5 text-[13px] bg-base border border-blue-500/50 rounded text-primary focus:outline-none"
              />
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <BookOpen size={12} className="text-orange-400 shrink-0" />
                  <span className="text-[13px] font-medium text-primary truncate tracking-tight">
                    {nb.title}
                  </span>
                  {openNotebookIds.has(nb.id) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                  )}
                </div>
                {nb.updatedAt && (
                  <span className="text-[10px] text-muted shrink-0">
                    {formatHistoryTime(nb.updatedAt, settings.displayTimezone)}
                  </span>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems(contextMenu.nb)}
          onClose={() => setContextMenu(null)}
        />
      )}

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t("sidebar.notebooks.delete")}
        message={t("sidebar.notebooks.deleteConfirm", {
          title: pendingDelete?.title ?? "",
        })}
        onConfirm={confirmDelete}
        variant="danger"
      />
    </div>
  );
}
