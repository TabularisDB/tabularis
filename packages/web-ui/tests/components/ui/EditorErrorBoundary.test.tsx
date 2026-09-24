import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { EditorErrorBoundary } from "../../../src/components/ui/EditorErrorBoundary";
import { EditorContext } from "../../../src/contexts/EditorContext";
import type { EditorContextType } from "../../../src/contexts/EditorContext";

const HappyChild = () => <div data-testid="happy">happy editor</div>;

let shouldThrow = true;
const Crasher = () => {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <div data-testid="recovered">recovered editor</div>;
};

const buildEditorContext = (
  overrides: Partial<EditorContextType> = {},
): EditorContextType => ({
  tabs: [],
  activeTabId: "tab-1",
  activeTab: null,
  addTab: vi.fn(() => ""),
  openNotebook: vi.fn(),
  closeTab: vi.fn(),
  closeAllTabs: vi.fn(),
  closeOtherTabs: vi.fn(),
  closeTabsToLeft: vi.fn(),
  closeTabsToRight: vi.fn(),
  updateTab: vi.fn(),
  setActiveTabId: vi.fn(),
  getSchema: vi.fn(async () => []),
  ...overrides,
});

const renderAtEditor = (
  children: React.ReactNode,
  ctx: EditorContextType = buildEditorContext(),
) =>
  render(
    <EditorContext.Provider value={ctx}>
      <MemoryRouter initialEntries={["/editor"]}>
        <Routes>
          <Route
            path="/editor"
            element={<EditorErrorBoundary>{children}</EditorErrorBoundary>}
          />
          <Route
            path="/connections"
            element={<div data-testid="connections-page">connections</div>}
          />
        </Routes>
      </MemoryRouter>
    </EditorContext.Provider>,
  );

describe("EditorErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    shouldThrow = true;
    // React itself logs uncaught render errors via console.error before the
    // boundary handles them. Silence to keep test output clean.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error is thrown", () => {
    renderAtEditor(<HappyChild />);
    expect(screen.getByTestId("happy")).toBeInTheDocument();
  });

  it("renders fallback UI with the error message when a child throws", () => {
    renderAtEditor(<Crasher />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("editor.errorBoundary.title")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("logs the caught error to console.error", () => {
    renderAtEditor(<Crasher />);

    const wasLoggedByBoundary = consoleErrorSpy.mock.calls.some((args) =>
      typeof args[0] === "string" &&
      args[0].includes("[Editor] render crash caught by error boundary"),
    );
    expect(wasLoggedByBoundary).toBe(true);
  });

  it("recovers when the user clicks retry and the child no longer throws", () => {
    renderAtEditor(<Crasher />);

    expect(screen.getByText("boom")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText("editor.errorBoundary.retry"));

    expect(screen.getByTestId("recovered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("navigates to /connections when the user clicks back to connections", () => {
    renderAtEditor(<Crasher />);

    fireEvent.click(screen.getByText("editor.errorBoundary.backToConnections"));

    expect(screen.getByTestId("connections-page")).toBeInTheDocument();
  });

  it("closes the active tab and resets the boundary when the user clicks close current tab", () => {
    const closeTab = vi.fn();
    const ctx = buildEditorContext({ activeTabId: "tab-1", closeTab });

    renderAtEditor(<Crasher />, ctx);
    expect(screen.getByText("boom")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText("editor.errorBoundary.closeCurrentTab"));

    expect(closeTab).toHaveBeenCalledWith("tab-1");
    expect(screen.getByTestId("recovered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides the close-current-tab button when there is no active tab", () => {
    const ctx = buildEditorContext({ activeTabId: null });

    renderAtEditor(<Crasher />, ctx);

    expect(
      screen.queryByText("editor.errorBoundary.closeCurrentTab"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("editor.errorBoundary.retry"),
    ).toBeInTheDocument();
  });
});
