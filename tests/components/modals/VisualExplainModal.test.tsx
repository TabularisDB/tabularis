import { StrictMode, type ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { parseExplain, type ExplainPlan, type ExplainQueryOutput } from "@tabularis/explain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisualExplainModal } from "../../../src/components/modals/VisualExplainModal";
import type { VisualExplainViewProps } from "../../../src/components/explain/VisualExplainView";

const database = vi.hoisted(() => ({ getConnectionData: vi.fn() }));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("lucide-react", () => vi.importActual("lucide-react"));
vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ ...database, connections: [] }),
}));
vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { aiEnabled: true } }),
}));
vi.mock("../../../src/hooks/useDrivers", () => ({
  useDrivers: () => ({ allDrivers: [{ id: "postgres", name: "PostgreSQL" }] }),
}));
vi.mock("../../../src/utils/driverUI", () => ({ getConnectionIcon: () => null }));
vi.mock("../../../src/components/explain/VisualExplainView", () => ({
  VisualExplainView: (props: VisualExplainViewProps) => (
    <section data-testid="explain-view">
      {props.plan && <div data-testid="plan">{props.plan.original_query}</div>}
      {props.error && <div role="alert">{props.error}</div>}
      {props.isLoading && <div data-testid="loading">Loading</div>}
      <div data-testid="mode">{props.viewMode}</div>
      <div data-testid="selection">{props.selectedNodeId ?? "none"}</div>
      <div data-testid="ai-enabled">{String(props.aiEnabled)}</div>
      <button onClick={() => props.onViewModeChange("table")}>Table view</button>
      <button onClick={() => props.onSelectNode("child")}>Select child</button>
    </section>
  ),
}));

type Props = ComponentProps<typeof VisualExplainModal>;
const defaults: Props = {
  isOpen: true, onClose: vi.fn(), query: "SELECT * FROM widgets", connectionId: "connection-1",
};
const mockInvoke = vi.mocked(invoke);

function makePlan(id = "resolved"): ExplainPlan {
  const plan = parseExplain('[{"Plan":{"Node Type":"Result"}}]');
  return { ...plan, original_query: id, root: { ...plan.root, id } };
}

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

