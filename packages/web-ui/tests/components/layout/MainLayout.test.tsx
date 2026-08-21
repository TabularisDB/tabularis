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
  ProductionBanner: () => null,
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
});
