import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { MainLayout } from "../../../src/components/layout/MainLayout";

vi.mock("../../../src/components/layout/Sidebar", () => ({
  Sidebar: () => <aside>Sidebar</aside>,
}));

vi.mock("../../../src/components/layout/RightSidebar", () => ({
  RightSidebar: () => <aside>Right sidebar</aside>,
}));

vi.mock("../../../src/components/layout/SplitPaneLayout", () => ({
  SplitPaneLayout: () => <div>Split pane</div>,
}));

vi.mock("../../../src/components/layout/ProductionBanner", () => ({
  ProductionBanner: () => <div data-testid="production-banner" />,
}));

vi.mock("../../../src/components/layout/CommandPaletteScopeBridge", () => ({
  CommandPaletteScopeBridge: () => null,
}));

vi.mock("../../../src/contexts/CommandPaletteProvider", () => ({
  CommandPaletteProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../../src/components/modals/CommandPaletteModal", () => ({
  CommandPaletteModal: () => <div data-testid="palette-host" />,
}));

vi.mock("../../../src/hooks/useConnectionLayoutContext", () => ({
  useConnectionLayoutContext: () => ({
    splitView: null,
    isSplitVisible: false,
  }),
}));

vi.mock("../../../src/hooks/useGlobalShortcuts", () => ({
  useGlobalShortcuts: vi.fn(),
}));

vi.mock("../../../src/hooks/useAutoConnectFromUrl", () => ({
  useAutoConnectFromUrl: vi.fn(),
}));

vi.mock("../../../src/hooks/useConnectionWindowLifecycle", () => ({
  useConnectionWindowLifecycle: vi.fn(),
}));

describe("MainLayout", () => {
  it("should keep the shared palette host mounted while its input is closed", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("palette-host")).toBeInTheDocument();
  });

  it("should show the production banner only on the connection editor route", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/connections/prod-id/editor"]}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route
              path="connections/:connectionId/editor"
              element={<div>Editor</div>}
            />
            <Route path="settings" element={<div>Settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("production-banner")).toBeInTheDocument();

    unmount();

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route
              path="connections/:connectionId/editor"
              element={<div>Editor</div>}
            />
            <Route path="settings" element={<div>Settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("production-banner")).not.toBeInTheDocument();
  });
});
