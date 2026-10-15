import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SqlCell } from "../../../src/components/notebook/SqlCell";
import type { SqlCellEditor } from "../../../src/components/notebook/SqlCellEditor";
import type { SqlCellExplain } from "../../../src/components/notebook/SqlCellExplain";
import type { SqlCellResult } from "../../../src/components/notebook/SqlCellResult";
import type { ResolvedQuery } from "../../../src/utils/notebookVariables";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: { refs?: string }) => options?.refs ? `${key}: ${options.refs}` : key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("lucide-react", () => vi.importActual("lucide-react"));
vi.mock("../../../src/components/notebook/SqlCellEditor", () => ({
  SqlCellEditor: (props: ComponentProps<typeof SqlCellEditor>) => (
    <section data-testid="editor" data-connection={props.connectionId} data-schema={props.schema}>
      <textarea aria-label="SQL editor" value={props.content}
        onChange={(event) => props.onContentChange(event.target.value)} />
      <button onClick={props.onRun}>Run SQL</button>
      <button onClick={props.onToggleCollapse}>Toggle query</button>
    </section>
  ),
}));
vi.mock("../../../src/components/notebook/SqlCellResult", () => ({
  SqlCellResult: (props: ComponentProps<typeof SqlCellResult>) => (
    <div data-testid="result-error">{props.error}</div>
  ),
}));
vi.mock("../../../src/components/notebook/SqlCellExplain", () => ({
  SqlCellExplain: (props: ComponentProps<typeof SqlCellExplain>) => (
    <section data-testid="explain" data-connection={props.connectionId} data-schema={props.schema}
      data-visible={String(props.visible)}>
      <div data-testid="explain-query">{props.query}</div>
      {props.queryError && <div role="alert">{props.queryError}</div>}
      <button onClick={props.onToggleVisible}>Toggle plan</button>
    </section>
  ),
}));

function makeProps(): ComponentProps<typeof SqlCell> {
  return {
    cell: { id: "cell-2", type: "sql", content: "SELECT * FROM {{cell_1}}", isQueryPlanVisible: true },
    connectionId: "cell-connection", schema: "analytics",
    onContentChange: vi.fn(), onRun: vi.fn(), onToggleQueryCollapse: vi.fn(),
    onToggleResultCollapse: vi.fn(), onToggleChartVisible: vi.fn(), onToggleQueryPlanVisible: vi.fn(),
  };
}

describe("SqlCell explain query wiring", () => {
  it("keeps raw editor content while forwarding resolved SQL, connection and schema to explain", () => {
    const props = makeProps();
    const explainQuery: ResolvedQuery = {
      sql: "WITH cell_1 AS (SELECT 42 AS id) SELECT * FROM cell_1", unresolvedRefs: [],
    };
    render(<SqlCell {...props} explainQuery={explainQuery} />);
    expect(screen.getByRole("textbox", { name: "SQL editor" })).toHaveValue(props.cell.content);
    expect(screen.getByTestId("explain-query")).toHaveTextContent(explainQuery.sql);
    for (const child of ["editor", "explain"]) {
      expect(screen.getByTestId(child)).toHaveAttribute("data-connection", "cell-connection");
      expect(screen.getByTestId(child)).toHaveAttribute("data-schema", "analytics");
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to raw SQL when there is no resolved explain query", () => {
    const props = makeProps();
    render(<SqlCell {...props} cell={{ ...props.cell, content: "SELECT 1" }} />);
    expect(screen.getByTestId("explain-query")).toHaveTextContent("SELECT 1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not fall back to raw content when the resolved SQL is deliberately empty", () => {
    render(<SqlCell {...makeProps()} explainQuery={{ sql: "", unresolvedRefs: [] }} />);
    expect(screen.getByTestId("explain-query")).toBeEmptyDOMElement();
    expect(screen.getByRole("textbox", { name: "SQL editor" })).toHaveValue("SELECT * FROM {{cell_1}}");
  });

  it("deduplicates unresolved references in the explain error without replacing editor content", () => {
    const props = makeProps();
    render(<SqlCell {...props} explainQuery={{
      sql: "SELECT * FROM {{cell_1}} JOIN {{cell_3}} ON true",
      unresolvedRefs: [
        { match: "{{cell_1}}", cellIndex: 0 },
        { match: "{{cell_1}}", cellIndex: 0 },
        { match: "{{cell_3}}", cellIndex: 2 },
      ],
    }} />);
    expect(screen.getByRole("alert").textContent).toBe(
      "editor.notebook.queryPlanUnresolved: {{cell_1}}, {{cell_3}}",
    );
    expect(screen.getByRole("textbox", { name: "SQL editor" })).toHaveValue(props.cell.content);
  });

  it("clears the explain resolution error when references become available", () => {
    const props = makeProps();
    const { rerender } = render(<SqlCell {...props} explainQuery={{
      sql: props.cell.content, unresolvedRefs: [{ match: "{{cell_1}}", cellIndex: 0 }],
    }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<SqlCell {...props} explainQuery={{ sql: "SELECT * FROM resolved_cell", unresolvedRefs: [] }} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("explain-query")).toHaveTextContent("SELECT * FROM resolved_cell");
    expect(screen.getByRole("textbox", { name: "SQL editor" })).toHaveValue(props.cell.content);
  });

  it("keeps a prior SQL execution error separate from explain query resolution", () => {
    const props = makeProps();
    render(<SqlCell {...props} cell={{ ...props.cell, error: "Previous execution failed" }}
      explainQuery={{ sql: "SELECT 1", unresolvedRefs: [] }} />);
    expect(screen.getByTestId("result-error")).toHaveTextContent("Previous execution failed");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("explain-query")).toHaveTextContent("SELECT 1");
  });

  it("forwards visibility and the plan toggle without mutating the controlled cell", () => {
    const props = makeProps();
    const { rerender } = render(<SqlCell {...props} cell={{ ...props.cell, isQueryPlanVisible: undefined }} />);
    expect(screen.getByTestId("explain")).toHaveAttribute("data-visible", "false");
    fireEvent.click(screen.getByRole("button", { name: "Toggle plan" }));
    expect(props.onToggleQueryPlanVisible).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("explain")).toHaveAttribute("data-visible", "false");
    rerender(<SqlCell {...props} />);
    expect(screen.getByTestId("explain")).toHaveAttribute("data-visible", "true");
  });

  it("preserves raw editing, running and query collapse callbacks", () => {
    const props = makeProps();
    render(<SqlCell {...props} explainQuery={{ sql: "SELECT 42", unresolvedRefs: [] }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "SQL editor" }), {
      target: { value: "SELECT id FROM {{cell_1}}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run SQL" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle query" }));
    expect(props.onContentChange).toHaveBeenCalledExactlyOnceWith("SELECT id FROM {{cell_1}}");
    expect(props.onRun).toHaveBeenCalledTimes(1);
    expect(props.onToggleQueryCollapse).toHaveBeenCalledTimes(1);
    expect(props.onToggleQueryPlanVisible).not.toHaveBeenCalled();
  });
});