import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plug2, Settings, Cpu, PanelLeft, Layers, Star, Clock } from "lucide-react";
import { DiscordIcon } from "../icons/DiscordIcon";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DISCORD_URL } from "../../config/links";
import { useDatabase } from "../../hooks/useDatabase";
import { useTheme } from "../../hooks/useTheme";
import { SlotAnchor } from "../ui/SlotAnchor";

// Sub-components
import { NavItem } from "./sidebar/NavItem";
import { OpenConnectionItem } from "./sidebar/OpenConnectionItem";
import { ConnectionGroupItem } from "./sidebar/ConnectionGroupItem";
import { ExplorerSidebar, type SidebarTab } from "./ExplorerSidebar";
import { PanelDatabaseProvider } from "./PanelDatabaseProvider";
import { DiscordCommunityCallout } from "./sidebar/DiscordCommunityCallout";

// Hooks & Utils
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { useConnectionManager } from "../../hooks/useConnectionManager";
import { useConnectionLayoutContext } from "../../hooks/useConnectionLayoutContext";
import { isConnectionGrouped } from "../../utils/connectionLayout";
import { useDrivers } from "../../hooks/useDrivers";
import { useKeybindings } from "../../hooks/useKeybindings";

export const Sidebar = () => {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const isDarkTheme = !currentTheme?.id?.includes("-light");
  const {
    activeConnectionId,
    connections,
  } = useDatabase();
  const navigate = useNavigate();
  const location = useLocation();

  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("structure");
  const [showShortcutHints, setShowShortcutHints] = useState(false);
  const { isMac } = useKeybindings();

  useEffect(() => {
    const handler = () => setIsExplorerCollapsed((prev) => !prev);
    window.addEventListener("tabularis:toggle-sidebar", handler);
    return () => window.removeEventListener("tabularis:toggle-sidebar", handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifierHeld = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
      if (modifierHeld && e.shiftKey) setShowShortcutHints(true);
    };
    const handleKeyUp = () => setShowShortcutHints(false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleKeyUp);
    };
  }, [isMac]);

  const {
    openConnections,
    handleDisconnect: disconnectConnection,
    handleSwitch,
  } = useConnectionManager();

  const { allDrivers } = useDrivers();

  const {
    splitView,
    isSplitVisible,
    selectedConnectionIds,
    toggleSelection,
    activateSplit,
    hideSplitView,
    explorerConnectionId
  } = useConnectionLayoutContext();

  const collapseExplorer = useCallback(() => setIsExplorerCollapsed(true), []);
  const { sidebarWidth, startResize } = useSidebarResize(collapseExplorer);

  // Sidebar-only ordering (in-memory, resets when connections close)
  const [sidebarOrder, setSidebarOrder] = useState<string[]>([]);

  // Build a flat list of non-split open connections, sorted by sidebar order
  const sortedSidebarConnections = useMemo(() => {
    const nonSplit = openConnections.filter(conn => !isConnectionGrouped(conn.id, splitView));
    const orderMap = new Map(sidebarOrder.map((id, i) => [id, i]));
    return nonSplit.sort((a, b) => {
      const oa = orderMap.get(a.id);
      const ob = orderMap.get(b.id);
      // Connections not in sidebarOrder go at the end, in their original order
      if (oa === undefined && ob === undefined) return 0;
      if (oa === undefined) return 1;
      if (ob === undefined) return -1;
      return oa - ob;
    });
  }, [openConnections, splitView, sidebarOrder]);

  // Track which connections have a group (to show labels)
  const groupedIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (c.group_id) set.add(c.id);
    }
    return set;
  }, [connections]);

  // Drag-and-drop reorder state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'above' | 'below' } | null>(null);

  const handleReorderDragStart = useCallback((connectionId: string, e: React.DragEvent) => {
    setDraggedId(connectionId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', connectionId);
  }, []);

  const handleReorderDragOver = useCallback((targetId: string, e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDropTarget(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'above' : 'below';
    setDropTarget({ id: targetId, position });
  }, [draggedId]);

  const handleReorderDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedId || !dropTarget || draggedId === dropTarget.id) {
      setDraggedId(null);
      setDropTarget(null);
      return;
    }

    const currentOrder = sortedSidebarConnections.map(c => c.id);
    const reordered = currentOrder.filter(id => id !== draggedId);
    let toIdx = reordered.indexOf(dropTarget.id);
    if (dropTarget.position === 'below') toIdx += 1;
    reordered.splice(toIdx, 0, draggedId);

    setSidebarOrder(reordered);
    setDraggedId(null);
    setDropTarget(null);
  }, [draggedId, dropTarget, sortedSidebarConnections]);

  const handleReorderDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  const handleSwitchToConnection = (connectionId: string) => {
    handleSwitch(connectionId);
    if (
      location.pathname === "/" ||
      location.pathname === "/connections" ||
      location.pathname === "/mcp" ||
      location.pathname === "/settings"
    ) {
      navigate("/editor");
    }
  };

  const handleSwitchOrSetExplorer = (connectionId: string) => {
    if (splitView) {
      hideSplitView();
    }
    handleSwitchToConnection(connectionId);
  };

  const handleDisconnectConnection = async (connectionId: string) => {
    const isLast = openConnections.length <= 1;
    await disconnectConnection(connectionId);
    if (isLast) {
      navigate("/");
    }
  };

  const handleOpenInEditor = (connectionId: string) => {
    handleSwitch(connectionId);
    navigate("/editor");
  };

  const explorerConnId = (splitView && isSplitVisible) ? explorerConnectionId : activeConnectionId;
  const shouldShowExplorer =
    !!explorerConnId &&
    location.pathname !== "/settings" &&
    location.pathname !== "/mcp" &&
    location.pathname !== "/connections";

  return (
    <div className="flex h-full">
      {/* Primary Navigation Bar (Narrow) */}
      <aside className="w-16 bg-elevated border-r border-default flex flex-col items-center py-4 z-20">
        <div className="mb-8" title="tabularis">
          <img
            src="/logo.png"
            alt="tabularis"
            className="w-12 h-12 p-2 rounded-2xl mx-auto mb-4 shadow-lg shadow-blue-500/30"
            style={{
              backgroundColor: isDarkTheme
                ? currentTheme?.colors?.surface?.secondary || "#334155"
                : currentTheme?.colors?.bg?.elevated || "#f8fafc",
            }}
          />
        </div>

        <nav className="flex-1 w-full flex flex-col items-center">
          <NavItem
            to="/connections"
            icon={Plug2}
            label={t("sidebar.connections")}
            isConnected={!!activeConnectionId}
          />

          {/* Open connections */}
          {openConnections.length > 0 && (
            <div className="w-full flex flex-col items-center mt-2 pt-2 border-t border-default">
              {/* Show group item once if there is a split view */}
              {splitView && (
                <ConnectionGroupItem
                  connections={openConnections.filter(c =>
                    isConnectionGrouped(c.id, splitView),
                  )}
                  mode={splitView.mode}
                />
              )}

              {/* Sortable connection list */}
              {sortedSidebarConnections.map((conn, idx) => (
                <OpenConnectionItem
                  key={conn.id}
                  connection={conn}
                  driverManifest={allDrivers.find(d => d.id === conn.driver)}
                  isSelected={selectedConnectionIds.has(conn.id)}
                  onSwitch={() => handleSwitchOrSetExplorer(conn.id)}
                  onOpenInEditor={() => handleOpenInEditor(conn.id)}
                  onDisconnect={() => handleDisconnectConnection(conn.id)}
                  onToggleSelect={(isCtrlHeld) => toggleSelection(conn.id, isCtrlHeld)}
                  selectedConnectionIds={selectedConnectionIds}
                  onActivateSplit={activateSplit}
                  shortcutIndex={idx + 1}
                  showShortcutHint={showShortcutHints && idx < 9}
                  showLabel={groupedIds.has(conn.id)}
                  draggable
                  onReorderDragStart={(e) => handleReorderDragStart(conn.id, e)}
                  onReorderDragOver={(e) => handleReorderDragOver(conn.id, e)}
                  onReorderDragLeave={() => setDropTarget(null)}
                  onReorderDrop={handleReorderDrop}
                  onReorderDragEnd={handleReorderDragEnd}
                  dropIndicator={dropTarget?.id === conn.id ? dropTarget.position : null}
                />
              ))}
            </div>
          )}
        </nav>

        <div className="mt-auto">
          <div className="relative mb-2">
            <button
              onClick={() => openUrl(DISCORD_URL)}
              className="flex items-center justify-center w-12 h-12 rounded-lg transition-colors relative group text-secondary hover:bg-surface-secondary hover:text-indigo-400"
            >
              <div className="relative">
                <DiscordIcon size={24} />
              </div>
              <span className="absolute left-14 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none">
                Discord
              </span>
            </button>
            <DiscordCommunityCallout />
          </div>

          <NavItem
            to="/mcp"
            icon={Cpu}
            label={t("sidebar.mcpServer")}
          />

          <NavItem
            to="/settings"
            icon={Settings}
            label={t("sidebar.settings")}
          />

          <SlotAnchor
            name="sidebar.footer.actions"
            context={{}}
            className="flex flex-col items-center gap-1 mt-1"
          />
        </div>
      </aside>

      {/* Secondary Sidebar (Schema Explorer) */}
      {shouldShowExplorer && !isExplorerCollapsed && explorerConnId && (
        <PanelDatabaseProvider connectionId={explorerConnId}>
          <ExplorerSidebar
            sidebarWidth={sidebarWidth}
            startResize={startResize}
            onCollapse={() => setIsExplorerCollapsed(true)}
            sidebarTab={sidebarTab}
            onSidebarTabChange={setSidebarTab}
          />
        </PanelDatabaseProvider>
      )}

      {/* Collapsed Explorer (Icon strip) */}
      {shouldShowExplorer && isExplorerCollapsed && (
        <div className="w-12 bg-base border-r border-default flex flex-col items-center py-2 gap-1">
          <button
            onClick={() => setIsExplorerCollapsed(false)}
            className="text-muted hover:text-secondary hover:bg-surface-secondary rounded-lg p-2 transition-colors group relative"
            title={t("sidebar.expandExplorer")}
          >
            <PanelLeft size={18} />
            <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none">
              {t("sidebar.expandExplorer")}
            </span>
          </button>
          <div className="w-6 h-px bg-default my-1" />
          {([
            { id: "structure" as SidebarTab, icon: Layers, label: t("sidebar.structure") },
            { id: "favorites" as SidebarTab, icon: Star, label: t("sidebar.favorites") },
            { id: "history" as SidebarTab, icon: Clock, label: t("sidebar.queryHistory") },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setSidebarTab(tab.id);
                setIsExplorerCollapsed(false);
              }}
              className={`rounded-lg p-2 transition-colors group relative ${
                sidebarTab === tab.id
                  ? "text-blue-400 bg-blue-500/10"
                  : "text-muted hover:text-secondary hover:bg-surface-secondary"
              }`}
              title={tab.label}
            >
              <tab.icon size={16} />
              <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none">
                {tab.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
