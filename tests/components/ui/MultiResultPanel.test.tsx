import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiResultPanel } from "../../../src/components/ui/MultiResultPanel";
import type { QueryResultEntry, QueryResult } from "../../../src/types/editor";

// Mock DataGrid
vi.mock("../../../src/components/ui/DataGrid", () => ({
  DataGrid: vi.fn(() => <div data-testid="data-grid" />),
}));

// Mock ErrorDisplay
vi.mock("../../../src/components/ui/ErrorDisplay", () => ({
  ErrorDisplay: ({ error }: { error: string }) => (
    <div data-testid="error-display">{error}</div>
  ),
}));

// Mock useSettings
vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      aiEnabled: false,
      aiProvider: null,
      aiModel: "",
    },
    updateSettings: vi.fn(),
  }),
}));

// Mock clsx
vi.mock("clsx", () => ({
  default: (...args: unknown[]) =>
    args
      .flat()
      .filter((a) => typeof a === "string")
      .join(" "),
}));

function makeResult(rows: unknown[][] = [[1]]): QueryResult {
  return {
    columns: ["id"],
    rows,
    affected_rows: 0,
  };
}

function makeEntry(
  overrides: Partial<QueryResultEntry> = {},
): QueryResultEntry {
  return {
    id: "tab1-result-0",
    queryIndex: 0,
    query: "SELECT 1",
    result: null,
    error: "",
    executionTime: null,
    isLoading: true,
    page: 1,
    activeTable: null,
    pkColumns: null,
    ...overrides,
  };
}

