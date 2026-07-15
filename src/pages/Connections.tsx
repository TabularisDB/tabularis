import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NewConnectionModal } from "../components/modals/NewConnectionModal";
import { ConfirmModal } from "../components/modals/ConfirmModal";
import {
  ExportConnectionsModal,
  type ExportMode,
} from "../components/modals/ExportConnectionsModal";
import { ImportFromAppModal } from "../components/modals/ImportFromAppModal";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Database,
  Plus,
  Edit,
  Trash2,
  Search,
  X,
  LayoutGrid,
  List,
  FolderPlus,
  Folder,
  Download,
  FolderInput,
  FolderTree,
  ChevronDown,
  AppWindow,
} from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { useDrivers } from "../hooks/useDrivers";
import { useSettings } from "../hooks/useSettings";
import clsx from "clsx";
import { ContextMenu } from "../components/ui/ContextMenu";
import type { SavedConnection } from "../contexts/DatabaseContext";
import { flattenGroupTree } from "../utils/groupTree";
import { toErrorMessage } from "../utils/errors";
import { fuzzyFilter } from "../utils/fuzzy";
import { useOpenConnectionInNewWindow } from "../hooks/useOpenConnectionInNewWindow";
import { GroupHeader } from "../components/connections/GroupHeader";
import { ConnectionCard } from "../components/connections/ConnectionCard";
import { ConnectionListItem } from "../components/connections/ConnectionListItem";
import { ConnectionErrorBanner } from "../components/ConnectionErrorBanner";
import { BetaBadge } from "../components/ui/BetaBadge";

let autoConnectAttempted = false;

