import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { parseExplain } from "@tabularis/explain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookCellWrapper } from "../../../src/components/notebook/NotebookCellWrapper";
import type { SqlCellEditor } from "../../../src/components/notebook/SqlCellEditor";
import type { VisualExplainViewProps } from "../../../src/components/explain/VisualExplainView";

const database = vi.hoisted(() => ({
  getConnectionData: vi.fn(), capabilities: { explain: false },
}));
vi.mock("react-i18next", () => {
  const t = (key: string, options?: { refs?: string }) => options?.refs ? `${key}: ${options.refs}` : key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("lucide-react", () => vi.importActual("lucide-react"));
vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ ...database, connections: [] }),
}));
vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { aiEnabled: false } }),
}));
vi.mock("../../../src/hooks/useDrivers", () => ({
  useDrivers: () => ({ allDrivers: [] }),
}));
vi.mock("../../../src/utils/driverUI", () => ({ getConnectionIcon: () => null }));
vi.mock("../../../src/components/notebook/CellNameAiButton", () => ({ CellNameAiButton: () => null }));
vi.mock("../../../src/components/notebook/CellHistoryPanel", () => ({ CellHistoryPanel: () => null }));
vi.mock("../../../src/components/notebook/MarkdownCell", () => ({
  MarkdownCell: () => <div data-testid="markdown">Markdown content</div>,
}));
vi.mock("../../../src/components/notebook/SqlCellEditor", () => ({
  SqlCellEditor: (props: ComponentProps<typeof SqlCellEditor>) => (
    <textarea aria-label="SQL editor" readOnly value={props.content} data-schema={props.schema} />
  ),
}));
vi.mock("../../../src/components/notebook/SqlCellResult", () => ({ SqlCellResult: () => null }));
vi.mock("../../../src/components/explain/VisualExplainView", () => ({
  VisualExplainView: (props: VisualExplainViewProps) => (
    <section data-testid="explain-view">
      {props.plan && <div data-testid="plan">{props.plan.root.node_type}</div>}
      {props.error && <div role="alert">{props.error}</div>}
      {props.isLoading && <div data-testid="loading">Loading</div>}
    </section>
  ),
}));

const mockInvoke = vi.mocked(invoke);

function makeProps(): ComponentProps<typeof NotebookCellWrapper> {
  return {
    cell: { id: "cell-2", type: "sql", content: "SELECT * FROM widgets" },
    index: 1, totalCells: 3, connectionId: "cell-connection", activeSchema: "analytics",
    onUpdate: vi.fn(), onDelete: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onRun: vi.fn(),
  };
}

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

