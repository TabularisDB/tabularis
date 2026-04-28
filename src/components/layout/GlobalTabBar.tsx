import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Plug2,
  Cpu,
  Settings as SettingsIcon,
  X,
  Plus,
  Maximize2,
  PanelRight,
  Columns2,
  Rows2,
} from 'lucide-react';
import clsx from 'clsx';
import { useDatabase } from '../../hooks/useDatabase';
import { useConnectionManager } from '../../hooks/useConnectionManager';
import { useConnectionLayoutContext } from '../../hooks/useConnectionLayoutContext';

interface GlobalTabBarProps {
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
}

interface TabDescriptor {
  id: string;
  label: string;
  icon: typeof Plug2;
  isActive: boolean;
  onActivate: () => void;
  onClose?: () => void;
  accent?: 'connection' | 'route';
}

export const GlobalTabBar = ({
  rightPanelOpen,
  onToggleRightPanel,
}: GlobalTabBarProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeConnectionId, switchConnection } = useDatabase();
  const { openConnections, handleDisconnect } = useConnectionManager();
  const {
    activateSplit,
    selectedConnectionIds,
    splitView,
    isSplitVisible,
    deactivateSplit,
  } = useConnectionLayoutContext();

  const path = location.pathname;
  const onEditor = path.startsWith('/editor');

  const tabs: TabDescriptor[] = [];

  tabs.push({
    id: 'route:connections',
    label: t('sidebar.connections'),
    icon: Plug2,
    isActive: path === '/connections' || path === '/',
    onActivate: () => navigate('/connections'),
    accent: 'route',
  });

  for (const conn of openConnections) {
    tabs.push({
      id: `conn:${conn.id}`,
      label: conn.name,
      icon: Plug2,
      isActive: onEditor && activeConnectionId === conn.id,
      onActivate: () => {
        switchConnection(conn.id);
        if (!onEditor) navigate('/editor');
      },
      onClose: () => {
        void handleDisconnect(conn.id);
      },
      accent: 'connection',
    });
  }

  if (path === '/mcp') {
    tabs.push({
      id: 'route:mcp',
      label: t('sidebar.mcpServer'),
      icon: Cpu,
      isActive: true,
      onActivate: () => {},
      accent: 'route',
    });
  }

  if (path === '/settings') {
    tabs.push({
      id: 'route:settings',
      label: t('sidebar.settings'),
      icon: SettingsIcon,
      isActive: true,
      onActivate: () => {},
      accent: 'route',
    });
  }

  const canSplit = selectedConnectionIds.size >= 2;
  const splitOn = !!splitView && isSplitVisible;

  return (
    <div className="h-9 bg-base border-b border-default flex items-center px-1.5 gap-0.5 shrink-0 select-none">
      {/* Navigation arrows */}
      <button
        onClick={() => navigate(-1)}
        className="p-1.5 rounded-md hover:bg-surface-hover text-muted hover:text-secondary transition-colors"
        title={t('tabBar.back')}
      >
        <ArrowLeft size={14} />
      </button>
      <button
        onClick={() => navigate(1)}
        className="p-1.5 rounded-md hover:bg-surface-hover text-muted hover:text-secondary transition-colors"
        title={t('tabBar.forward')}
      >
        <ArrowRight size={14} />
      </button>

      <div className="w-px h-4 bg-default mx-1" />

      {/* Tabs scroll area */}
      <div className="flex items-center gap-0.5 flex-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <div
              key={tab.id}
              role="button"
              tabIndex={0}
              onClick={tab.onActivate}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  tab.onActivate();
                }
              }}
              className={clsx(
                'group flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-md cursor-pointer max-w-[220px] transition-all border',
                tab.isActive
                  ? 'bg-elevated border-default text-primary shadow-sm'
                  : 'border-transparent text-muted hover:bg-surface-hover hover:text-secondary',
              )}
            >
              <Icon
                size={13}
                className={clsx(
                  'shrink-0',
                  tab.isActive && tab.accent === 'connection'
                    ? 'text-accent-info'
                    : tab.isActive
                      ? 'text-accent-primary'
                      : '',
                )}
              />
              <span className="text-xs truncate">{tab.label}</span>
              {tab.onClose ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    tab.onClose?.();
                  }}
                  className={clsx(
                    'p-0.5 rounded hover:bg-surface-secondary transition-opacity',
                    tab.isActive
                      ? 'opacity-70 hover:opacity-100'
                      : 'opacity-0 group-hover:opacity-70 hover:opacity-100',
                  )}
                  title={t('tabBar.closeTab')}
                >
                  <X size={11} />
                </button>
              ) : (
                <span className="w-[18px]" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      <div className="w-px h-4 bg-default mx-1" />

      {/* Right action cluster */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => navigate('/connections')}
          className="p-1.5 rounded-md hover:bg-surface-hover text-muted hover:text-secondary transition-colors"
          title={t('tabBar.newTab')}
        >
          <Plus size={14} />
        </button>

        {splitOn ? (
          <button
            onClick={deactivateSplit}
            className="p-1.5 rounded-md hover:bg-surface-hover text-accent-secondary transition-colors"
            title={t('tabBar.exitSplit')}
          >
            <Maximize2 size={14} />
          </button>
        ) : (
          <>
            <button
              onClick={() => activateSplit('vertical')}
              disabled={!canSplit}
              className="p-1.5 rounded-md hover:bg-surface-hover text-muted hover:text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title={t('sidebar.splitVertical')}
            >
              <Columns2 size={14} />
            </button>
            <button
              onClick={() => activateSplit('horizontal')}
              disabled={!canSplit}
              className="p-1.5 rounded-md hover:bg-surface-hover text-muted hover:text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title={t('sidebar.splitHorizontal')}
            >
              <Rows2 size={14} />
            </button>
          </>
        )}

        <div className="w-px h-4 bg-default mx-1" />

        <button
          onClick={onToggleRightPanel}
          className={clsx(
            'p-1.5 rounded-md transition-colors',
            rightPanelOpen
              ? 'bg-surface-hover text-accent-primary'
              : 'hover:bg-surface-hover text-muted hover:text-secondary',
          )}
          title={t('tabBar.toggleProperties')}
        >
          <PanelRight size={14} />
        </button>
      </div>
    </div>
  );
};