export const Connections = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    connect,
    disconnect,
    isConnectionOpen,
    isConnectionOpenAnywhere,
    switchConnection,
    connectionGroups,
    createGroupPath,
    updateGroup,
    moveGroupToParent,
    deleteGroup,
    moveConnectionToGroup,
    reorderGroups,
    toggleGroupCollapsed,
    loadConnections,
    connections: contextConnections,
  } = useDatabase();
  const { drivers, allDrivers } = useDrivers();
  const openConnectionInNewWindow = useOpenConnectionInNewWindow();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportAppModalOpen, setIsImportAppModalOpen] = useState(false);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const importMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [importMenuPos, setImportMenuPos] = useState({ top: 0, right: 0 });

  // The header clips its overflow, so the dropup menu is portaled to the body
  // and positioned just under the trigger button.
  const toggleImportMenu = () => {
    if (!isImportMenuOpen && importMenuBtnRef.current) {
      const rect = importMenuBtnRef.current.getBoundingClientRect();
      setImportMenuPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    setIsImportMenuOpen((v) => !v);
  };
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
  const [subgroupInputFor, setSubgroupInputFor] = useState<string | null>(null);
  const [subgroupInputValue, setSubgroupInputValue] = useState("");
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    confirmClassName?: string;
    variant?: "danger" | "warning" | "info";
    onConfirm: () => void;
  } | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportSelectionOnly, setExportSelectionOnly] = useState(false);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const isRenameCancelledRef = useRef(false);
  // Multi-select for bulk actions (delete / move to group)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveMenu, setBulkMoveMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (autoConnectAttempted) return;
    if (connections.length === 0) return;
    if (settings.autoConnectLastConnection === false) return;
    autoConnectAttempted = true;
    void (async () => {
      try {
        const [openIds, activeId] = await Promise.all([
          invoke<string[]>("get_last_open_connections"),
          invoke<string | null>("get_last_active_connection"),
        ]);
        const toRestore = (openIds ?? []).filter(
          (id) => connections.some((c) => c.id === id) && !isConnectionOpen(id),
        );
        if (toRestore.length === 0) return;
        const connected: string[] = [];
        for (const id of toRestore) {
          setConnectingId(id);
          try {
            await connect(id);
            connected.push(id);
          } catch (e) {
            console.error(`Auto-connect to connection ${id} failed:`, e);
          }
        }
        if (connected.length === 0) return;
        const target =
          activeId && connected.includes(activeId)
            ? activeId
            : connected[connected.length - 1];
        switchConnection(target);
        navigate("/editor");
      } catch (e) {
        console.error("Auto-connect to last connections failed:", e);
      } finally {
        setConnectingId(null);
      }
    })();
  }, [
    connections,
    settings.autoConnectLastConnection,
    isConnectionOpen,
    connect,
    switchConnection,
    navigate,
  ]);

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

  // parentId -> children, with null key for top-level groups
  const groupsByParent = useMemo(() => {
    const map = new Map<string | null, typeof connectionGroups>();
    for (const g of connectionGroups) {
      const key = g.parent_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(g);
      map.set(key, arr);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.sort_order - b.sort_order);
    }
    return map;
  }, [connectionGroups]);

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
  const handleCreateGroup = async (parentId?: string | null) => {
    if (!newGroupName.trim()) return;
    try {
      // `/` separates nested levels: "TEST/flexways" creates `flexways`
      // inside the existing `TEST` group, or both if TEST doesn't exist.
      await createGroupPath(newGroupName.trim(), parentId ?? null);
      setNewGroupName("");
      setIsCreatingGroup(false);
      await loadConnections();
    } catch (e) {
      console.error("Failed to create group:", e);
      setError(t("groups.createError"));
    }
  };

  const handleCreateSubgroup = async (parentGroupId: string) => {
    const name = window.prompt(
      t("groups.subgroupNamePrompt", { defaultValue: "Subfolder name (use / for nested levels)" }),
    );
    if (!name || !name.trim()) return;
    try {
      await createGroupPath(name.trim(), parentGroupId);
      await loadConnections();
    } catch (e) {
      console.error("Failed to create subgroup:", e);
      setError(t("groups.createError"));
    }
  };

  const startInlineSubgroupInput = (parentGroupId: string) => {
    setSubgroupInputFor(parentGroupId);
    setSubgroupInputValue("");
  };

  const cancelInlineSubgroupInput = () => {
    setSubgroupInputFor(null);
    setSubgroupInputValue("");
  };

  const confirmInlineSubgroupInput = async () => {
    if (!subgroupInputFor) return;
    const name = subgroupInputValue.trim();
    if (!name) {
      cancelInlineSubgroupInput();
      return;
    }
    try {
      await createGroupPath(name, subgroupInputFor);
      cancelInlineSubgroupInput();
      await loadConnections();
    } catch (e) {
      console.error("Failed to create subgroup:", e);
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

  const handleExport = async (mode: ExportMode, password?: string) => {
    try {
      const payload = await invoke("export_connections_payload", {
        includeSecrets: mode !== "noSecrets",
        connectionIds:
          exportSelectionOnly && selectedIds.size > 0
            ? [...selectedIds]
            : null,
      });
      const fileContent =
        mode === "encrypted"
          ? await invoke("encrypt_export_payload", { payload, password })
          : payload;
      const path = await save({
        defaultPath: "tabularis-connections.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) {
        await writeTextFile(path, JSON.stringify(fileContent, null, 2));
      }
    } catch (e) {
      console.error("Export failed:", e);
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

  // ── Multi-select bulk actions ────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkDelete = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setConfirmModal({
      title: t("connections.deleteSelectedTitle"),
      message: t("connections.confirmDeleteSelected", { count: ids.length }),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          for (const id of ids) {
            if (isConnectionOpenAnywhere(id)) await disconnect(id);
            await invoke("delete_connection", { id });
          }
        } catch (e) {
          console.error(e);
        } finally {
          clearSelection();
          void loadConnections();
        }
      },
    });
  };

  const handleBulkMoveToGroup = async (groupId: string | null) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      for (const id of ids) {
        await moveConnectionToGroup(id, groupId);
      }
      await loadConnections();
    } catch (e) {
      console.error("Failed to move connections:", e);
      setError(t("groups.moveError", { defaultValue: "Failed to move connection" }) + `: ${toErrorMessage(e)}`);
    } finally {
      clearSelection();
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
    // Open in another window: focus that window instead of opening a duplicate.
    if (isConnectionOpenAnywhere(conn.id)) {
      await openConnectionInNewWindow(conn.id, conn.name);
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

  const handleOpenInNewWindow = async (conn: SavedConnection) => {
    setError(null);
    setConnectingId(conn.id);
    try {
      // Validates connectivity before the window is spawned; only opens on success.
      await openConnectionInNewWindow(conn.id, conn.name);
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
          if (isConnectionOpenAnywhere(id)) await disconnect(id);
          await invoke("delete_connection", { id });
          void loadConnections();
        } catch (e) {
          console.error(e);
        }
      },
    });
  };

  const openEdit = async (conn: SavedConnection) => {
    if (isConnectionOpenAnywhere(conn.id)) {
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
      const filteredConns = fuzzyFilter(
        groupedConnections[groupId],
        search,
        (c) => `${c.name} ${c.params.driver}`,
      );
      if (filteredConns.length > 0) {
        result[groupId] = filteredConns;
      }
    }
    return result;
  }, [groupedConnections, search]);

  const filteredUngroupedConnections = useMemo(() => {
    return fuzzyFilter(
      ungroupedConnections,
      search,
      (c) => `${c.name} ${c.params.driver}`,
    );
  }, [ungroupedConnections, search]);

  const openCount = connections.filter((c) => isConnectionOpenAnywhere(c.id)).length;
  // Connections open in THIS window — gates the "Open in New Window" action,
  // which detaches an open connection from the current window.
  const hasLocalOpenConnections = connections.some((c) => isConnectionOpen(c.id));

  // ── Shared helpers for connection card/item rendering ────────────────────────
  const handleConnContextMenu = (
    e: React.MouseEvent,
    conn: SavedConnection,
  ) => {
    e.preventDefault();
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
    selected: selectedIds.has(conn.id),
    selectionActive: selectedIds.size > 0,
    onToggleSelect: () => toggleSelect(conn.id),
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

      // Drop right of target's left edge => re-parent as child; else reorder
      const targetEl = document.querySelector(
        `[data-group-id="${targetGroupId}"]`,
      ) as HTMLElement | null;
      let reparent = false;
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const indentStep = 16;
        reparent = ev.clientX > rect.left + indentStep;
      }

      if (reparent) {
        const isAncestor = (maybeAncestorId: string): boolean => {
          let cur = connectionGroups.find((g) => g.id === maybeAncestorId);
          while (cur) {
            if (cur.id === sourceGroupId) return true;
            cur = connectionGroups.find((g) => g.id === cur!.parent_id);
          }
          return false;
        };
        // Reject only genuine cycles: dropping a group into one of its own
        // descendants. Re-parenting an already-nested group elsewhere is fine.
        if (isAncestor(targetGroupId)) {
          setError(
            t("groups.cannotMoveIntoDescendant", {
              defaultValue: "Cannot move a group into one of its own subfolders",
            }),
          );
          return;
        }
        void moveGroupToParent(sourceGroupId, targetGroupId).catch((err) => {
          console.error("Failed to move group:", err);
          setError(String(err));
        });
        return;
      }

      // Same-depth reorder
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
    onCreateSubgroup: startInlineSubgroupInput,
  });

  const renderGroupTree = (
    parentId: string | null,
    mode: "grid" | "list",
    depth: number = 0,
  ): React.ReactNode => {
    const children = groupsByParent.get(parentId) ?? [];
    if (children.length === 0) return null;
    return children.map((group) => {
      const groupConns = filteredGroupedConnections[group.id] || [];
      const isCollapsed = collapsedGroups.has(group.id);
      if (search.trim() && !hasAnyMatchingDescendant(group.id, search)) {
        return null;
      }
      const indentPx = Math.min(depth, 6) * 16;
      const connCount = countDescendantConnections(group.id);
      return (
        <div
          key={group.id}
          data-group-id={group.id}
          data-group-depth={depth}
          className={mode === "grid" ? "space-y-3" : "space-y-2"}
        >
          <GroupHeader
            {...groupHeaderProps(group)}
            connCount={connCount}
            depth={depth}
          />
          {subgroupInputFor === group.id && (
            <div
              className="flex items-center gap-2"
              style={{ paddingLeft: 24 + indentPx }}
              onClick={(e) => e.stopPropagation()}
            >
              <FolderPlus size={12} className="text-amber-400 shrink-0" />
              <input
                type="text"
                value={subgroupInputValue}
                onChange={(e) => setSubgroupInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmInlineSubgroupInput();
                  if (e.key === "Escape") cancelInlineSubgroupInput();
                }}
                onBlur={() => {
                  if (subgroupInputValue.trim()) {
                    void confirmInlineSubgroupInput();
                  } else {
                    cancelInlineSubgroupInput();
                  }
                }}
                placeholder="Subfolder name (use / for nested)"
                autoFocus
                className="flex-1 px-2 py-1 bg-elevated border border-strong rounded text-sm text-primary placeholder:text-muted focus:border-amber-500/70 focus:outline-none"
              />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void confirmInlineSubgroupInput()}
                disabled={!subgroupInputValue.trim()}
                className="p-1 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Plus size={12} />
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancelInlineSubgroupInput}
                className="p-1 rounded text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {!isCollapsed && (
            <div
              className={
                mode === "grid"
                  ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
                  : "flex flex-col gap-1.5"
              }
              style={{ paddingLeft: 24 + indentPx + (depth + 1) * 20 }}
            >
              {groupConns.map((conn) =>
                mode === "grid" ? (
                  <ConnectionCard key={conn.id} {...connCardProps(conn)} />
                ) : (
                  <ConnectionListItem
                    key={conn.id}
                    {...connCardProps(conn)}
                  />
                ),
              )}
            </div>
          )}
          {!isCollapsed && renderGroupTree(group.id, mode, depth + 1)}
        </div>
      );
    });
  };

  const hasAnyMatchingDescendant = (
    rootGroupId: string,
    query: string,
  ): boolean => {
    const lc = query.toLowerCase();
    const stack: string[] = [rootGroupId];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const conns = filteredGroupedConnections[id] || [];
      if (conns.length > 0) return true;
      const g = connectionGroups.find((x) => x.id === id);
      if (g && g.name.toLowerCase().includes(lc)) return true;
      const kids = groupsByParent.get(id) ?? [];
      for (const kid of kids) stack.push(kid.id);
    }
    return false;
  };

  const countDescendantConnections = (groupId: string): number => {
    let total = 0;
    const stack: string[] = [groupId];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      total += (filteredGroupedConnections[id] || []).length;
      const kids = groupsByParent.get(id) ?? [];
      for (const kid of kids) stack.push(kid.id);
    }
    return total;
  };

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

        <div className="relative flex items-stretch shadow-lg shadow-blue-500/20 rounded-xl">
          <button
            onClick={() => {
              setEditingConnection(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white pl-4 pr-3.5 py-2.5 rounded-l-xl font-semibold text-sm transition-colors duration-150"
          >
            <Plus size={15} />
            {t("connections.addConnection")}
          </button>
          <button
            ref={importMenuBtnRef}
            onClick={toggleImportMenu}
            className="flex items-center bg-blue-600 hover:bg-blue-500 text-white px-2 rounded-r-xl border-l border-blue-400/40 transition-colors duration-150"
            title={t("connections.importFromApp.title")}
            aria-haspopup="menu"
            aria-expanded={isImportMenuOpen}
          >
            <ChevronDown
              size={15}
              className={clsx("transition-transform", isImportMenuOpen && "rotate-180")}
            />
          </button>
          {isImportMenuOpen &&
            createPortal(
              <>
                <div
                  className="fixed inset-0 z-[200]"
                  onClick={() => setIsImportMenuOpen(false)}
                />
                <div
                  style={{ top: importMenuPos.top, right: importMenuPos.right }}
                  className="fixed z-[201] w-60 bg-elevated border border-strong rounded-xl shadow-2xl py-1 overflow-hidden"
                >
                  <button
                    onClick={() => {
                      setIsImportMenuOpen(false);
                      setIsImportAppModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-secondary hover:text-primary hover:bg-surface-secondary transition-colors text-left"
                  >
                    <FolderInput size={15} className="shrink-0 text-blue-400" />
                    <span className="flex-1">{t("connections.importFromApp.menuLabel")}</span>
                    <BetaBadge />
                  </button>
                </div>
              </>,
              document.body,
            )}
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────────────────────── */}
      {error && (
        <ConnectionErrorBanner
          key={error}
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* ── Selection bar (bulk actions) ──────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2.5 px-6 py-2.5 bg-elevated border-b border-blue-500/40 shadow-sm shrink-0">
          <span className="text-sm font-semibold text-blue-300">
            {t("connections.selectedCount", { count: selectedIds.size })}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => {
              setExportSelectionOnly(true);
              setIsExportModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-blue-400 hover:border-blue-500/50 transition-colors"
          >
            <Download size={14} />
            {t("connections.exportSelected")}
          </button>
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setBulkMoveMenu({ x: r.left, y: r.bottom + 4 });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-amber-400 hover:border-amber-500/50 transition-colors"
          >
            <FolderInput size={14} />
            {t("connections.moveSelected")}
          </button>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <Trash2 size={14} />
            {t("connections.deleteSelected")}
          </button>
          <button
            onClick={clearSelection}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
            title={t("connections.deselectAll")}
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
                onClick={() => setIsImportAppModalOpen(true)}
                className="flex items-center gap-2 bg-elevated border border-strong hover:border-blue-500/50 text-secondary hover:text-blue-400 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all hover:-translate-y-px"
              >
                <FolderInput size={14} />
                {t("connections.importFromApp.menuLabel")}
                <BetaBadge />
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
                    placeholder={t("groups.groupName", {
                      defaultValue: "Group name (use / for nested)",
                    })}
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

              {/* Export button (import lives in the New Connection dropup) */}
              <div className="flex items-center gap-1.5 px-1 py-1 bg-elevated border border-strong rounded-xl shrink-0">
                <button
                  onClick={() => {
                    setExportSelectionOnly(false);
                    setIsExportModalOpen(true);
                  }}
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
                {renderGroupTree(null, "grid")}

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
                {renderGroupTree(null, "list")}

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
      <ExportConnectionsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onExport={handleExport}
        selectedCount={exportSelectionOnly ? selectedIds.size : 0}
      />
      <ImportFromAppModal
        isOpen={isImportAppModalOpen}
        onClose={() => setIsImportAppModalOpen(false)}
        onImported={() => void loadConnections()}
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
              label: t("groups.newSubfolder", { defaultValue: "New subfolder" }),
              icon: FolderPlus,
              action: () => {
                void handleCreateSubgroup(groupContextMenu.groupId);
              },
            },
            { separator: true as const },
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
          // Flatten the group tree in DFS order so the menu mirrors the
          // nested sidebar structure. The group the connection already
          // lives in is skipped, but its descendants remain valid targets.
          const groupTree = flattenGroupTree(connectionGroups).filter(
            ({ group }) => group.id !== currentGroupId,
          );
          const hasAvailableGroups = groupTree.length > 0;
          return (
            <ContextMenu
              x={connectionContextMenu.x}
              y={connectionContextMenu.y}
              items={[
                {
                  label: t("sidebar.openInNewWindow"),
                  icon: AppWindow,
                  disabled: !hasLocalOpenConnections,
                  action: () => {
                    if (conn) void handleOpenInNewWindow(conn);
                  },
                },
                ...(hasAvailableGroups
                  ? [
                      { separator: true as const },
                      {
                        label: t("groups.moveToGroup"),
                        icon: FolderTree,
                        submenu: groupTree.map(({ group, depth }) => ({
                          label: group.name,
                          icon: Folder,
                          indent: depth,
                          action: () =>
                            void handleMoveToGroup(
                              connectionContextMenu.connId,
                              group.id,
                            ),
                        })),
                      },
                    ]
                  : []),
                ...(isInGroup
                  ? [
                      { separator: true as const },
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

      {/* Bulk "move selected to group" menu */}
      {bulkMoveMenu && (
        <ContextMenu
          x={bulkMoveMenu.x}
          y={bulkMoveMenu.y}
          items={[
            {
              label: t("groups.ungrouped"),
              icon: X,
              action: () => void handleBulkMoveToGroup(null),
            },
            ...(connectionGroups.length > 0
              ? [{ separator: true as const }]
              : []),
            ...flattenGroupTree(connectionGroups).map(({ group, depth }) => ({
              label: group.name,
              icon: Folder,
              indent: depth,
              action: () => void handleBulkMoveToGroup(group.id),
            })),
          ]}
          onClose={() => setBulkMoveMenu(null)}
        />
      )}
    </div>
  );
};
