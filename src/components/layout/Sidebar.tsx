import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plug2,
  Settings,
  Cpu,
  ChevronDown,
  PanelLeftClose,
} from 'lucide-react';
import clsx from 'clsx';
import { DiscordIcon } from '../icons/DiscordIcon';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DISCORD_URL } from '../../config/links';
import { useDatabase } from '../../hooks/useDatabase';
import { useTheme } from '../../hooks/useTheme';
import { SlotAnchor } from '../ui/SlotAnchor';
import { APP_VERSION } from '../../version';

import { NavRow } from './sidebar/NavRow';
import { ConnectionRow } from './sidebar/ConnectionRow';
import { ConnectionGroupItem } from './sidebar/ConnectionGroupItem';
import { OpenConnectionItem } from './sidebar/OpenConnectionItem';

import { useConnectionManager } from '../../hooks/useConnectionManager';
import { useConnectionLayoutContext } from '../../hooks/useConnectionLayoutContext';
import { isConnectionGrouped } from '../../utils/connectionLayout';
import { useDrivers } from '../../hooks/useDrivers';
import { useKeybindings } from '../../hooks/useKeybindings';

const SIDEBAR_WIDTH = 240;
const COLLAPSED_WIDTH = 56;

export const Sidebar = () => {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const isDarkTheme = !currentTheme?.id?.includes('-light');
  const { activeConnectionId, connections } = useDatabase();
  const navigate = useNavigate();
  const location = useLocation();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showShortcutHints, setShowShortcutHints] = useState(false);
  const [openExpanded, setOpenExpanded] = useState(true);
  const { isMac } = useKeybindings();

  useEffect(() => {
    const handler = () => setIsCollapsed((prev) => !prev);
    window.addEventListener('tabularis:toggle-sidebar', handler);
    return () =>
      window.removeEventListener('tabularis:toggle-sidebar', handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifierHeld = isMac ? e.metaKey || e.ctrlKey : e.ctrlKey;
      if (modifierHeld && e.shiftKey) setShowShortcutHints(true);
    };
    const handleKeyUp = () => setShowShortcutHints(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleKeyUp);
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
    selectedConnectionIds,
    toggleSelection,
    activateSplit,
    hideSplitView,
  } = useConnectionLayoutContext();

  const [sidebarOrder, setSidebarOrder] = useState<string[]>([]);

  const sortedSidebarConnections = useMemo(() => {
    const nonSplit = openConnections.filter(
      (conn) => !isConnectionGrouped(conn.id, splitView),
    );
    const orderMap = new Map(sidebarOrder.map((id, i) => [id, i]));
    return nonSplit.sort((a, b) => {
      const oa = orderMap.get(a.id);
      const ob = orderMap.get(b.id);
      if (oa === undefined && ob === undefined) return 0;
      if (oa === undefined) return 1;
      if (ob === undefined) return -1;
      return oa - ob;
    });
  }, [openConnections, splitView, sidebarOrder]);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: 'above' | 'below';
  } | null>(null);

  const handleReorderDragStart = useCallback(
    (connectionId: string, e: React.DragEvent) => {
      setDraggedId(connectionId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', connectionId);
    },
    [],
  );

  const handleReorderDragOver = useCallback(
    (targetId: string, e: React.DragEvent) => {
      e.preventDefault();
      if (!draggedId || draggedId === targetId) {
        setDropTarget(null);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const position = e.clientY < midY ? 'above' : 'below';
      setDropTarget({ id: targetId, position });
    },
    [draggedId],
  );

  const handleReorderDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!draggedId || !dropTarget || draggedId === dropTarget.id) {
        setDraggedId(null);
        setDropTarget(null);
        return;
      }

      const currentOrder = sortedSidebarConnections.map((c) => c.id);
      const reordered = currentOrder.filter((id) => id !== draggedId);
      let toIdx = reordered.indexOf(dropTarget.id);
      if (dropTarget.position === 'below') toIdx += 1;
      reordered.splice(toIdx, 0, draggedId);

      setSidebarOrder(reordered);
      setDraggedId(null);
      setDropTarget(null);
    },
    [draggedId, dropTarget, sortedSidebarConnections],
  );

  const handleReorderDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  const handleSwitchToConnection = useCallback(
    (connectionId: string) => {
      handleSwitch(connectionId);
      if (
        location.pathname === '/' ||
        location.pathname === '/connections' ||
        location.pathname === '/mcp' ||
        location.pathname === '/settings'
      ) {
        navigate('/editor');
      }
    },
    [handleSwitch, location.pathname, navigate],
  );

  const handleSwitchOrSetExplorer = useCallback(
    (connectionId: string) => {
      if (splitView) {
        hideSplitView();
      }
      handleSwitchToConnection(connectionId);
    },
    [splitView, hideSplitView, handleSwitchToConnection],
  );

  const handleDisconnectConnection = useCallback(
    async (connectionId: string) => {
      const isLast = openConnections.length <= 1;
      await disconnectConnection(connectionId);
      if (isLast) {
        navigate('/');
      }
    },
    [openConnections.length, disconnectConnection, navigate],
  );

  const handleOpenInEditor = useCallback(
    (connectionId: string) => {
      handleSwitch(connectionId);
      navigate('/editor');
    },
    [handleSwitch, navigate],
  );

  const totalConnections = connections.length;

  if (isCollapsed) {
    return (
      <aside
        style={{ width: COLLAPSED_WIDTH }}
        className="bg-elevated border-r border-default flex flex-col items-center py-3 shrink-0"
      >
        <button
          onClick={() => setIsCollapsed(false)}
          className="mb-3 p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-secondary transition-colors group relative"
          title={t('sidebar.expandExplorer')}
        >
          <img
            src="/logo.png"
            alt="tabularis"
            className="w-7 h-7 rounded-lg"
            style={{
              backgroundColor: isDarkTheme
                ? currentTheme?.colors?.surface?.secondary || '#334155'
                : currentTheme?.colors?.bg?.elevated || '#f8fafc',
            }}
          />
        </button>
        <nav className="flex-1 flex flex-col gap-1 items-center w-full px-2 overflow-y-auto custom-scrollbar">
          <CollapsedNavIcon
            icon={Plug2}
            label={t('sidebar.connections')}
            to="/connections"
            isOnline={!!activeConnectionId}
          />
          <CollapsedNavIcon
            icon={Cpu}
            label={t('sidebar.mcpServer')}
            to="/mcp"
          />
          <CollapsedNavIcon
            icon={Settings}
            label={t('sidebar.settings')}
            to="/settings"
          />

          {(openConnections.length > 0 || splitView) && (
            <div className="w-full mt-2 pt-2 border-t border-default flex flex-col items-center gap-0.5">
              {splitView && (
                <ConnectionGroupItem
                  connections={openConnections.filter((c) =>
                    isConnectionGrouped(c.id, splitView),
                  )}
                  mode={splitView.mode}
                />
              )}
              {sortedSidebarConnections.map((conn, idx) => (
                <OpenConnectionItem
                  key={conn.id}
                  connection={conn}
                  driverManifest={allDrivers.find((d) => d.id === conn.driver)}
                  isSelected={selectedConnectionIds.has(conn.id)}
                  onSwitch={() => handleSwitchOrSetExplorer(conn.id)}
                  onOpenInEditor={() => handleOpenInEditor(conn.id)}
                  onDisconnect={() => handleDisconnectConnection(conn.id)}
                  onToggleSelect={(isCtrlHeld) =>
                    toggleSelection(conn.id, isCtrlHeld)
                  }
                  selectedConnectionIds={selectedConnectionIds}
                  onActivateSplit={activateSplit}
                  shortcutIndex={idx + 1}
                  showShortcutHint={showShortcutHints && idx < 9}
                />
              ))}
            </div>
          )}
        </nav>
        <button
          onClick={() => openUrl(DISCORD_URL)}
          className="p-1.5 rounded-lg text-muted hover:text-indigo-400 hover:bg-surface-hover transition-colors"
          title="Discord"
        >
          <DiscordIcon size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{ width: SIDEBAR_WIDTH }}
      className="bg-elevated border-r border-default flex flex-col shrink-0 select-none"
    >
      {/* Header */}
      <header className="h-12 px-3 flex items-center gap-2 shrink-0 border-b border-default">
        <img
          src="/logo.png"
          alt="tabularis"
          className="w-7 h-7 rounded-lg shrink-0 shadow-md shadow-blue-500/20"
          style={{
            backgroundColor: isDarkTheme
              ? currentTheme?.colors?.surface?.secondary || '#334155'
              : currentTheme?.colors?.bg?.elevated || '#f8fafc',
          }}
        />
        <span className="text-sm font-semibold tracking-tight text-primary flex-1">
          tabularis
        </span>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1 rounded hover:bg-surface-hover text-muted hover:text-secondary transition-colors"
          title={t('sidebar.expandExplorer')}
        >
          <PanelLeftClose size={14} />
        </button>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {/* Primary nav */}
        <div className="space-y-0.5">
          <NavRow
            to="/connections"
            icon={Plug2}
            label={t('sidebar.connections')}
            badge={totalConnections > 0 ? totalConnections : undefined}
            isOnline={!!activeConnectionId}
          />
          <NavRow to="/mcp" icon={Cpu} label={t('sidebar.mcpServer')} />
          <NavRow to="/settings" icon={Settings} label={t('sidebar.settings')} />
        </div>

        {/* Open connections section */}
        {(openConnections.length > 0 || splitView) && (
          <SectionHeader
            label={t('sidebar.openConnections')}
            count={openConnections.length}
            expanded={openExpanded}
            onToggle={() => setOpenExpanded((v) => !v)}
          />
        )}

        {openExpanded && (openConnections.length > 0 || splitView) && (
          <div className="space-y-0.5 mt-1">
            {splitView && (
              <div className="px-2 py-1">
                <ConnectionGroupItem
                  connections={openConnections.filter((c) =>
                    isConnectionGrouped(c.id, splitView),
                  )}
                  mode={splitView.mode}
                />
              </div>
            )}

            {sortedSidebarConnections.map((conn, idx) => (
              <ConnectionRow
                key={conn.id}
                connection={conn}
                driverManifest={allDrivers.find((d) => d.id === conn.driver)}
                isSelected={selectedConnectionIds.has(conn.id)}
                onSwitch={() => handleSwitchOrSetExplorer(conn.id)}
                onOpenInEditor={() => handleOpenInEditor(conn.id)}
                onDisconnect={() => handleDisconnectConnection(conn.id)}
                onToggleSelect={(isCtrlHeld) =>
                  toggleSelection(conn.id, isCtrlHeld)
                }
                selectedConnectionIds={selectedConnectionIds}
                onActivateSplit={activateSplit}
                shortcutIndex={idx + 1}
                showShortcutHint={showShortcutHints && idx < 9}
                draggable
                onReorderDragStart={(e) => handleReorderDragStart(conn.id, e)}
                onReorderDragOver={(e) => handleReorderDragOver(conn.id, e)}
                onReorderDragLeave={() => setDropTarget(null)}
                onReorderDrop={handleReorderDrop}
                onReorderDragEnd={handleReorderDragEnd}
                dropIndicator={
                  dropTarget?.id === conn.id ? dropTarget.position : null
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-default px-2 py-2 flex items-center gap-1 shrink-0">
        <button
          onClick={() => openUrl(DISCORD_URL)}
          className="p-1.5 rounded-lg text-muted hover:text-indigo-400 hover:bg-surface-hover transition-colors"
          title="Discord"
        >
          <DiscordIcon size={16} />
        </button>

        <SlotAnchor
          name="sidebar.footer.actions"
          context={{}}
          className="flex items-center gap-1"
        />

        <span className="ml-auto text-[10px] font-mono text-muted">
          v{APP_VERSION}
        </span>
      </footer>
    </aside>
  );
};

interface SectionHeaderProps {
  label: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
}

const SectionHeader = ({
  label,
  count,
  expanded,
  onToggle,
}: SectionHeaderProps) => (
  <button
    onClick={onToggle}
    className="w-full mt-3 mb-0.5 px-2 h-6 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted font-medium hover:text-secondary transition-colors"
  >
    <ChevronDown
      size={11}
      className={clsx(
        'transition-transform shrink-0',
        !expanded && '-rotate-90',
      )}
    />
    <span>{label}</span>
    {count !== undefined && count > 0 && (
      <span className="ml-auto text-muted font-mono">{count}</span>
    )}
  </button>
);

interface CollapsedNavIconProps {
  icon: typeof Plug2;
  label: string;
  to: string;
  isOnline?: boolean;
}

const CollapsedNavIcon = ({
  icon: Icon,
  label,
  to,
  isOnline,
}: CollapsedNavIconProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <button
      onClick={() => navigate(to)}
      className={clsx(
        'group relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors',
        isActive
          ? 'bg-surface-hover text-primary'
          : 'text-muted hover:bg-surface-hover hover:text-secondary',
      )}
    >
      <Icon size={16} />
      {isOnline && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-success" />
      )}
      <span className="absolute left-12 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none">
        {label}
      </span>
    </button>
  );
};
