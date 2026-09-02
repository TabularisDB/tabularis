import { Outlet, useLocation } from "react-router-dom";

import { CommandPaletteProvider } from "../../contexts/CommandPaletteProvider";
import { useAutoConnectFromUrl } from "../../hooks/useAutoConnectFromUrl";
import { useConnectionLayoutContext } from "../../hooks/useConnectionLayoutContext";
import { useConnectionWindowLifecycle } from "../../hooks/useConnectionWindowLifecycle";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { resolveRenderedSplitLayout } from "../../utils/connectionLayout";
import { ROOT_COMMAND_SCOPE_ID } from "../../utils/commandScopeStore";
import { CommandPaletteModal } from "../modals/CommandPaletteModal";
import { CommandPaletteScopeBridge } from "./CommandPaletteScopeBridge";
import { ProductionBanner } from "./ProductionBanner";
import { RightSidebar } from "./RightSidebar";
import { Sidebar } from "./Sidebar";
import { SplitPaneLayout } from "./SplitPaneLayout";

const MainLayoutContent = () => {
  const { splitView, isSplitVisible } = useConnectionLayoutContext();
  const location = useLocation();
  useGlobalShortcuts();
  useAutoConnectFromUrl();
  useConnectionWindowLifecycle();

  const renderedSplit = resolveRenderedSplitLayout({
    splitView,
    isSplitVisible,
    pathname: location.pathname,
  });

  return (
    <div className="flex h-screen bg-base text-primary overflow-hidden">
      <CommandPaletteScopeBridge scopeId={ROOT_COMMAND_SCOPE_ID} />
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {location.pathname === "/editor" && <ProductionBanner />}
        {/* Routed pages size themselves with h-full, which resolves against
            this wrapper — not against <main>. Without it the production banner
            would push the page down without shrinking it, clipping the bottom
            row of the results grid. */}
        <div className="flex-1 min-h-0 min-w-0">
          {renderedSplit ? (
            <SplitPaneLayout {...renderedSplit} />
          ) : (
            <Outlet />
          )}
        </div>
      </main>
      <RightSidebar />
      <CommandPaletteModal />
    </div>
  );
};

export const MainLayout = () => (
  <CommandPaletteProvider>
    <MainLayoutContent />
  </CommandPaletteProvider>
);
