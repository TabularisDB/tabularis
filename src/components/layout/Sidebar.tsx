import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plug2, Settings, Cpu, PanelLeft } from "lucide-react";
import { DiscordIcon } from "../icons/DiscordIcon";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DISCORD_URL } from "../../config/links";
import { useDatabase } from "../../hooks/useDatabase";
import { useTheme } from "../../hooks/useTheme";
import { McpModal } from "../modals/McpModal";

// Sub-components
import { NavItem } from "./sidebar/NavItem";
import { OpenConnectionItem } from "./sidebar/OpenConnectionItem";
import { ConnectionGroupItem } from "./sidebar/ConnectionGroupItem";
import { ConnectionGroupFolder } from "./sidebar/ConnectionGroupFolder";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { PanelDatabaseProvider } from "./PanelDatabaseProvider";

// Hooks & Utils
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { useConnectionManager } from "../../hooks/useConnectionManager";
import { useConnectionLayoutContext } from "../../contexts/useConnectionLayoutContext";
import { isConnectionGrouped } from "../../utils/connectionLayout";
import { useDrivers } from "../../hooks/useDrivers";
import type { ConnectionStatus } from "../../hooks/useConnectionManager";
import { useKeybindings } from "../../hooks/useKeybindings";

export const Sidebar = () => {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const isDarkTheme = !currentTheme?.id?.includes("-light");
  const {
    activeConnectionId,
    connectionGroups,
    connections,
    updateGroup,
    deleteGroup,
    moveConnectionToGroup,
    toggleGroupCollapsed,
  } = useDatabase();
  const navigate = useNavigate();
  const location = useLocation();

  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
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

  const { sidebarWidth, startResize } = useSidebarResize();

  // Organize open connections by group
  const { groupedConnections, ungroupedConnections } = useMemo(() => {
    const grouped: Record<string, ConnectionStatus[]> = {};
    const ungrouped: ConnectionStatus[] = [];

    // Get group_id for each open connection from saved connections
    const connectionGroupMap = new Map(
      connections.map(c => [c.id, c.group_id])
    );

    for (const conn of openConnections) {
      const groupId = connectionGroupMap.get(conn.id);
      if (groupId) {
        if (!grouped[groupId]) {
          grouped[groupId] = [];
        }
        grouped[groupId].push(conn);
      } else {
        ungrouped.push(conn);
      }
    }

    return { groupedConnections: grouped, ungroupedConnections: ungrouped };
  }, [openConnections, connections]);

  // Sort groups by sort_order
  const sortedGroups = useMemo(
    () => [...connectionGroups].sort((a, b) => a.sort_order - b.sort_order),
    [connectionGroups]
  );

  // Filter to only show groups that have open connections
  const activeGroups = useMemo(
    () => sortedGroups.filter(g => groupedConnections[g.id]?.length > 0),
    [sortedGroups, groupedConnections]
  );

  const handleSwitchToConnection = (connectionId: string) => {
    handleSwitch(connectionId);
    if (
      location.pathname === "/" ||
      location.pathname === "/connections" ||
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

              {/* Show grouped connections by folder */}
              {activeGroups.map((group) => {
                const groupConns = groupedConnections[group.id] || [];
                const nonSplitConns = groupConns.filter(
                  conn => !isConnectionGrouped(conn.id, splitView)
                );
                if (nonSplitConns.length === 0) return null;

                return (
                  <ConnectionGroupFolder
                    key={group.id}
                    group={group}
                    connections={nonSplitConns}
                    allDrivers={allDrivers}
                    selectedConnectionIds={selectedConnectionIds}
                    onToggleCollapsed={() => void toggleGroupCollapsed(group.id)}
                    onRename={(newName) => void updateGroup(group.id, { name: newName })}
                    onDelete={() => void deleteGroup(group.id)}
                    onSwitch={handleSwitchOrSetExplorer}
                    onOpenInEditor={handleOpenInEditor}
                    onDisconnect={handleDisconnectConnection}
                    onToggleSelect={toggleSelection}
                    onActivateSplit={activateSplit}
                    onDropConnection={(connId) => void moveConnectionToGroup(connId, group.id)}
                    showShortcutHints={showShortcutHints}
                  />
                );
              })}

              {/* Show ungrouped connections */}
              {ungroupedConnections
                .filter(conn => !isConnectionGrouped(conn.id, splitView))
                .map((conn, idx) => (
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
                  />
                ))}
            </div>
          )}
        </nav>

        <div className="mt-auto">
          <button
            onClick={() => openUrl(DISCORD_URL)}
            className="flex items-center justify-center w-12 h-12 rounded-lg transition-colors mb-2 relative group text-secondary hover:bg-surface-secondary hover:text-indigo-400"
          >
            <div className="relative">
              <DiscordIcon size={24} />
            </div>
            <span className="absolute left-14 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
              Discord
            </span>
          </button>

          <button
            onClick={() => setIsMcpModalOpen(true)}
            className="flex items-center justify-center w-12 h-12 rounded-lg transition-colors mb-2 relative group text-secondary hover:bg-surface-secondary hover:text-primary"
          >
            <div className="relative">
              <Cpu size={24} />
            </div>
            <span className="absolute left-14 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
              MCP Server
            </span>
          </button>

          <NavItem
            to="/settings"
            icon={Settings}
            label={t("sidebar.settings")}
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
          />
        </PanelDatabaseProvider>
      )}

      {/* Collapsed Explorer (Icon only) */}
      {shouldShowExplorer && isExplorerCollapsed && (
        <div className="w-12 bg-base border-r border-default flex flex-col items-center py-4">
          <button
            onClick={() => setIsExplorerCollapsed(false)}
            className="text-muted hover:text-secondary hover:bg-surface-secondary rounded-lg p-2 transition-colors group relative"
            title={t("sidebar.expandExplorer")}
          >
            <PanelLeft size={20} />
            <span className="absolute left-14 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
              {t("sidebar.expandExplorer")}
            </span>
          </button>
        </div>
      )}

      {isMcpModalOpen && (
        <McpModal
          isOpen={isMcpModalOpen}
          onClose={() => setIsMcpModalOpen(false)}
        />
      )}
    </div>
  );
};
