import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NewConnectionModal } from "../components/modals/NewConnectionModal";
import { ConfirmModal } from "../components/modals/ConfirmModal";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import {
  Database,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
  Search,
  X,
  LayoutGrid,
  List,
  FolderPlus,
  Folder,
  Download,
  Upload,
} from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { useDrivers } from "../hooks/useDrivers";
import clsx from "clsx";
import { ContextMenu } from "../components/ui/ContextMenu";
import type { SavedConnection } from "../contexts/DatabaseContext";
import { hasConnectionMenuItems } from "../utils/connections";
import { toErrorMessage } from "../utils/errors";
import { GroupHeader } from "../components/connections/GroupHeader";
import { ConnectionCard } from "../components/connections/ConnectionCard";
import { ConnectionListItem } from "../components/connections/ConnectionListItem";

export const Connections = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    connect,
    disconnect,
    isConnectionOpen,
    switchConnection,
    connectionGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    moveConnectionToGroup,
    reorderGroups,
    toggleGroupCollapsed,
    loadConnections,
    connections: contextConnections,
  } = useDatabase();
  const { drivers, allDrivers } = useDrivers();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] =
    useState<SavedConnection | null>(null);
  const connections = contextConnections as SavedConnection[];
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [groupContextMenu, setGroupContextMenu] = useState<{
    x: number;
    y: number;
    groupId: string;
  } | null>(null);
  const [connectionContextMenu, setConnectionContextMenu] = useState<{
    x: number;
    y: number;
    connId: string;
  } | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    confirmClassName?: string;
    variant?: "danger" | "warning" | "info";
    onConfirm: () => void;
  } | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const isRenameCancelledRef = useRef(false);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  // Initialize collapsed groups from saved state
  useEffect(() => {
    const collapsed = new Set(
      connectionGroups.filter((g) => g.collapsed).map((g) => g.id),
    );
    setCollapsedGroups(collapsed);
  }, [connectionGroups]);

  // Sort groups by sort_order
  const sortedGroups = useMemo(
    () => [...connectionGroups].sort((a, b) => a.sort_order - b.sort_order),
    [connectionGroups],
  );

  // Organize connections by group
  const { groupedConnections, ungroupedConnections } = useMemo(() => {
    const grouped: Record<string, SavedConnection[]> = {};
    const ungrouped: SavedConnection[] = [];

    for (const conn of connections) {
      if (conn.group_id) {
        if (!grouped[conn.group_id]) {
          grouped[conn.group_id] = [];
        }
        grouped[conn.group_id].push(conn);
      } else {
        ungrouped.push(conn);
      }
    }

    // Sort connections within each group by sort_order
    for (const groupId in grouped) {
      grouped[groupId].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      );
    }
    ungrouped.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    return { groupedConnections: grouped, ungroupedConnections: ungrouped };
  }, [connections]);

  // Group management functions
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await createGroup(newGroupName.trim());
      setNewGroupName("");
      setIsCreatingGroup(false);
      await loadConnections();
    } catch (e) {
      console.error("Failed to create group:", e);
      setError(t("groups.createError"));
    }
  };

  const handleToggleGroupCollapsed = async (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
    await toggleGroupCollapsed(groupId);
  };

  const handleExport = async () => {
    setConfirmModal({
      title: t("connections.exportTitle"),
      message: t("connections.exportWarning"),
      confirmLabel: t("common.save"),
      variant: "warning",
      confirmClassName: "px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors",
      onConfirm: async () => {
        try {
          const payload = await invoke("export_connections_payload");
          const path = await save({
            defaultPath: "tabularis-connections.json",
            filters: [{ name: "JSON", extensions: ["json"] }],
          });
          if (path) {
            await writeTextFile(path, JSON.stringify(payload, null, 2));
          }
        } catch (e) {
          console.error("Export failed:", e);
          setError(toErrorMessage(e));
        }
      },
    });
  };

  const handleImport = async () => {
    try {
      const selected = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (selected && !Array.isArray(selected)) {
        const content = await readTextFile(selected);
        const payload = JSON.parse(content);
        await invoke("import_connections_payload", { payload });
        await loadConnections();
      }
    } catch (e) {
      console.error("Import failed:", e);
      setError(toErrorMessage(e));
    }
  };

  const handleRenameGroup = async (groupId: string) => {
    if (!editGroupName.trim()) return;
    try {
      await updateGroup(groupId, { name: editGroupName.trim() });
      setEditingGroupId(null);
      await loadConnections();
    } catch (e) {
      console.error("Failed to rename group:", e);
      setError(t("groups.renameError", { defaultValue: "Failed to rename group" }) + `: ${toErrorMessage(e)}`);
    }
  };

  const handleDeleteGroup = (groupId: string) => {
    const group = connectionGroups.find((g) => g.id === groupId);
    setConfirmModal({
      title: t("groups.deleteTitle"),
      message: t("groups.deleteConfirm", { name: group?.name }),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await deleteGroup(groupId);
          await loadConnections();
        } catch (e) {
          console.error("Failed to delete group:", e);
          setError(t("groups.deleteError", { defaultValue: "Failed to delete group" }) + `: ${toErrorMessage(e)}`);
        }
      },
    });
  };

  const handleMoveToGroup = async (
    connectionId: string,
    groupId: string | null,
  ) => {
    try {
      await moveConnectionToGroup(connectionId, groupId);
      await loadConnections();
    } catch (e) {
      console.error("Failed to move connection:", e);
      setError(t("groups.moveError", { defaultValue: "Failed to move connection" }) + `: ${toErrorMessage(e)}`);
    }
  };

  useEffect(() => {
    if ((location.state as { openNew?: boolean } | null)?.openNew) {
      setEditingConnection(null);
      setIsModalOpen(true);
    }
  }, [location.state]);

  const handleSave = () => {
    void loadConnections();
    setIsModalOpen(false);
    setEditingConnection(null);
  };

  const handleConnect = async (conn: SavedConnection) => {
    setError(null);
    if (isConnectionOpen(conn.id)) {
      switchConnection(conn.id);
      navigate("/editor");
      return;
    }
    setConnectingId(conn.id);
    try {
      await connect(conn.id);
      navigate("/editor");
    } catch (e) {
      setError(
        `${t("connections.failConnect", { name: conn.name })}\n\nError: ${toErrorMessage(e)}`,
      );
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (connId: string) => {
    setError(null);
    try {
      await disconnect(connId);
    } catch (e) {
      setError(`${t("connections.failDisconnect")}\n\nError: ${toErrorMessage(e)}`);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmModal({
      title: t("connections.deleteTitle"),
      message: t("connections.confirmDelete"),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          if (isConnectionOpen(id)) await disconnect(id);
          await invoke("delete_connection", { id });
          void loadConnections();
        } catch (e) {
          console.error(e);
        }
      },
    });
  };

  const openEdit = async (conn: SavedConnection) => {
    if (isConnectionOpen(conn.id)) {
      await disconnect(conn.id);
    }
    setEditingConnection(conn);
    setIsModalOpen(true);
  };

  const handleDuplicate = async (id: string) => {
    try {
      const newConn = await invoke<SavedConnection>("duplicate_connection", {
        id,
      });
      await loadConnections();
      void openEdit(newConn);
    } catch (e) {
      console.error(e);
      setError(t("connections.failDuplicate"));
    }
  };

  // Filter grouped/ungrouped based on search
  const filteredGroupedConnections = useMemo(() => {
    if (!search.trim()) return groupedConnections;
    const result: Record<string, SavedConnection[]> = {};
    for (const groupId in groupedConnections) {
      const filteredConns = groupedConnections[groupId].filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.params.driver.toLowerCase().includes(search.toLowerCase()),
      );
      if (filteredConns.length > 0) {
        result[groupId] = filteredConns;
      }
    }
    return result;
  }, [groupedConnections, search]);

  const filteredUngroupedConnections = useMemo(() => {
    if (!search.trim()) return ungroupedConnections;
    return ungroupedConnections.filter(
      (c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.params.driver.toLowerCase().includes(search.toLowerCase()),
    );
  }, [ungroupedConnections, search]);

  const openCount = connections.filter((c) => isConnectionOpen(c.id)).length;

  // ── Shared helpers for connection card/item rendering ────────────────────────
  const handleConnContextMenu = (
    e: React.MouseEvent,
    conn: SavedConnection,
  ) => {
    e.preventDefault();
    if (!hasConnectionMenuItems(sortedGroups, conn.group_id)) return;
    setConnectionContextMenu({ x: e.clientX, y: e.clientY, connId: conn.id });
  };

  const connCardProps = (conn: SavedConnection) => ({
    conn,
    connectingId,
    allDrivers,
    enabledDrivers: drivers,
    onConnect: () => handleConnect(conn),
    onDisconnect: () => handleDisconnect(conn.id),
    onEdit: () => void openEdit(conn),
    onDuplicate: () => handleDuplicate(conn.id),
    onDelete: () => handleDelete(conn.id),
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) =>
      handleConnContextMenu(e, conn),
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) =>
      handleConnectionMouseDown(e, conn.id, conn.group_id),
  });

  const handleConnectionMouseDown = (e: React.MouseEvent, connId: string, currentGroupId: string | undefined) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (dx * dx + dy * dy < 25) return;
        isDragging = true;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const groupEl = (el as HTMLElement)?.closest("[data-group-id]") as HTMLElement | null;
      setDragOverGroupId(groupEl?.dataset.groupId ?? null);
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (!isDragging) {
        setDragOverGroupId(null);
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const groupEl = (el as HTMLElement)?.closest("[data-group-id]") as HTMLElement | null;
      const targetGroupId = groupEl?.dataset.groupId ?? null;
      setDragOverGroupId(null);
      if (!targetGroupId || targetGroupId === currentGroupId) return;
      void handleMoveToGroup(connId, targetGroupId);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const handleGripMouseDown = (e: React.MouseEvent, sourceGroupId: string) => {
    e.preventDefault();
    setDraggingGroupId(sourceGroupId);

    const onMouseMove = (ev: MouseEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const groupEl = (el as HTMLElement)?.closest("[data-group-id]") as HTMLElement | null;
      const targetId = groupEl?.dataset.groupId ?? null;
      setDragOverGroupId(targetId !== sourceGroupId ? targetId : null);
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const groupEl = (el as HTMLElement)?.closest("[data-group-id]") as HTMLElement | null;
      const targetGroupId = groupEl?.dataset.groupId ?? null;
      setDraggingGroupId(null);
      setDragOverGroupId(null);
      if (!targetGroupId || targetGroupId === sourceGroupId) return;
      const newOrder = [...sortedGroups];
      const fromIdx = newOrder.findIndex((g) => g.id === sourceGroupId);
      const toIdx = newOrder.findIndex((g) => g.id === targetGroupId);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, moved);
      void reorderGroups(newOrder.map((g, i) => [g.id, i]));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const groupHeaderProps = (group: (typeof sortedGroups)[number]) => ({
    group,
    isCollapsed: collapsedGroups.has(group.id),
    editingGroupId,
    editGroupName,
    isRenameCancelledRef,
    onToggleCollapse: () => void handleToggleGroupCollapsed(group.id),
    onOpenContextMenu: (x: number, y: number, groupId: string) =>
      setGroupContextMenu({ x, y, groupId }),
    setEditGroupName,
    setEditingGroupId,
    onRenameConfirm: handleRenameGroup,
    onGripMouseDown: (e: React.MouseEvent) => handleGripMouseDown(e, group.id),
    isDragOver: dragOverGroupId === group.id && draggingGroupId !== group.id,
  });

  return (
    <div className="h-full flex flex-col overflow-hidden bg-base">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="relative flex items-center justify-between px-8 pt-7 pb-6 border-b border-default bg-elevated shrink-0 overflow-hidden">
        {/* Decorative gradients */}
        <div className="absolute top-0 right-0 w-72 h-full bg-gradient-to-bl from-blue-600/10 via-blue-600/3 to-transparent pointer-events-none" />
        <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-indigo-600/6 to-transparent pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-1.5 mb-2">
            <Database size={12} className="text-blue-400" />
            <span className="text-[10px] font-bold text-blue-400/80 uppercase tracking-[0.15em]">
              Database Manager
            </span>
          </div>
          <h1 className="text-xl font-bold text-primary tracking-tight">
            {t("connections.title")}
          </h1>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs text-muted">
              {connections.length === 0
                ? t("connections.noConnections")
                : t("connections.connectionCount", {
                    count: connections.length,
                  })}
            </span>
            {openCount > 0 && (
              <>
                <span className="w-1 h-1 rounded-full bg-default" />
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  {openCount} active
                </span>
              </>
            )}
          </div>
        </div>

        <button
          onClick={() => {
            setEditingConnection(null);
            setIsModalOpen(true);
          }}
          className="relative flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:-translate-y-px"
        >
          <Plus size={15} />
          {t("connections.addConnection")}
        </button>
      </div>

      {/* ── Error banner ──────────────────────────────────────────────────── */}
      {error && (
        <div className="mx-6 mt-4 p-3.5 bg-red-900/20 border border-red-900/40 rounded-xl flex items-start gap-3 text-red-400 shrink-0">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="text-sm whitespace-pre-wrap flex-1 leading-relaxed">
            {error}
          </span>
          <button
            onClick={() => setError(null)}
            className="text-red-400/50 hover:text-red-400 transition-colors shrink-0 mt-0.5"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {connections.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-elevated border border-default flex items-center justify-center shadow-sm">
                <Database size={32} className="text-muted" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg">
                <Plus size={14} className="text-white" />
              </div>
            </div>
            <p className="text-base font-bold text-primary mb-1.5">
              {t("connections.noConnections")}
            </p>
            <p className="text-sm text-muted mb-6 max-w-xs leading-relaxed">
              {t("connections.noConnectionsHint")}
            </p>
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => {
                  setEditingConnection(null);
                  setIsModalOpen(true);
                }}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 hover:-translate-y-px"
              >
                <Plus size={14} />
                {t("connections.createFirst")}
              </button>
              <button
                onClick={handleImport}
                className="flex items-center gap-2 bg-elevated border border-strong hover:border-blue-500/50 text-secondary hover:text-blue-400 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all hover:-translate-y-px"
              >
                <Upload size={14} />
                {t("connections.import")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Toolbar: search + new group + view toggle ─────────────────── */}
            <div className="flex items-center gap-3 mb-5">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("connections.searchPlaceholder")}
                  className="w-full pl-10 pr-9 py-2.5 bg-elevated border border-strong rounded-xl text-sm text-primary placeholder:text-muted focus:border-blue-500/70 focus:outline-none transition-colors"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* New Group button or input */}
              {isCreatingGroup ? (
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCreateGroup();
                      if (e.key === "Escape") {
                        setIsCreatingGroup(false);
                        setNewGroupName("");
                      }
                    }}
                    placeholder={t("groups.groupName")}
                    autoFocus
                    className="w-40 px-3 py-2 bg-elevated border border-strong rounded-xl text-sm text-primary placeholder:text-muted focus:border-amber-500/70 focus:outline-none transition-colors"
                  />
                  <button
                    onClick={() => void handleCreateGroup()}
                    disabled={!newGroupName.trim()}
                    className="p-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setIsCreatingGroup(false);
                      setNewGroupName("");
                    }}
                    className="p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreatingGroup(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-elevated border border-strong rounded-xl text-sm text-muted hover:text-amber-400 hover:border-amber-500/50 transition-colors shrink-0"
                  title={t("groups.newGroup")}
                >
                  <FolderPlus size={14} />
                  <span className="hidden sm:inline">
                    {t("groups.newGroup")}
                  </span>
                </button>
              )}

              {/* Export/Import buttons */}
              <div className="flex items-center gap-1.5 px-1 py-1 bg-elevated border border-strong rounded-xl shrink-0">
                <button
                  onClick={handleImport}
                  className="p-1.5 rounded-lg text-muted hover:text-blue-400 hover:bg-blue-500/10 transition-all duration-150"
                  title={t("connections.import")}
                >
                  <Upload size={14} />
                </button>
                <button
                  onClick={handleExport}
                  className="p-1.5 rounded-lg text-muted hover:text-blue-400 hover:bg-blue-500/10 transition-all duration-150"
                  title={t("connections.export")}
                >
                  <Download size={14} />
                </button>
              </div>

              {/* View toggle */}
              <div className="flex items-center gap-0.5 bg-elevated border border-strong rounded-xl p-1 shrink-0">
                <button
                  onClick={() => setViewMode("grid")}
                  className={clsx(
                    "p-1.5 rounded-lg transition-all duration-150",
                    viewMode === "grid"
                      ? "bg-blue-500/15 text-blue-400 shadow-sm"
                      : "text-muted hover:text-secondary hover:bg-surface-secondary",
                  )}
                  title={t("connections.gridView")}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={clsx(
                    "p-1.5 rounded-lg transition-all duration-150",
                    viewMode === "list"
                      ? "bg-blue-500/15 text-blue-400 shadow-sm"
                      : "text-muted hover:text-secondary hover:bg-surface-secondary",
                  )}
                  title={t("connections.listView")}
                >
                  <List size={15} />
                </button>
              </div>
            </div>

            {/* ── Grid view ─────────────────────────────────────────────── */}
            {viewMode === "grid" ? (
              <div className="space-y-6">
                {sortedGroups.map((group) => {
                  const groupConns = filteredGroupedConnections[group.id] || [];
                  if (groupConns.length === 0 && search.trim()) return null;
                  return (
                    <div
                      key={group.id}
                      data-group-id={group.id}
                      className="space-y-3"
                    >
                      <GroupHeader
                        {...groupHeaderProps(group)}
                        connCount={groupConns.length}
                      />
                      {!collapsedGroups.has(group.id) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pl-6">
                          {groupConns.map((conn) => (
                            <ConnectionCard
                              key={conn.id}
                              {...connCardProps(conn)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredUngroupedConnections.length > 0 && (
                  <div className="space-y-3">
                    {sortedGroups.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted">
                          {t("groups.ungrouped")}
                        </span>
                        <span className="text-xs text-muted">
                          ({filteredUngroupedConnections.length})
                        </span>
                      </div>
                    )}
                    <div
                      className={clsx(
                        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3",
                        sortedGroups.length > 0 && "pl-6",
                      )}
                    >
                      {filteredUngroupedConnections.map((conn) => (
                        <ConnectionCard
                          key={conn.id}
                          {...connCardProps(conn)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(filteredGroupedConnections).length === 0 &&
                  filteredUngroupedConnections.length === 0 &&
                  search && (
                    <div className="text-center py-12 text-sm text-muted">
                      {t("connections.noSearchResults", { query: search })}
                    </div>
                  )}
              </div>
            ) : (
              /* ── List view ──────────────────────────────────────────────── */
              <div className="space-y-6">
                {sortedGroups.map((group) => {
                  const groupConns = filteredGroupedConnections[group.id] || [];
                  if (groupConns.length === 0 && search.trim()) return null;
                  return (
                    <div
                      key={group.id}
                      data-group-id={group.id}
                      className="space-y-2"
                    >
                      <GroupHeader
                        {...groupHeaderProps(group)}
                        connCount={groupConns.length}
                      />
                      {!collapsedGroups.has(group.id) && (
                        <div className="flex flex-col gap-1.5 pl-6">
                          {groupConns.map((conn) => (
                            <ConnectionListItem
                              key={conn.id}
                              {...connCardProps(conn)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredUngroupedConnections.length > 0 && (
                  <div className="space-y-2">
                    {sortedGroups.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted">
                          {t("groups.ungrouped")}
                        </span>
                        <span className="text-xs text-muted">
                          ({filteredUngroupedConnections.length})
                        </span>
                      </div>
                    )}
                    <div
                      className={clsx(
                        "flex flex-col gap-1.5",
                        sortedGroups.length > 0 && "pl-6",
                      )}
                    >
                      {filteredUngroupedConnections.map((conn) => (
                        <ConnectionListItem
                          key={conn.id}
                          {...connCardProps(conn)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(filteredGroupedConnections).length === 0 &&
                  filteredUngroupedConnections.length === 0 &&
                  search && (
                    <div className="text-center py-12 text-sm text-muted">
                      {t("connections.noSearchResults", { query: search })}
                    </div>
                  )}
              </div>
            )}
          </>
        )}
      </div>

      <NewConnectionModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingConnection(null);
        }}
        onSave={handleSave}
        initialConnection={editingConnection}
      />
      <ConfirmModal
        isOpen={confirmModal !== null}
        onClose={() => setConfirmModal(null)}
        title={confirmModal?.title ?? ""}
        message={confirmModal?.message ?? ""}
        confirmLabel={confirmModal?.confirmLabel}
        confirmClassName={confirmModal?.confirmClassName}
        variant={confirmModal?.variant}
        onConfirm={() => {
          confirmModal?.onConfirm();
          setConfirmModal(null);
        }}
      />

      {/* Group context menu */}
      {groupContextMenu && (
        <ContextMenu
          x={groupContextMenu.x}
          y={groupContextMenu.y}
          items={[
            {
              label: t("groups.rename"),
              icon: Edit,
              action: () => {
                const group = connectionGroups.find(
                  (g) => g.id === groupContextMenu.groupId,
                );
                if (group) {
                  setEditGroupName(group.name);
                  setEditingGroupId(groupContextMenu.groupId);
                }
              },
            },
            { separator: true as const },
            {
              label: t("groups.delete"),
              icon: Trash2,
              action: () => handleDeleteGroup(groupContextMenu.groupId),
              danger: true,
            },
          ]}
          onClose={() => setGroupContextMenu(null)}
        />
      )}

      {/* Connection context menu for moving to groups */}
      {connectionContextMenu &&
        (() => {
          const conn = connections.find(
            (c) => c.id === connectionContextMenu.connId,
          );
          const currentGroupId = conn?.group_id;
          const isInGroup = !!currentGroupId;
          const availableGroups = sortedGroups.filter(
            (g) => g.id !== currentGroupId,
          );
          return (
            <ContextMenu
              x={connectionContextMenu.x}
              y={connectionContextMenu.y}
              items={[
                ...availableGroups.map((group) => ({
                  label: group.name,
                  icon: Folder,
                  action: () =>
                    void handleMoveToGroup(
                      connectionContextMenu.connId,
                      group.id,
                    ),
                })),
                ...(isInGroup
                  ? [
                      ...(availableGroups.length > 0
                        ? [{ separator: true as const }]
                        : []),
                      {
                        label: t("groups.removeFromGroup"),
                        icon: X,
                        action: () =>
                          void handleMoveToGroup(
                            connectionContextMenu.connId,
                            null,
                          ),
                      },
                    ]
                  : []),
              ]}
              onClose={() => setConnectionContextMenu(null)}
            />
          );
        })()}
    </div>
  );
};
