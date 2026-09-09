import { StrictMode, type ComponentProps } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { parseExplain, type ExplainQueryOutput } from "@tabularis/explain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SqlCellExplain } from "../../../src/components/notebook/SqlCellExplain";
import type { VisualExplainViewProps } from "../../../src/components/explain/VisualExplainView";

const database = vi.hoisted(() => ({
  getConnectionData: vi.fn(),
  capabilities: { explain: false },
}));

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
  useDrivers: () => ({ allDrivers: [] }),
}));
vi.mock("../../../src/utils/driverUI", () => ({ getConnectionIcon: () => null }));
// Keep the real execution hook, modal and resize handle; replace only the heavy view.
vi.mock("../../../src/components/explain/VisualExplainView", () => ({
  VisualExplainView: (props: VisualExplainViewProps) => (
    <section data-testid="explain-view">
      {props.plan && <div data-testid="plan">{props.plan.original_query}</div>}
      {props.error && <div role="alert">{props.error}</div>}
      {props.isLoading && <div data-testid="loading">Loading</div>}
      <div data-testid="mode">{props.viewMode}</div>
      <div data-testid="selection">{props.selectedNodeId ?? "none"}</div>
      <button onClick={() => props.onViewModeChange("table")}>Table view</button>
      <button onClick={() => props.onViewModeChange("raw")}>Raw view</button>
      <button onClick={() => props.onSelectNode("child")}>Select child</button>
      <button onClick={() => props.onSelectNode(null)}>Clear selection</button>
    </section>
  ),
}));

type Props = ComponentProps<typeof SqlCellExplain>;
const defaults: Props = {
  query: "SELECT * FROM widgets",
  connectionId: "cell-connection",
  schema: "analytics",
  visible: true,
  onToggleVisible: vi.fn(),
};
const mockInvoke = vi.mocked(invoke);

function output(id = "initial"): ExplainQueryOutput {
  const plan = parseExplain('[{"Plan":{"Node Type":"Result"}}]');
  return { kind: "plan", plan: { ...plan, original_query: id, root: { ...plan.root, id } } };
}

