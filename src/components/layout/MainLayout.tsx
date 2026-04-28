import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SplitPaneLayout } from './SplitPaneLayout';
import { GlobalTabBar } from './GlobalTabBar';
import { RightPropertiesPanel } from './RightPropertiesPanel';
import { StatusBar } from './StatusBar';
import { MiddleListPanel } from './MiddleListPanel';
import { CommandPalette } from './CommandPalette';
import { MenuBar } from './MenuBar';
import { useConnectionLayoutContext } from '../../hooks/useConnectionLayoutContext';
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts';

export const MainLayout = () => {
  const { splitView, isSplitVisible } = useConnectionLayoutContext();
  const location = useLocation();
  useGlobalShortcuts();

  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const toggleRightPanel = useCallback(
    () => setRightPanelOpen((v) => !v),
    [],
  );

  useEffect(() => {
    const handler = () => toggleRightPanel();
    window.addEventListener('tabularis:toggle-right-panel', handler);
    return () =>
      window.removeEventListener('tabularis:toggle-right-panel', handler);
  }, [toggleRightPanel]);

  const showSplit =
    !!splitView &&
    isSplitVisible &&
    location.pathname !== '/' &&
    location.pathname !== '/connections' &&
    location.pathname !== '/settings';

  return (
    <div className="flex flex-col h-screen bg-base text-primary overflow-hidden">
      <MenuBar />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <MiddleListPanel />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <GlobalTabBar
            rightPanelOpen={rightPanelOpen}
            onToggleRightPanel={toggleRightPanel}
          />
          <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {showSplit ? <SplitPaneLayout {...splitView} /> : <Outlet />}
          </main>
        </div>

        <RightPropertiesPanel
          isOpen={rightPanelOpen}
          onClose={() => setRightPanelOpen(false)}
        />
      </div>

      <StatusBar />

      <CommandPalette />
    </div>
  );
};
