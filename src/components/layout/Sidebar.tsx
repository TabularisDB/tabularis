import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plug2, Settings, Cpu, PanelLeft, Layers, Star, Clock, BookOpen } from "lucide-react";
import { DiscordIcon } from "../icons/DiscordIcon";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DISCORD_URL } from "../../config/links";
import { useDatabase } from "../../hooks/useDatabase";
import { useTheme } from "../../hooks/useTheme";
import { SlotAnchor } from "../ui/SlotAnchor";

// Sub-components
import { NavItem } from "./sidebar/NavItem";
import { RailIndicator } from "./sidebar/RailIndicator";
import { OpenConnectionItem } from "./sidebar/OpenConnectionItem";
import { ConnectionGroupItem } from "./sidebar/ConnectionGroupItem";
import { ExplorerSidebar, type SidebarTab } from "./ExplorerSidebar";
import { PanelDatabaseProvider } from "./PanelDatabaseProvider";
import { DiscordCommunityCallout } from "./sidebar/DiscordCommunityCallout";
import { QuickNavigatorModal } from "../modals/QuickNavigatorModal";
import { GenerateSQLModal } from "../modals/GenerateSQLModal";
import { SchemaModal } from "../modals/SchemaModal";

// Hooks & Utils
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { useConnectionManager } from "../../hooks/useConnectionManager";
import { useOpenConnectionInNewWindow } from "../../hooks/useOpenConnectionInNewWindow";
import { useConnectionLayoutContext } from "../../hooks/useConnectionLayoutContext";
import { canAddToSplit, isConnectionGrouped } from "../../utils/connectionLayout";
import { rectContains, startPointerDrag } from "../../utils/pointerDrag";
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
  const [isQuickNavigatorOpen, setIsQuickNavigatorOpen] = useState(false);
  const [generateSQLTable, setGenerateSQLTable] = useState<string | null>(null);
  const [inspectTable, setInspectTable] = useState<{ tableName: string; schema?: string } | null>(null);
  const { isMac } = useKeybindings();

  useEffect(() => {
    const handler = () => setIsExplorerCollapsed((prev) => !prev);
    window.addEventListener("tabularis:toggle-sidebar", handler);
    return () => window.removeEventListener("tabularis:toggle-sidebar", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      if (activeConnectionId) {
        setIsQuickNavigatorOpen((prev) => !prev);
      }
    };
    window.addEventListener("tabularis:open-quick-navigator", handler);
    return () => window.removeEventListener("tabularis:open-quick-navigator", handler);
  }, [activeConnectionId]);

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
    addConnectionToSplit,
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

  // Pointer-based rail drag: reorder connections or drop one onto the split
  // group badge (HTML5 DnD can freeze the WebKitGTK compositor)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'above' | 'below' } | null>(null);
  const [isGroupDropTarget, setIsGroupDropTarget] = useState(false);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const groupRef = useRef<HTMLDivElement | null>(null);
  const railDropRef = useRef<{ id: string; position: 'above' | 'below' } | 'group' | null>(null);

  const applySidebarReorder = useCallback((draggedId: string, target: { id: string; position: 'above' | 'below' }) => {
    const currentOrder = sortedSidebarConnections.map(c => c.id);
    const reordered = currentOrder.filter(id => id !== draggedId);
    let toIdx = reordered.indexOf(target.id);
    if (target.position === 'below') toIdx += 1;
    reordered.splice(toIdx, 0, draggedId);
    setSidebarOrder(reordered);
  }, [sortedSidebarConnections]);

  const handleConnectionMoveStart = useCallback((connId: string, connName: string, e: React.MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    startPointerDrag(e.clientX, e.clientY, {
      threshold: 5,
      createGhost: () => {
        const ghost = document.createElement('div');
        ghost.className = 'px-2 py-1 rounded text-xs bg-surface-secondary text-primary border border-default shadow-lg';
        ghost.textContent = connName;
        return ghost;
      },
      onDragMove: (x, y) => {
        const groupEl = groupRef.current;
        if (
          groupEl &&
          canAddToSplit(splitView, connId) &&
          rectContains(groupEl.getBoundingClientRect(), x, y)
        ) {
          railDropRef.current = 'group';
          setIsGroupDropTarget(true);
          setDropTarget(null);
          return;
        }
        let found: { id: string; position: 'above' | 'below' } | null = null;
        for (const [id, el] of itemRefs.current) {
          if (id === connId) continue;
          const rect = el.getBoundingClientRect();
          if (rectContains(rect, x, y)) {
            found = { id, position: y < rect.top + rect.height / 2 ? 'above' : 'below' };
            break;
          }
        }
        railDropRef.current = found;
        setIsGroupDropTarget(false);
        setDropTarget(prev =>
          prev?.id === found?.id && prev?.position === found?.position ? prev : found,
        );
      },
      onDrop: () => {
        const target = railDropRef.current;
        if (target === 'group') {
          addConnectionToSplit(connId);
        } else if (target) {
          applySidebarReorder(connId, target);
        }
      },
      onEnd: () => {
        railDropRef.current = null;
        setDropTarget(null);
        setIsGroupDropTarget(false);
      },
    });
  }, [splitView, addConnectionToSplit, applySidebarReorder]);

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

  const openConnectionInNewWindow = useOpenConnectionInNewWindow();

  const handleOpenInNewWindow = (connectionId: string) => {
    const conn = connections.find(c => c.id === connectionId);
    // Rail connections are already open (known-good), so this won't re-validate.
    void openConnectionInNewWindow(connectionId, conn?.name ?? null).catch((e) => {
      console.error(`[Sidebar] Failed to open connection in new window:`, e);
    });
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
                <div ref={groupRef} className="w-full">
                  <ConnectionGroupItem
                    connections={openConnections.filter(c =>
                      isConnectionGrouped(c.id, splitView),
                    )}
                    mode={splitView.mode}
                    isDropTarget={isGroupDropTarget}
                  />
                </div>
              )}

              {/* Sortable connection list */}
              {sortedSidebarConnections.map((conn, idx) => (
                <div
                  key={conn.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(conn.id, el);
                    else itemRefs.current.delete(conn.id);
                  }}
                  className="w-full flex flex-col items-center"
                >
                  <OpenConnectionItem
                    connection={conn}
                    driverManifest={allDrivers.find(d => d.id === conn.driver)}
                    isSelected={selectedConnectionIds.has(conn.id)}
                    onSwitch={() => handleSwitchOrSetExplorer(conn.id)}
                    onOpenInEditor={() => handleOpenInEditor(conn.id)}
                    onOpenInNewWindow={() => handleOpenInNewWindow(conn.id)}
                    onDisconnect={() => handleDisconnectConnection(conn.id)}
                    onToggleSelect={(isCtrlHeld) => toggleSelection(conn.id, isCtrlHeld)}
                    selectedConnectionIds={selectedConnectionIds}
                    onActivateSplit={activateSplit}
                    shortcutIndex={idx + 1}
                    showShortcutHint={showShortcutHints && idx < 9}
                    onMoveMouseDown={(e) => handleConnectionMoveStart(conn.id, conn.name, e)}
                    dropIndicator={dropTarget?.id === conn.id ? dropTarget.position : null}
                  />
                </div>
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
              <RailIndicator isActive={false} className="-left-2" />
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
            { id: "notebooks" as SidebarTab, icon: BookOpen, label: t("sidebar.notebooks.tab") },
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
      {activeConnectionId && isQuickNavigatorOpen && (
        <QuickNavigatorModal
          isOpen={isQuickNavigatorOpen}
          onClose={() => setIsQuickNavigatorOpen(false)}
          onGenerateSql={(tableName) => setGenerateSQLTable(tableName)}
          onInspect={(tableName, schema) => setInspectTable({ tableName, schema })}
        />
      )}
      {generateSQLTable && (
        <GenerateSQLModal
          isOpen={true}
          tableName={generateSQLTable}
          onClose={() => setGenerateSQLTable(null)}
        />
      )}
      {inspectTable && (
        <SchemaModal
          isOpen={true}
          tableName={inspectTable.tableName}
          schema={inspectTable.schema}
          onClose={() => setInspectTable(null)}
        />
      )}
    </div>
  );
};
