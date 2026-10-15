import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultEntryContent } from "../../../src/components/ui/ResultEntryContent";
import { StackedResultItem } from "../../../src/components/ui/StackedResultItem";
import type { QueryResult, QueryResultEntry } from "../../../src/types/editor";

// The shared mock returns the bare key; these tests need the count it was given.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("../../../src/components/ui/DataGrid", () => ({
  DataGrid: () => <div data-testid="data-grid" />,
}));

vi.mock("../../../src/components/ui/ErrorDisplay", () => ({
  ErrorDisplay: ({ error }: { error: string }) => <div>{error}</div>,
}));

function makeEntry(result: QueryResult): QueryResultEntry {
  return {
    id: "tab1-result-0",
    queryIndex: 0,
    query: "SELECT * FROM users",
    result,
    error: "",
    executionTime: 12,
    isLoading: false,
    page: 1,
    activeTable: null,
    pkColumns: null,
  };
}

const wide: QueryResult = {
  columns: ["id", "name", "email"],
  rows: [[1, "Ada", "ada@example.com"]],
  affected_rows: 0,
};

const noColumns: QueryResult = { columns: [], rows: [], affected_rows: 3 };

const gridProps = {
  connectionId: "c1",
  copyFormat: "csv" as const,
  csvDelimiter: ",",
  csvIncludeHeaders: true,
  onPageChange: vi.fn(),
};

describe("result status bar column count", () => {
  it("shows the number of columns next to the row count in a result entry", () => {
    render(<ResultEntryContent {...gridProps} entry={makeEntry(wide)} />);
    expect(screen.getByText(/editor\.rowsRetrieved:1/)).toBeInTheDocument();
    expect(screen.getByText(/editor\.columnsCount:3/)).toBeInTheDocument();
  });

  it("shows the number of columns in the header of a stacked result", () => {
    render(
      <StackedResultItem
        {...gridProps}
        entry={makeEntry(wide)}
        collapsed={false}
        aiEnabled={false}
        aiRenaming={false}
        onToggleCollapse={vi.fn()}
        onCopyAllRows={vi.fn()}
        onRename={vi.fn()}
        onRerun={vi.fn()}
        onAiRename={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/editor\.columnsCount:3/)).toBeInTheDocument();
  });

  it("leaves a statement without a result set unchanged", () => {
    render(<ResultEntryContent {...gridProps} entry={makeEntry(noColumns)} />);
    expect(screen.queryByText(/editor\.columnsCount/)).not.toBeInTheDocument();
  });
});