describe("VisualExplainModal legacy execution", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue({ kind: "plan", plan: makePlan() });
    database.getConnectionData.mockReset().mockReturnValue({
      driver: "postgres", connectionName: "Live connection", databaseName: "warehouse", activeSchema: "public",
    });
    vi.mocked(defaults.onClose).mockClear();
  });

  it("does not render or invoke while closed", async () => {
    render(<VisualExplainModal {...defaults} isOpen={false} />);
    await settle();
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("runs SELECT with Analyze enabled and null schema exactly once under StrictMode", async () => {
    render(<StrictMode><VisualExplainModal {...defaults} /></StrictMode>);
    expect(mockInvoke).not.toHaveBeenCalled();
    await settle();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: "connection-1", query: defaults.query, analyze: true, schema: null,
    });
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByTestId("plan")).toHaveTextContent("resolved");
    expect(screen.getByTestId("selection")).toHaveTextContent("resolved");
    expect(screen.getByTestId("ai-enabled")).toHaveTextContent("true");
  });

  it.each([
    "DELETE FROM widgets WHERE id = 1",
    "UPDATE widgets SET name = 'new'",
    "INSERT INTO widgets (id) VALUES (1)",
  ])("defaults DML to plain EXPLAIN and shows its warning: %s", async (query) => {
    render(<VisualExplainModal {...defaults} query={query} schema="reporting" />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: "connection-1", query, analyze: false, schema: "reporting",
    });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("editor.visualExplain.analyzeWarning")).toBeInTheDocument();
  });

  it("uses live connection labels and explicit schema ahead of fallback labels", async () => {
    render(<VisualExplainModal {...defaults} schema="reporting" connectionLabel="Fallback connection" />);
    await settle();
    expect(database.getConnectionData).toHaveBeenCalledWith("connection-1");
    expect(screen.getByText("Live connection")).toBeInTheDocument();
    expect(screen.queryByText("Fallback connection")).not.toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("warehouse / reporting")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
      connectionId: "connection-1", query: defaults.query, analyze: true, schema: "reporting",
    });
  });

  it.each([
    { connectionLabel: "Activity connection", label: "Activity connection" },
    { connectionLabel: undefined, label: "connection-1" },
  ])("falls back to $label when live connection data is unavailable", async ({ connectionLabel, label }) => {
    database.getConnectionData.mockReturnValue(undefined);
    render(<VisualExplainModal {...defaults} connectionLabel={connectionLabel} schema="archive" />);
    await settle();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    { field: "schema", change: { schema: "reporting" } },
    { field: "query", change: { query: "SELECT id FROM widgets" } },
    { field: "connection", change: { connectionId: "connection-2" } },
  ])("retains legacy rerunning when its $field changes", async ({ change }) => {
    const { rerender } = render(<VisualExplainModal {...defaults} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    rerender(<VisualExplainModal {...defaults} {...change} />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
      connectionId: "connection-1", query: defaults.query, analyze: true, schema: null, ...change,
    });
    expect(screen.getByTestId("mode")).toHaveTextContent("graph");
  });

  it.each([
    { name: "an untouched checkbox", optIn: false },
    { name: "an opt-in made for the previous query", optIn: true },
  ])("stops analyzing with $name once its query becomes data modifying", async ({ optIn }) => {
    const { rerender } = render(<VisualExplainModal {...defaults} />);
    await settle();
    if (optIn) {
      await act(async () => { fireEvent.click(screen.getByRole("checkbox")); });
      await act(async () => { fireEvent.click(screen.getByRole("checkbox")); });
    }
    const query = "UPDATE widgets SET name = 'new'";
    rerender(<VisualExplainModal {...defaults} query={query} />);
    await settle();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("editor.visualExplain.analyzeWarning")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
      connectionId: "connection-1", query, analyze: false, schema: null,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "editor.visualExplain.rerun" }));
    });
    expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
      connectionId: "connection-1", query, analyze: false, schema: null,
    });
  });

  it("retains legacy execution on Analyze change and explicit rerun", async () => {
    render(<VisualExplainModal {...defaults} schema="reporting" />);
    await settle();
    await act(async () => { fireEvent.click(screen.getByRole("checkbox")); });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
      connectionId: "connection-1", query: defaults.query, analyze: false, schema: "reporting",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "editor.visualExplain.rerun" }));
    });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
      connectionId: "connection-1", query: defaults.query, analyze: false, schema: "reporting",
    });
  });

  it("displays execution failures and clears them after a successful retry", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Explain failed"));
    render(<VisualExplainModal {...defaults} />);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Explain failed");
    expect(screen.queryByTestId("plan")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "editor.visualExplain.rerun" }));
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan")).toHaveTextContent("resolved");
  });

  it("reports non-explainable SQL without invoking", async () => {
    render(<VisualExplainModal {...defaults} query="VACUUM" />);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("editor.visualExplain.notExplainable");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("closes through the real Modal Escape handler and reruns once when reopened", async () => {
    const { rerender } = render(<VisualExplainModal {...defaults} />);
    await settle();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(defaults.onClose).toHaveBeenCalledTimes(1);
    rerender(<VisualExplainModal {...defaults} isOpen={false} />);
    await settle();
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    rerender(<VisualExplainModal {...defaults} />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "editor.visualExplain.close" }));
    expect(defaults.onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores a request from before close after a reopened request has completed", async () => {
    let resolveOld!: (value: ExplainQueryOutput) => void;
    mockInvoke.mockReturnValueOnce(new Promise<ExplainQueryOutput>((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<VisualExplainModal {...defaults} />);
    await settle();
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "editor.visualExplain.rerun" })).toBeDisabled();
    rerender(<VisualExplainModal {...defaults} isOpen={false} />);
    rerender(<VisualExplainModal {...defaults} />);
    await settle();
    expect(screen.getByTestId("plan")).toHaveTextContent("resolved");
    await act(async () => { resolveOld({ kind: "plan", plan: makePlan("obsolete") }); });
    expect(screen.getByTestId("plan")).toHaveTextContent("resolved");
    expect(screen.getByTestId("selection")).toHaveTextContent("resolved");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

describe("VisualExplainModal display-only viewState", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    database.getConnectionData.mockReset().mockReturnValue(undefined);
    vi.mocked(defaults.onClose).mockClear();
  });

  it("displays a supplied DML plan under StrictMode without execution controls or invokes", async () => {
    const viewState: VisualExplainViewProps = {
      plan: makePlan("analyzed DML"), isLoading: false, error: null, viewMode: "raw",
      selectedNodeId: "supplied-node", onViewModeChange: vi.fn(), onSelectNode: vi.fn(), aiEnabled: false,
    };
    const props = { ...defaults, query: "DELETE FROM widgets", schema: "analytics", viewState };
    const { rerender } = render(<StrictMode><VisualExplainModal {...props} /></StrictMode>);
    await settle();
    expect(screen.getByTestId("plan")).toHaveTextContent("analyzed DML");
    expect(screen.getByTestId("mode")).toHaveTextContent("raw");
    expect(screen.getByTestId("selection")).toHaveTextContent("supplied-node");
    expect(screen.getByTestId("ai-enabled")).toHaveTextContent("false");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "editor.visualExplain.rerun" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(screen.getByRole("button", { name: "Select child" }));
    expect(viewState.onViewModeChange).toHaveBeenCalledExactlyOnceWith("table");
    expect(viewState.onSelectNode).toHaveBeenCalledExactlyOnceWith("child");
    rerender(<StrictMode><VisualExplainModal {...props} isOpen={false} /></StrictMode>);
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    rerender(<StrictMode><VisualExplainModal {...props} /></StrictMode>);
    await settle();
    expect(screen.getByTestId("mode")).toHaveTextContent("raw");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("reflects supplied loading, errors and view changes without running on query/schema/connection changes", async () => {
    const viewState: VisualExplainViewProps = {
      plan: makePlan(), isLoading: false, error: null, viewMode: "graph", selectedNodeId: "resolved",
      onViewModeChange: vi.fn(), onSelectNode: vi.fn(), aiEnabled: true,
    };
    const { rerender } = render(<VisualExplainModal {...defaults} viewState={viewState} />);
    await settle();
    rerender(<VisualExplainModal {...defaults} query="UPDATE widgets SET id = 2" schema="new_schema"
      connectionId="new-connection" viewState={{ ...viewState, plan: null, isLoading: true }} />);
    expect(screen.queryByTestId("plan")).not.toBeInTheDocument();
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    rerender(<VisualExplainModal {...defaults} viewState={{
      ...viewState, plan: null, error: "Query plan is outdated", viewMode: "table", selectedNodeId: null,
    }} />);
    await settle();
    expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Query plan is outdated");
    expect(screen.getByTestId("mode")).toHaveTextContent("table");
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});