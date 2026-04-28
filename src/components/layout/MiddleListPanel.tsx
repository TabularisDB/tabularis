import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layers, Star, Clock, PanelLeft } from 'lucide-react';
import clsx from 'clsx';
import { ExplorerSidebar, type SidebarTab } from './ExplorerSidebar';
import { PanelDatabaseProvider } from './PanelDatabaseProvider';
import { useDatabase } from '../../hooks/useDatabase';
import { useConnectionLayoutContext } from '../../hooks/useConnectionLayoutContext';
import { useSidebarResize } from '../../hooks/useSidebarResize';

const HIDE_ON_PATHS = new Set(['/', '/connections', '/mcp', '/settings']);

export const MiddleListPanel = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { activeConnectionId } = useDatabase();
  const { splitView, isSplitVisible, explorerConnectionId } =
    useConnectionLayoutContext();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('structure');

  const collapse = useCallback(() => setIsCollapsed(true), []);
  const { sidebarWidth, startResize } = useSidebarResize(collapse);

  const explorerConnId =
    splitView && isSplitVisible ? explorerConnectionId : activeConnectionId;

  const shouldShow = !!explorerConnId && !HIDE_ON_PATHS.has(location.pathname);

  if (!shouldShow) return null;

  if (isCollapsed) {
    return (
      <div className="w-10 bg-base border-r border-default flex flex-col items-center py-2 gap-1 shrink-0">
        <button
          onClick={() => setIsCollapsed(false)}
          className="text-muted hover:text-secondary hover:bg-surface-hover rounded-md p-1.5 transition-colors group relative"
          title={t('sidebar.expandExplorer')}
        >
          <PanelLeft size={15} />
          <Tooltip>{t('sidebar.expandExplorer')}</Tooltip>
        </button>
        <div className="w-5 h-px bg-default my-1" />
        {(
          [
            {
              id: 'structure' as SidebarTab,
              icon: Layers,
              label: t('sidebar.structure'),
            },
            {
              id: 'favorites' as SidebarTab,
              icon: Star,
              label: t('sidebar.favorites'),
            },
            {
              id: 'history' as SidebarTab,
              icon: Clock,
              label: t('sidebar.queryHistory'),
            },
          ]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setSidebarTab(tab.id);
              setIsCollapsed(false);
            }}
            className={clsx(
              'rounded-md p-1.5 transition-colors group relative',
              sidebarTab === tab.id
                ? 'text-accent-primary bg-accent-primary/10'
                : 'text-muted hover:text-secondary hover:bg-surface-hover',
            )}
            title={tab.label}
          >
            <tab.icon size={14} />
            <Tooltip>{tab.label}</Tooltip>
          </button>
        ))}
      </div>
    );
  }

  return (
    <PanelDatabaseProvider connectionId={explorerConnId}>
      <ExplorerSidebar
        sidebarWidth={sidebarWidth}
        startResize={startResize}
        onCollapse={() => setIsCollapsed(true)}
        sidebarTab={sidebarTab}
        onSidebarTabChange={setSidebarTab}
      />
    </PanelDatabaseProvider>
  );
};

const Tooltip = ({ children }: { children: React.ReactNode }) => (
  <span className="absolute left-12 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none">
    {children}
  </span>
);