describe("NotebookCellWrapper query plans", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue({
      kind: "plan", plan: parseExplain('[{"Plan":{"Node Type":"Result"}}]'),
    });
    database.capabilities = { explain: false };
    database.getConnectionData.mockReset().mockImplementation((id: string) => {
      if (id === "not-loaded") return undefined;
      return { capabilities: { explain: id !== "unsupported" }, driver: "postgres" };
    });
  });

  it.each([
    { connectionId: "cell-connection", activeExplain: false, hasToggle: true },
    { connectionId: "unsupported", activeExplain: true, hasToggle: false },
    { connectionId: "not-loaded", activeExplain: true, hasToggle: false },
  ])("gates the toggle by $connectionId rather than active capabilities", async ({ connectionId, activeExplain, hasToggle }) => {
    database.capabilities = { explain: activeExplain };
    render(<NotebookCellWrapper {...makeProps()} connectionId={connectionId} />);
    await settle();
    const toggle = screen.queryByRole("button", { name: "editor.notebook.toggleQueryPlan" });
    if (hasToggle) expect(toggle).toHaveAttribute("aria-pressed", "false");
    else expect(toggle).not.toBeInTheDocument();
    expect(database.getConnectionData).toHaveBeenCalledWith(connectionId);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("persists visibility through onUpdate and reuses the plan after toggling off and on", async () => {
    const props = makeProps();
    const { rerender } = render(<NotebookCellWrapper {...props} />);
    const toggle = screen.getByRole("button", { name: "editor.notebook.toggleQueryPlan" });
    fireEvent.click(toggle);
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ isQueryPlanVisible: true });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(mockInvoke).not.toHaveBeenCalled();
    rerender(<NotebookCellWrapper {...props} cell={{ ...props.cell, isQueryPlanVisible: true }} />);
    await settle();
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAccessibleName("editor.notebook.hideQueryPlan");
    expect(toggle).toHaveAttribute("title", "editor.notebook.hideQueryPlan");
    expect(screen.getByTestId("plan")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    fireEvent.click(toggle);
    expect(props.onUpdate).toHaveBeenLastCalledWith({ isQueryPlanVisible: false });
    rerender(<NotebookCellWrapper {...props} cell={{ ...props.cell, isQueryPlanVisible: false }} />);
    await settle();
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(props.onUpdate).toHaveBeenLastCalledWith({ isQueryPlanVisible: true });
    rerender(<NotebookCellWrapper {...props} cell={{ ...props.cell, isQueryPlanVisible: true }} />);
    await settle();
    expect(screen.getByTestId("plan")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(props.onRun).not.toHaveBeenCalled();
  });

  it("persists hiding from the inline section header through the same onUpdate path", async () => {
    const props = makeProps();
    const { rerender } = render(<NotebookCellWrapper {...props} cell={{ ...props.cell, isQueryPlanVisible: true }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "editor.notebook.sectionQueryPlan" }));
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ isQueryPlanVisible: false });
    rerender(<NotebookCellWrapper {...props} cell={{ ...props.cell, isQueryPlanVisible: false }} />);
    await settle();
    const toggle = screen.getByRole("button", { name: "editor.notebook.toggleQueryPlan" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("title", "editor.notebook.toggleQueryPlan");
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("never offers a query plan or run button for markdown even with persisted visibility", async () => {
    const props = makeProps();
    render(<NotebookCellWrapper {...props} cell={{ ...props.cell, type: "markdown", isQueryPlanVisible: true }} />);
    await settle();
    expect(screen.getByTestId("markdown")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "editor.notebook.toggleQueryPlan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "editor.notebook.runCell" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each(["reporting", undefined])("forwards resolved SQL and effective schema %s into the real explain hook", async (activeSchema) => {
    const props = makeProps();
    const raw = "SELECT * FROM {{cell_1}}";
    const sql = "WITH cell_1 AS (SELECT 42 AS id) SELECT * FROM cell_1";
    render(<NotebookCellWrapper {...props} activeSchema={activeSchema}
      cell={{ ...props.cell, content: raw, schema: "stored-schema", isQueryPlanVisible: true }}
      explainQuery={{ sql, unresolvedRefs: [] }} />);
    await settle();
    expect(screen.getByRole("textbox", { name: "SQL editor" })).toHaveValue(raw);
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: "cell-connection", query: sql, schema: activeSchema ?? null, analyze: false,
    });
    expect(screen.getByTestId("plan")).toHaveTextContent("Result");
  });

  it("does not mount or invoke a persisted query plan while the whole cell is collapsed", async () => {
    const props = makeProps();
    const cell = { ...props.cell, isCollapsed: true, isQueryPlanVisible: true };
    const { rerender } = render(<NotebookCellWrapper {...props} cell={cell} />);
    await settle();
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "SQL editor" })).not.toBeInTheDocument();
    rerender(<NotebookCellWrapper {...props} cell={cell} activeSchema="reporting" />);
    await settle();
    expect(mockInvoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("editor.notebook.expandCell"));
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ isCollapsed: false });
    expect(mockInvoke).not.toHaveBeenCalled();
    rerender(<NotebookCellWrapper {...props} activeSchema="reporting" cell={{ ...cell, isCollapsed: false }} />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: "cell-connection", query: props.cell.content, schema: "reporting", analyze: false,
    });
  });

  it("forwards schema changes without automatically executing a new plan", async () => {
    const props = makeProps();
    const cell = { ...props.cell, isQueryPlanVisible: true };
    const onSchemaChange = vi.fn();
    const { rerender } = render(<NotebookCellWrapper {...props} cell={cell}
      selectedDatabases={["analytics", "reporting"]} onSchemaChange={onSchemaChange} />);
    await settle();
    fireEvent.click(screen.getByTitle("editor.activeDatabase"));
    fireEvent.click(screen.getByRole("button", { name: "reporting" }));
    expect(onSchemaChange).toHaveBeenCalledExactlyOnceWith("reporting");
    rerender(<NotebookCellWrapper {...props} cell={cell} activeSchema="reporting"
      selectedDatabases={["analytics", "reporting"]} onSchemaChange={onSchemaChange} />);
    await settle();
    expect(screen.queryByTestId("plan")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("editor.notebook.queryPlanOutdated");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByTitle("editor.visualExplain.rerun")); });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
      connectionId: "cell-connection", query: props.cell.content, schema: "reporting", analyze: false,
    });
  });

  it("blocks unresolved cell references until the first valid resolved query is supplied", async () => {
    const props = makeProps();
    const cell = { ...props.cell, content: "SELECT * FROM {{cell_1}}", isQueryPlanVisible: true };
    const { rerender } = render(<NotebookCellWrapper {...props} cell={cell} explainQuery={{
      sql: cell.content, unresolvedRefs: [{ match: "{{cell_1}}", cellIndex: 0 }],
    }} />);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("editor.notebook.queryPlanUnresolved: {{cell_1}}");
    expect(screen.getByTitle("editor.visualExplain.rerun")).toBeDisabled();
    expect(mockInvoke).not.toHaveBeenCalled();
    rerender(<NotebookCellWrapper {...props} cell={cell} explainQuery={{ sql: "SELECT 42", unresolvedRefs: [] }} />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: "cell-connection", query: "SELECT 42", schema: "analytics", analyze: false,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});