function deferred() {
  let resolve!: (value: ExplainQueryOutput) => void;
  const promise = new Promise<ExplainQueryOutput>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

async function rerun() {
  await act(async () => {
    fireEvent.click(screen.getByTitle("editor.visualExplain.rerun"));
  });
}

describe("SqlCellExplain", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(output());
    database.capabilities = { explain: false };
    database.getConnectionData.mockReset().mockImplementation((id: string) => {
      if (id === "not-loaded") return undefined;
      return { capabilities: { explain: id !== "unsupported" }, driver: "postgres" };
    });
    vi.mocked(defaults.onToggleVisible).mockClear();
  });

  it.each([
    { name: "hidden", props: { visible: false } },
    { name: "unsupported connection", props: { connectionId: "unsupported" } },
    { name: "connection not loaded", props: { connectionId: "not-loaded" } },
    { name: "empty query", props: { query: " \n " } },
    { name: "empty connection", props: { connectionId: "" } },
    { name: "unresolved query", props: { queryError: "Resolve cell references first" } },
  ])("does not invoke when initially $name", async ({ props }) => {
    render(<SqlCellExplain {...defaults} {...props} />);
    await settle();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId("plan")).not.toBeInTheDocument();
  });

  it("uses the cell connection's capability even when the active connection cannot explain", async () => {
    render(<SqlCellExplain {...defaults} />);
    await settle();
    expect(database.getConnectionData).toHaveBeenCalledWith("cell-connection");
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: defaults.connectionId, query: defaults.query, schema: "analytics", analyze: false,
    });
    expect(screen.getByTestId("plan")).toHaveTextContent("initial");
  });

  it("does not borrow the active connection's explain capability", async () => {
    database.capabilities = { explain: true };
    render(<SqlCellExplain {...defaults} connectionId="unsupported" />);
    await settle();
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("defers its first request and invokes exactly once with analyze false in StrictMode", async () => {
    render(<StrictMode><SqlCellExplain {...defaults} /></StrictMode>);
    expect(mockInvoke).not.toHaveBeenCalled();
    await settle();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: defaults.connectionId, query: defaults.query, schema: "analytics", analyze: false,
    });
    expect(screen.getByTestId("selection")).toHaveTextContent("initial");
  });

  it("waits for connection data before its first visible request", async () => {
    database.getConnectionData.mockReturnValue(undefined);
    const { rerender } = render(<SqlCellExplain {...defaults} />);
    await settle();
    expect(mockInvoke).not.toHaveBeenCalled();
    database.getConnectionData.mockReturnValue({ capabilities: { explain: true } });
    rerender(<SqlCellExplain {...defaults} />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("plan")).toBeInTheDocument();
  });

  it("keeps a SELECT changed to a write while hidden plain on first reveal", async () => {
    const { rerender } = render(<SqlCellExplain {...defaults} visible={false} />);
    await settle();
    const query = "DELETE FROM widgets WHERE id = 1";
    rerender(<SqlCellExplain {...defaults} query={query} visible={false} />);
    await settle();
    expect(mockInvoke).not.toHaveBeenCalled();
    rerender(<SqlCellExplain {...defaults} query={query} />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: defaults.connectionId, query, schema: "analytics", analyze: false,
    });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("preserves the plan without rerunning after hide and reveal", async () => {
    const { rerender } = render(<SqlCellExplain {...defaults} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "editor.notebook.sectionQueryPlan" }));
    expect(defaults.onToggleVisible).toHaveBeenCalledTimes(1);
    rerender(<SqlCellExplain {...defaults} visible={false} />);
    await settle();
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    rerender(<SqlCellExplain {...defaults} />);
    await settle();
    expect(screen.getByTestId("plan")).toHaveTextContent("initial");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "query", change: { query: "DELETE FROM widgets WHERE id = 2" } },
    { name: "schema", change: { schema: "reporting" } },
    { name: "connection", change: { connectionId: "another-connection" } },
  ])("hides the stale plan and resets Analyze after a $name change without auto-running", async ({ change }) => {
    const { rerender } = render(<SqlCellExplain {...defaults} />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
    rerender(<SqlCellExplain {...defaults} {...change} />);
    expect(screen.queryByTestId("plan")).not.toBeInTheDocument();
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
    expect(screen.getByRole("alert")).toHaveTextContent("editor.notebook.queryPlanOutdated");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByTitle("editor.notebook.explainPopout")).toBeDisabled();
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await rerun();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
      connectionId: defaults.connectionId, query: defaults.query, schema: "analytics", ...change, analyze: false,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides a previously resolved plan and disables execution when query resolution fails", async () => {
    const { rerender } = render(<SqlCellExplain {...defaults} />);
    await settle();
    rerender(<SqlCellExplain {...defaults} queryError="Missing {{cell_1}}" />);
    await settle();
    expect(screen.queryByTestId("plan")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Missing {{cell_1}}");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByTitle("editor.visualExplain.rerun")).toBeDisabled();
    expect(screen.getByTitle("editor.notebook.explainPopout")).toBeDisabled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it.each(["SELECT * FROM widgets", "UPDATE widgets SET name = 'new'"])(
    "only executes opted-in Analyze on an explicit rerun, with a warning for %s",
    async (query) => {
      render(<SqlCellExplain {...defaults} query={query} />);
      await settle();
      const checkbox = screen.getByRole("checkbox", { name: "editor.visualExplain.analyze" });
      fireEvent.click(checkbox);
      await settle();
      expect(checkbox).toBeChecked();
      expect(screen.getByRole("status")).toHaveTextContent("editor.visualExplain.analyzeWarning");
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      fireEvent.click(checkbox);
      await settle();
      expect(checkbox).not.toBeChecked();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      fireEvent.click(checkbox);
      await rerun();
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke).toHaveBeenLastCalledWith("explain_query_plan", {
        connectionId: defaults.connectionId, query, schema: "analytics", analyze: true,
      });
    },
  );

  it("opens an analyzed DML plan without invoking and shares mode and selection both ways", async () => {
    render(<SqlCellExplain {...defaults} query="DELETE FROM widgets WHERE id = 1" />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox"));
    await rerun();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(screen.getByTitle("editor.notebook.explainPopout"));
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    const [inline, popout] = screen.getAllByTestId("explain-view");
    expect(within(popout).getByTestId("mode")).toHaveTextContent("table");
    fireEvent.click(within(popout).getByRole("button", { name: "Raw view" }));
    fireEvent.click(within(popout).getByRole("button", { name: "Select child" }));
    expect(within(inline).getByTestId("mode")).toHaveTextContent("raw");
    expect(within(inline).getByTestId("selection")).toHaveTextContent("child");
    fireEvent.click(within(inline).getByRole("button", { name: "Clear selection" }));
    expect(within(popout).getByTestId("selection")).toHaveTextContent("none");
    // The popout adds neither an Analyze checkbox nor an execution button.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getAllByTitle("editor.visualExplain.rerun")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "editor.visualExplain.close" }));
    expect(screen.getAllByTestId("explain-view")).toHaveLength(1);
    fireEvent.click(screen.getByTitle("editor.notebook.explainPopout"));
    await settle();
    expect(screen.getAllByTestId("mode").every((node) => node.textContent === "raw")).toBe(true);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("retries a failed request only on explicit rerun", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Explain permission denied"));
    const { rerender } = render(<SqlCellExplain {...defaults} />);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Explain permission denied");
    expect(screen.getByTitle("editor.notebook.explainPopout")).toBeDisabled();
    rerender(<SqlCellExplain {...defaults} />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await rerun();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan")).toHaveTextContent("initial");
  });

  it("does not display an old pending completion for the current query", async () => {
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<SqlCellExplain {...defaults} />);
    await settle();
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    const query = "SELECT * FROM newer_widgets";
    rerender(<SqlCellExplain {...defaults} query={query} />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
    await act(async () => { pending.resolve(output("old query")); });
    expect(screen.queryByTestId("plan")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("editor.notebook.queryPlanOutdated");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a newer explicit request with an older pending completion", async () => {
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(output("new query"));
    const { rerender } = render(<SqlCellExplain {...defaults} />);
    await settle();
    rerender(<SqlCellExplain {...defaults} query="SELECT * FROM newer_widgets" />);
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await rerun();
    expect(screen.getByTestId("plan")).toHaveTextContent("new query");
    await act(async () => { pending.resolve(output("old query")); });
    expect(screen.getByTestId("plan")).toHaveTextContent("new query");
    expect(screen.getByTestId("selection")).toHaveTextContent("new query");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("stays hidden when switched to an unsupported connection during a pending request", async () => {
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<SqlCellExplain {...defaults} />);
    await settle();
    rerender(<SqlCellExplain {...defaults} connectionId="unsupported" />);
    await act(async () => { pending.resolve(output("old connection")); });
    expect(screen.queryByTestId("explain-view")).not.toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    rerender(<SqlCellExplain {...defaults} connectionId="another-connection" />);
    await settle();
    expect(screen.queryByTestId("plan")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("editor.notebook.queryPlanOutdated");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("resizes the inline view within its bounds without requesting another plan", async () => {
    const { container } = render(<SqlCellExplain {...defaults} />);
    await settle();
    const panel = screen.getByTestId("explain-view").parentElement;
    expect(panel).toHaveStyle({ height: "720px" });
    // ResizeHandle has no accessible role; locate its drag surface, not its source text.
    const handle = container.querySelector(".cursor-row-resize");
    expect(handle).not.toBeNull();
    if (!handle) throw new Error("Missing resize handle");
    fireEvent.mouseDown(handle, { clientY: 100 });
    try {
      fireEvent.mouseMove(document, { clientY: 5000 });
      expect(panel).toHaveStyle({ height: "1200px" });
      fireEvent.mouseMove(document, { clientY: -5000 });
      expect(panel).toHaveStyle({ height: "200px" });
    } finally {
      fireEvent.mouseUp(document);
    }
    expect(document.body.style.cursor).toBe("");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});