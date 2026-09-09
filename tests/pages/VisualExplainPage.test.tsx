import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { parseExplain, type ExplainQueryOutput } from "@tabularis/explain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisualExplainPage, type VisualExplainPageProps } from "../../src/pages/VisualExplainPage";
import type { VisualExplainViewProps } from "../../src/components/explain/VisualExplainView";

const mocks = vi.hoisted(() => ({ search: "" }));

vi.mock("react-router-dom", () => ({ useLocation: () => ({ search: mocks.search }) }));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { aiEnabled: true } }),
}));
vi.mock("lucide-react", () => ({
  FileJson: () => null, FolderOpen: () => null, Loader2: () => null, RefreshCw: () => null,
}));
vi.mock("../../src/components/explain/VisualExplainView", () => ({
  VisualExplainView: ({ plan, error, selectedNodeId, aiEnabled }: VisualExplainViewProps) => (
    <div data-testid="explain-view" data-ai-enabled={String(aiEnabled)}>
      <div data-testid="plan">{plan?.root.node_type}</div>
      <div data-testid="query">{plan?.original_query}</div>
      <div data-testid="selection">{selectedNodeId}</div>
      {error && <div role="alert">{error}</div>}
    </div>
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeFile(name: string) {
  return { content: JSON.stringify([{ Plan: { "Node Type": name } }]), display_name: `${name}.json` };
}

function deepLink(query = "SELECT 1") {
  return `?connection=connection-1&query=${encodeURIComponent(btoa(query))}`;
}

function renderPage(props: VisualExplainPageProps = {}) {
  return render(<StrictMode><VisualExplainPage {...props} /></StrictMode>);
}

function pickFile() {
  fireEvent.click(screen.getAllByRole("button", { name: "visualExplainPage.openFile" })[0]);
}

describe("VisualExplainPage", () => {
  beforeEach(() => {
    mocks.search = "";
    vi.mocked(invoke).mockReset();
    vi.mocked(openDialog).mockReset();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it.each([false, true])("uses the embedded plan without invoking, compact=%s", async (compactMode) => {
    mocks.search = `${deepLink()}&file=%2Ftmp%2Fignored.json`;
    const initialPlan = parseExplain(makeFile("embedded").content);
    renderPage({ initialPlan, compactMode });
    await act(async () => { await Promise.resolve(); });
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("plan")).toHaveTextContent("embedded");
    expect(screen.getByTestId("selection")).toHaveTextContent(initialPlan.root.id);
    expect(screen.getByTestId("explain-view")).toHaveAttribute("data-ai-enabled", "true");
    expect(screen.queryByText("visualExplainPage.title") !== null).toBe(!compactMode);
  });

  it("defers an explicit file load and invokes only once in StrictMode", async () => {
    mocks.search = "?file=%2Ftmp%2Fexplicit.json";
    const deferred = createDeferred<ReturnType<typeof makeFile>>();
    vi.mocked(invoke).mockReturnValue(deferred.promise);
    renderPage();
    expect(invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(invoke).toHaveBeenCalledExactlyOnceWith("load_explain_from_file", { path: "/tmp/explicit.json" }));
    expect(screen.getByText("visualExplainPage.loading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "visualExplainPage.reload" })).toBeDisabled();
    await act(async () => { deferred.resolve(makeFile("explicit")); });
    expect(screen.getByTestId("plan")).toHaveTextContent("explicit");
    expect(screen.getByTestId("query")).toHaveTextContent("-- loaded from explicit.json");
    expect(screen.getByTestId("selection")).not.toBeEmptyDOMElement();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("prefers a deep link over a file and preserves safe invoke options", async () => {
    mocks.search = `${deepLink("SELECT * FROM users")}&file=%2Ftmp%2Fignored.json&analyze=true&schema=private`;
    const plan = parseExplain(makeFile("deep link").content);
    vi.mocked(invoke).mockResolvedValue({ kind: "plan", plan });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("deep link"));
    expect(invoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", {
      connectionId: "connection-1", query: "SELECT * FROM users", analyze: false, schema: null,
    });
  });

  it("loads a pending CLI handoff once in StrictMode", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("/tmp/cli.json").mockResolvedValueOnce(makeFile("cli"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("cli"));
    expect(invoke).toHaveBeenNthCalledWith(1, "get_pending_explain_file");
    expect(invoke).toHaveBeenNthCalledWith(2, "load_explain_from_file", { path: "/tmp/cli.json" });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(screen.getByTitle("/tmp/cli.json")).toHaveTextContent("cli.json");
  });

  it("keeps the empty hint when no CLI handoff exists", async () => {
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledExactlyOnceWith("get_pending_explain_file"));
    expect(screen.getByText("visualExplainPage.emptyHint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "visualExplainPage.reload" })).toBeDisabled();
  });

  it("does not treat compact mode alone as an embedded plan", async () => {
    mocks.search = "?file=%2Ftmp%2Fcompact.json";
    vi.mocked(invoke).mockResolvedValue(makeFile("compact"));
    renderPage({ compactMode: true });
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("compact"));
    expect(invoke).toHaveBeenCalledExactlyOnceWith("load_explain_from_file", { path: "/tmp/compact.json" });
    expect(screen.queryByText("visualExplainPage.openFile")).not.toBeInTheDocument();
  });

  it("opens a selected file with the existing picker options and can reload it", async () => {
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    vi.mocked(openDialog).mockResolvedValue("/tmp/picked.json");
    vi.mocked(invoke).mockResolvedValue(makeFile("picked"));
    pickFile();
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("picked"));
    expect(openDialog).toHaveBeenCalledExactlyOnceWith({
      multiple: false,
      filters: [{ name: "Explain", extensions: ["json", "txt"] }, { name: "All files", extensions: ["*"] }],
    });
    expect(invoke).toHaveBeenLastCalledWith("load_explain_from_file", { path: "/tmp/picked.json" });
    vi.mocked(invoke).mockResolvedValue(makeFile("reloaded"));
    fireEvent.click(screen.getByRole("button", { name: "visualExplainPage.reload" }));
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("reloaded"));
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(screen.getByTitle("/tmp/picked.json")).toHaveTextContent("picked.json");
  });

  it.each([
    { selection: null },
    { selection: "   " },
    { selection: ["/tmp/ignored.json"] },
  ])("ignores a cancelled or invalid picker selection: $selection", async ({ selection }) => {
    const initialPlan = parseExplain(makeFile("existing").content);
    renderPage({ initialPlan });
    vi.mocked(openDialog).mockResolvedValue(selection);
    await act(async () => { pickFile(); });
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("plan")).toHaveTextContent("existing");
  });

  it("preserves a pending CLI handoff when the picker is cancelled", async () => {
    const pending = createDeferred<string | null>();
    vi.mocked(invoke).mockReturnValueOnce(pending.promise).mockResolvedValue(makeFile("cli"));
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    vi.mocked(openDialog).mockResolvedValue(null);
    await act(async () => { pickFile(); });
    await act(async () => { pending.resolve("/tmp/cli.json"); });
    expect(screen.getByTestId("plan")).toHaveTextContent("cli");
    expect(invoke).toHaveBeenLastCalledWith("load_explain_from_file", { path: "/tmp/cli.json" });
  });

  it.each(["deep link", "file", "CLI"])("shows a %s failure instead of an empty placeholder", async (source) => {
    mocks.search = source === "deep link" ? deepLink() : source === "file" ? "?file=%2Ftmp%2Fbroken.json" : "";
    vi.mocked(invoke).mockRejectedValue(new Error("load failed"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Error: load failed");
    expect(screen.queryByText("visualExplainPage.emptyHint")).not.toBeInTheDocument();
    expect(screen.queryByText("visualExplainPage.loading")).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("shows a translated validation error for an unsupported deep-link statement", async () => {
    mocks.search = deepLink("VACUUM");
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("editor.visualExplain.notExplainable");
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByText("visualExplainPage.emptyHint")).not.toBeInTheDocument();
  });

  it("shows file parsing failures", async () => {
    mocks.search = "?file=%2Ftmp%2Finvalid.json";
    vi.mocked(invoke).mockResolvedValue({ content: "not an explain plan", display_name: "invalid.json" });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported EXPLAIN file format");
    expect(screen.getByTestId("selection")).toBeEmptyDOMElement();
  });

  it("shows an asynchronous file picker rejection and recovers with a new file", async () => {
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    vi.mocked(openDialog).mockRejectedValueOnce(new Error("picker failed"));
    pickFile();
    expect(await screen.findByRole("alert")).toHaveTextContent("Error: picker failed");
    expect(screen.queryByText("visualExplainPage.emptyHint")).not.toBeInTheDocument();
    vi.mocked(openDialog).mockResolvedValueOnce("/tmp/recovered.json");
    vi.mocked(invoke).mockResolvedValue(makeFile("recovered"));
    pickFile();
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("recovered"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["resolve", "reject"] as const)("ignores a stale CLI lookup %s after a file is selected", async (outcome) => {
    const pending = createDeferred<string | null>();
    vi.mocked(invoke).mockReturnValueOnce(pending.promise).mockResolvedValue(makeFile("chosen"));
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    vi.mocked(openDialog).mockResolvedValue("/tmp/chosen.json");
    pickFile();
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("chosen"));
    await act(async () => {
      if (outcome === "resolve") pending.resolve("/tmp/obsolete.json");
      else pending.reject(new Error("obsolete CLI failure"));
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(screen.getByTitle("/tmp/chosen.json")).toBeInTheDocument();
    expect(screen.getByTestId("plan")).toHaveTextContent("chosen");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["resolve", "reject"] as const)("keeps a picked file when an older deep-link request later %s", async (outcome) => {
    mocks.search = deepLink();
    const old = createDeferred<ExplainQueryOutput>();
    vi.mocked(invoke).mockReturnValueOnce(old.promise).mockResolvedValue(makeFile("chosen"));
    renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    vi.mocked(openDialog).mockResolvedValue("/tmp/chosen.json");
    pickFile();
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("chosen"));
    await act(async () => {
      if (outcome === "resolve") old.resolve({ kind: "plan", plan: parseExplain(makeFile("obsolete").content) });
      else old.reject(new Error("obsolete explain failure"));
    });
    expect(screen.getByTestId("plan")).toHaveTextContent("chosen");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("ignores an older file when routing to a new deep link", async () => {
    mocks.search = "?file=%2Ftmp%2Fold.json";
    const old = createDeferred<ReturnType<typeof makeFile>>();
    vi.mocked(invoke).mockReturnValueOnce(old.promise);
    const { rerender } = renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    mocks.search = deepLink("SELECT 2");
    vi.mocked(invoke).mockResolvedValue({ kind: "plan", plan: parseExplain(makeFile("new deep link").content) });
    rerender(<StrictMode><VisualExplainPage /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("new deep link"));
    await act(async () => { old.resolve(makeFile("obsolete")); });
    expect(screen.getByTestId("plan")).toHaveTextContent("new deep link");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)("discards a stale picker %s after a newer file selection", async (outcome) => {
    const old = createDeferred<string | null>();
    const initialPlan = parseExplain(makeFile("initial").content);
    renderPage({ initialPlan });
    vi.mocked(openDialog).mockReturnValueOnce(old.promise).mockResolvedValueOnce("/tmp/latest.json");
    vi.mocked(invoke).mockResolvedValue(makeFile("latest"));
    pickFile();
    pickFile();
    await waitFor(() => expect(screen.getByTestId("plan")).toHaveTextContent("latest"));
    await act(async () => {
      if (outcome === "resolve") old.resolve("/tmp/obsolete.json");
      else old.reject(new Error("obsolete picker failure"));
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("load_explain_from_file", { path: "/tmp/latest.json" });
    expect(screen.getByTestId("plan")).toHaveTextContent("latest");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cancels bootstrap before invoking when unmounted in the same turn", async () => {
    mocks.search = deepLink();
    const { unmount } = renderPage();
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["CLI", "picker"])("does not load a file from a pending %s after unmount", async (source) => {
    const pending = createDeferred<string | null>();
    if (source === "CLI") vi.mocked(invoke).mockReturnValue(pending.promise);
    else vi.mocked(openDialog).mockReturnValue(pending.promise);
    const { unmount } = renderPage();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    if (source === "picker") pickFile();
    unmount();
    await act(async () => { pending.resolve("/tmp/too-late.json"); });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});