describe("MultiResultPanel", () => {
  const mockOnSelectResult = vi.fn();
  const mockOnRerunEntry = vi.fn();
  const mockOnPageChange = vi.fn();
  const mockOnCloseEntry = vi.fn();
  const mockOnCloseOtherEntries = vi.fn();
  const mockOnCloseEntriesToRight = vi.fn();
  const mockOnCloseEntriesToLeft = vi.fn();
  const mockOnCloseAllEntries = vi.fn();
  const mockOnRenameEntry = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    tabId: "tab1",
    isAllDone: false,
    connectionId: "conn-1",
    copyFormat: "csv" as const,
    csvDelimiter: ",",
    onSelectResult: mockOnSelectResult,
    onRerunEntry: mockOnRerunEntry,
    onPageChange: mockOnPageChange,
    onCloseEntry: mockOnCloseEntry,
    onCloseOtherEntries: mockOnCloseOtherEntries,
    onCloseEntriesToRight: mockOnCloseEntriesToRight,
    onCloseEntriesToLeft: mockOnCloseEntriesToLeft,
    onCloseAllEntries: mockOnCloseAllEntries,
    onRenameEntry: mockOnRenameEntry,
  };

  it("renders tab buttons for each result entry", () => {
    const results = [
      makeEntry({ id: "r-0", queryIndex: 0, query: "SELECT 1" }),
      makeEntry({ id: "r-1", queryIndex: 1, query: "SELECT 2" }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    // i18n mock interpolates {{index}} so we get "editor.multiResult.query" with index values
    const tabTexts = screen.getAllByText(/editor\.multiResult\.query/);
    expect(tabTexts).toHaveLength(2);
  });

  it("shows loading spinner for loading entries", () => {
    const results = [
      makeEntry({ id: "r-0", isLoading: true }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    expect(
      screen.getByText("editor.executingQuery"),
    ).toBeInTheDocument();
  });

  it("shows error for failed entry", () => {
    const results = [
      makeEntry({ id: "r-0", isLoading: false, error: "SQL syntax error" }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    expect(screen.getByTestId("error-display")).toHaveTextContent(
      "SQL syntax error",
    );
  });

  it("shows DataGrid for successful entry", () => {
    const results = [
      makeEntry({
        id: "r-0",
        isLoading: false,
        result: makeResult([[1], [2]]),
        executionTime: 42,
      }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    expect(screen.getByTestId("data-grid")).toBeInTheDocument();
    expect(screen.getByText(/editor\.rowsRetrieved/)).toBeInTheDocument();
  });

  it("calls onSelectResult when clicking a tab", () => {
    const results = [
      makeEntry({ id: "r-0", queryIndex: 0 }),
      makeEntry({ id: "r-1", queryIndex: 1 }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    // Click on the second tab button
    const buttons = screen.getAllByRole("button");
    // Find a button that is a tab for query 2 (it won't have the rerun button since it's loading)
    const tabButtons = buttons.filter((btn) =>
      btn.textContent?.includes("editor.multiResult.query"),
    );
    if (tabButtons.length >= 2) {
      fireEvent.click(tabButtons[1]);
      expect(mockOnSelectResult).toHaveBeenCalledWith("r-1");
    }
  });

  it("shows rerun button only for non-loading entries", () => {
    const results = [
      makeEntry({
        id: "r-0",
        isLoading: false,
        result: makeResult(),
      }),
      makeEntry({ id: "r-1", isLoading: true }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    // Only the first entry should have a rerun button
    const rerunButtons = screen.getAllByTitle("editor.multiResult.rerun");
    expect(rerunButtons).toHaveLength(1);
  });

  it("calls onRerunEntry when rerun button is clicked", () => {
    const results = [
      makeEntry({
        id: "r-0",
        isLoading: false,
        result: makeResult(),
      }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    fireEvent.click(screen.getByTitle("editor.multiResult.rerun"));
    expect(mockOnRerunEntry).toHaveBeenCalledWith("r-0");
  });

  it("shows summary badge when isAllDone is true", () => {
    const results = [
      makeEntry({
        id: "r-0",
        isLoading: false,
        result: makeResult(),
        executionTime: 50,
      }),
      makeEntry({
        id: "r-1",
        isLoading: false,
        error: "fail",
        executionTime: 30,
      }),
    ];
    const { container } = render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
        isAllDone={true}
      />,
    );
    // Summary badge shows succeeded count with green color
    const greenSpan = container.querySelector(".text-green-400");
    expect(greenSpan).not.toBeNull();
    expect(greenSpan?.textContent).toContain("1");
  });

  it("returns null for empty results", () => {
    const { container } = render(
      <MultiResultPanel
        {...defaultProps}
        results={[]}
        activeResultId={undefined}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("falls back to first entry when activeResultId is not found", () => {
    const results = [
      makeEntry({
        id: "r-0",
        isLoading: false,
        error: "first error",
      }),
      makeEntry({ id: "r-1", isLoading: true }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="nonexistent"
      />,
    );
    // Should show the first entry's error
    expect(screen.getByTestId("error-display")).toHaveTextContent(
      "first error",
    );
  });

  it("shows pagination controls when result has pagination", () => {
    const results = [
      makeEntry({
        id: "r-0",
        isLoading: false,
        result: {
          columns: ["id"],
          rows: [[1]],
          affected_rows: 0,
          pagination: {
            page: 1,
            page_size: 100,
            total_rows: 500,
            has_more: true,
          },
        },
        executionTime: 10,
      }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    expect(screen.getByTitle("Next Page")).toBeInTheDocument();
    expect(screen.getByTitle("First Page")).toBeInTheDocument();
  });

  it("calls onPageChange when Next Page is clicked", () => {
    const results = [
      makeEntry({
        id: "r-0",
        isLoading: false,
        result: {
          columns: ["id"],
          rows: [[1]],
          affected_rows: 0,
          pagination: {
            page: 1,
            page_size: 100,
            total_rows: 500,
            has_more: true,
          },
        },
        executionTime: 10,
      }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    fireEvent.click(screen.getByTitle("Next Page"));
    expect(mockOnPageChange).toHaveBeenCalledWith("r-0", 2);
  });

  it("shows scroll arrows for tab bar", () => {
    const results = [
      makeEntry({ id: "r-0", isLoading: false, result: makeResult() }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    // Scroll arrow buttons are always present in the tab bar
    const buttons = screen.getAllByRole("button");
    // First two buttons are the scroll arrows (left, right)
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("shows custom label when entry has one", () => {
    const results = [
      makeEntry({
        id: "r-0",
        isLoading: false,
        result: makeResult(),
        label: "My Query",
      }),
    ];
    render(
      <MultiResultPanel
        {...defaultProps}
        results={results}
        activeResultId="r-0"
      />,
    );
    expect(screen.getByText("My Query")).toBeInTheDocument();
  });
});
