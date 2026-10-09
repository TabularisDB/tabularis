import { useCallback, useLayoutEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Editor } from "../../src/pages/Editor";
import { EditorContext, type EditorContextType } from "../../src/contexts/EditorContext";
import { createAutoRefreshSchedule, type AutoRefreshSchedule } from "../../src/utils/autoRefresh";
import type { Tab, QueryResult } from "../../src/types/editor";
import type { DataGridCommandTarget } from "../../src/components/ui/DataGrid";

const mocks = vi.hoisted(() => ({
  connectionId: "connection-1",
  guard: vi.fn().mockResolvedValue(true),
  noop: vi.fn(),
  location: { state: null, pathname: "/editor", key: "test" },
  settings: { resultPageSize: 100, csvIncludeHeaders: true },
  capabilities: { schemas: true, sql_dialect: "postgresql", identifier_quote: '"' },
  t: (key: string, options?: Record<string, unknown>) => key === "toolbar.autoRefresh.failed" ? String(options?.error) : key,
  notify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/utils/queryNotification", () => ({ notifyQueryFinished: mocks.notify }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("lucide-react", async (importOriginal) => await importOriginal());
vi.mock("react-router-dom", () => ({ useLocation: () => mocks.location, useNavigate: () => mocks.noop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn() }));
vi.mock("../../src/hooks/useDatabase", () => ({ useDatabase: () => ({
  activeConnectionId: mocks.connectionId, activeDriver: "postgres", activeSchema: "public",
  activeCapabilities: mocks.capabilities, activeDatabaseName: "test", activeConnectionName: "Test",
  connections: [], tables: [], views: [], materializedViews: [], selectedDatabases: [],
}) }));
vi.mock("../../src/hooks/useDrivers", () => ({ useDrivers: () => ({ allDrivers: [] }) }));
vi.mock("../../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: mocks.settings }) }));
vi.mock("../../src/hooks/useConnectionLayoutContext", () => ({ useConnectionLayoutContext: () => ({ explorerConnectionId: null }) }));
vi.mock("../../src/hooks/useSavedQueries", () => ({ useSavedQueries: () => ({ saveQuery: mocks.noop }) }));
vi.mock("../../src/hooks/useQueryHistory", () => ({ useQueryHistory: () => ({ addEntry: mocks.noop }) }));
vi.mock("../../src/hooks/useKeybindings", () => ({ useKeybindings: () => ({ matchesShortcut: mocks.noop, isMac: false }) }));
vi.mock("../../src/hooks/useAlert", () => ({ useAlert: () => ({ showAlert: mocks.noop }) }));
vi.mock("../../src/hooks/useToast", () => ({ useToast: () => ({ showToast: mocks.noop }) }));
vi.mock("../../src/hooks/useProductionGuard", () => ({ useProductionGuard: () => mocks.guard }));
vi.mock("../../src/hooks/useQueryGuards", () => ({ useQueryGuards: () => ({ guardQuery: mocks.guard, pending: null, resolve: mocks.noop }) }));
vi.mock("../../src/hooks/useSqlAutocompleteRegistration", () => ({ useSqlAutocompleteRegistration: () => {} }));
vi.mock("../../src/components/modals/AiQueryModal", () => ({ AiQueryModal: () => null }));
vi.mock("../../src/components/modals/AiExplainModal", () => ({ AiExplainModal: () => null }));
vi.mock("../../src/components/modals/VisualExplainModal", () => ({ VisualExplainModal: () => null }));
vi.mock("../../src/components/modals/NewRowModal", () => ({ NewRowModal: () => null }));
vi.mock("../../src/components/modals/QuerySelectionModal", () => ({ QuerySelectionModal: () => null }));
vi.mock("../../src/components/modals/ConfirmModal", () => ({ ConfirmModal: () => null }));
vi.mock("../../src/components/modals/ExplainSelectionModal", () => ({ ExplainSelectionModal: () => null }));
vi.mock("../../src/components/modals/TabSwitcherModal", () => ({ TabSwitcherModal: () => null }));
vi.mock("../../src/components/modals/QueryModal", () => ({ QueryModal: () => null }));
vi.mock("../../src/components/modals/QueryParamsModal", () => ({ QueryParamsModal: () => null }));
vi.mock("../../src/components/modals/ErrorModal", () => ({ ErrorModal: () => null }));
vi.mock("../../src/components/modals/ExportProgressModal", () => ({ ExportProgressModal: () => null }));
vi.mock("../../src/components/ui/AiDropdownButton", () => ({ AiDropdownButton: () => null }));
vi.mock("../../src/components/ui/MultiResultPanel", () => ({ MultiResultPanel: () => null }));
vi.mock("../../src/components/ui/VisualQueryBuilder", () => ({ VisualQueryBuilder: () => null }));
vi.mock("../../src/components/ui/ContextMenu", () => ({ ContextMenu: () => null }));
vi.mock("../../src/components/ui/SqlEditorWrapper", () => ({ SqlEditorWrapper: () => null }));
vi.mock("../../src/components/ui/RelatedRecordsPanel", () => ({ RelatedRecordsPanel: () => null }));
vi.mock("../../src/components/notebook/NotebookView", () => ({ NotebookView: () => null }));
vi.mock("../../src/components/users/UserManagementView", () => ({ UserManagementView: () => null }));
vi.mock("../../src/components/layout/CommandPaletteScopeBridge", () => ({ CommandPaletteScopeBridge: () => null }));
vi.mock("../../src/components/ui/DataGrid", () => ({
  DataGrid: function Grid({ ref, data, onEditingChange }: {
    ref: Ref<DataGridCommandTarget>; data: unknown[][]; onEditingChange?: (editing: boolean) => void;
  }) {
    const [editing, setEditing] = useState(false);
    useImperativeHandle(ref, () => ({ isEditing: () => editing, getResultCommands: () => ({}) }), [editing]);
    useLayoutEffect(() => { onEditingChange?.(editing); }, [onEditingChange, editing]);
    useLayoutEffect(() => () => onEditingChange?.(false), [onEditingChange]);
    return <div data-testid="grid" style={{ overflow: "auto" }}>
      <span>{JSON.stringify(data)}</span>
      <button onClick={() => setEditing(!editing)}>Toggle editing</button>
    </div>;
  },
}));

const initialResult: QueryResult = { columns: ["id"], rows: [[1]], affected_rows: 0,
  pagination: { page: 2, page_size: 50, total_rows: null, has_more: true } };
const initialTab = (id = "table-1", connectionId = "connection-1"): Tab => ({
  id, connectionId, title: id, type: "table", query: 'SELECT * FROM "jobs"', activeTable: "jobs",
  schema: "private", page: 2, pageSize: 50, filterClause: "id > 0", sortClause: "id DESC",
  limitClause: 200, queryParams: { unused: "value" }, pkColumns: ["id"], result: initialResult,
  error: "", executionTime: 1, isEditorOpen: false, autoRefreshIntervalMs: 5000,
});
let context: EditorContextType;
function Harness({ initialTabs = [initialTab()] }: { initialTabs?: Tab[] }) {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0].id);
  const schedules = useRef(new Map<string, AutoRefreshSchedule>());
  const getAutoRefreshSchedule = useCallback((id: string) => {
    let schedule = schedules.current.get(id);
    if (!schedule) { schedule = createAutoRefreshSchedule(); schedules.current.set(id, schedule); }
    return schedule;
  }, []);
  const updateTab = useCallback<EditorContextType["updateTab"]>((id, partial) => {
    setTabs((tabs) => tabs.map((tab) => tab.id === id
      ? { ...tab, ...(typeof partial === "function" ? partial(tab) : partial) } : tab));
  }, []);
  const value = { tabs, activeTabId, activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
    getAutoRefreshSchedule, updateTab, setActiveTabId,
    addTab: mocks.noop, openNotebook: mocks.noop, closeTab: (id: string) => setTabs((tabs) => tabs.filter((tab) => tab.id !== id)),
    closeAllTabs: mocks.noop, closeOtherTabs: mocks.noop, closeTabsToLeft: mocks.noop, closeTabsToRight: mocks.noop,
    reorderTab: mocks.noop, updateResultEntry: mocks.noop, getSchema: mocks.noop,
    reopenClosedTab: mocks.noop, canReopenClosedTab: false,
  } as EditorContextType;
  useLayoutEffect(() => { context = value; });
  return <EditorContext.Provider value={value}><Editor /></EditorContext.Provider>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const queries = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "execute_query");

describe("table auto-refresh integration", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0); mocks.connectionId = "connection-1"; mocks.notify.mockClear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command) => command === "execute_query"
      ? Promise.resolve({ ...initialResult, rows: [[2], [3]] }) : Promise.resolve([]));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps the mounted grid, both scroll offsets and query settings while refreshing", async () => {
    const request = deferred<QueryResult>();
    vi.mocked(invoke).mockImplementation((command) => command === "execute_query" ? request.promise : Promise.resolve([]));
    render(<Harness />);
    const grid = screen.getByTestId("grid"); grid.scrollTop = 120; grid.scrollLeft = 80;
    await advance(5000);
    expect(queries()).toHaveLength(1);
    expect(queries()[0][1]).toMatchObject({ connectionId: "connection-1", sessionId: "table-1", schema: "private", page: 2, limit: 50 });
    expect(String(queries()[0][1]?.query)).toContain("id > 0");
    expect(String(queries()[0][1]?.query)).toContain("DESC");
    expect(screen.getByTestId("grid")).toBe(grid);
    expect(grid).toHaveTextContent("[[1]]");
    await act(async () => { request.resolve({ ...initialResult, rows: [[2], [3]] }); });
    expect(screen.getByTestId("grid")).toBe(grid);
    expect(grid.scrollTop).toBe(120); expect(grid.scrollLeft).toBe(80);
    expect(context.activeTab).toMatchObject({ page: 2, pageSize: 50, filterClause: "id > 0", sortClause: "id DESC", limitClause: 200, pkColumns: ["id"] });
  });

  it("retains rows on failure, shows an inline error and retries after one interval", async () => {
    vi.mocked(invoke).mockRejectedValue("offline"); render(<Harness />);
    const grid = screen.getByTestId("grid");
    await advance(5000);
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByTestId("grid")).toBe(grid); expect(grid).toHaveTextContent("[[1]]");
    await advance(4999); expect(queries()).toHaveLength(1);
    await advance(1); expect(queries()).toHaveLength(2);
  });

  it("discards an in-flight result after editing begins and resumes when editing ends", async () => {
    const request = deferred<QueryResult>();
    vi.mocked(invoke).mockReturnValue(request.promise); render(<Harness />);
    await advance(5000);
    fireEvent.click(screen.getByRole("button", { name: "Toggle editing" }));
    await act(async () => { request.resolve({ ...initialResult, rows: [[999]] }); });
    expect(screen.getByTestId("grid")).toHaveTextContent("[[1]]");
    expect(screen.getByText("toolbar.autoRefresh.paused")).toHaveAttribute("role", "status");
    await advance(60000); expect(queries()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Toggle editing" }));
    await advance(0); expect(queries()).toHaveLength(2);
  });

  it("pauses automatic refresh while rows are selected and resumes once cleared", async () => {
    render(<Harness />);
    act(() => context.updateTab("table-1", { selectedRows: [0] }));
    expect(screen.getByText("toolbar.autoRefresh.pausedSelection")).toHaveAttribute("role", "status");
    await advance(60000); expect(queries()).toHaveLength(0);
    expect(context.activeTab?.selectedRows).toEqual([0]);
    act(() => context.updateTab("table-1", { selectedRows: [] }));
    expect(screen.queryByText("toolbar.autoRefresh.pausedSelection")).toBeNull();
    await advance(0); expect(queries()).toHaveLength(1);
    expect(context.activeTab?.result?.rows).toEqual([[2], [3]]);
  });

  it("discards an in-flight automatic refresh when rows get selected", async () => {
    const request = deferred<QueryResult>();
    vi.mocked(invoke).mockReturnValue(request.promise);
    render(<Harness />); await advance(5000);
    act(() => context.updateTab("table-1", { selectedRows: [0] }));
    await act(async () => { request.resolve({ ...initialResult, rows: [[999], [1]] }); });
    // The selected index 0 must still point at the row the user picked.
    expect(context.activeTab?.result?.rows).toEqual([[1]]);
    expect(context.activeTab?.selectedRows).toEqual([0]);
  });

  it("manual refresh clears a selection whose indexes may now point at other rows", async () => {
    render(<Harness />);
    act(() => context.updateTab("table-1", { selectedRows: [0] }));
    fireEvent.click(screen.getByRole("button", { name: "toolbar.autoRefresh.refresh" }));
    await advance(0);
    expect(queries()).toHaveLength(1);
    expect(context.activeTab?.result?.rows).toEqual([[2], [3]]);
    expect(context.activeTab?.selectedRows).toEqual([]);
  });

  it("sends long-query notifications for manual refreshes only, not automatic ticks", async () => {
    render(<Harness />);
    await advance(5000); expect(queries()).toHaveLength(1);
    expect(mocks.notify).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValue("offline");
    await advance(5000); expect(queries()).toHaveLength(2);
    expect(mocks.notify).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "toolbar.autoRefresh.refresh" }));
    await advance(0);
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it("keeps each deadline across switches and refreshes overdue tabs once", async () => {
    render(<Harness initialTabs={[initialTab(), initialTab("table-2")]} />);
    await advance(2000); act(() => context.setActiveTabId("table-2"));
    await advance(2000); act(() => context.setActiveTabId("table-1"));
    await advance(1000); expect(queries()).toHaveLength(1);
    await advance(10000); act(() => context.setActiveTabId("table-2"));
    await advance(0);
    expect(queries().filter(([, args]) => args?.sessionId === "table-2")).toHaveLength(1);
  });

  it("waits through pending changes and keeps the overdue deadline", async () => {
    render(<Harness />);
    act(() => context.updateTab("table-1", { pendingDeletions: { '1': 1 } }));
    await advance(60000); expect(queries()).toHaveLength(0);
    act(() => context.updateTab("table-1", { pendingDeletions: undefined }));
    await advance(0); expect(queries()).toHaveLength(1);
  });

  it("discards a refresh even if a deletion is undone before it finishes", async () => {
    const request = deferred<QueryResult>();
    vi.mocked(invoke).mockReturnValue(request.promise);
    render(<Harness />); await advance(5000);
    act(() => context.updateTab("table-1", { pendingDeletions: { '1': 1 } }));
    act(() => context.updateTab("table-1", { pendingDeletions: undefined }));
    await act(async () => { request.resolve({ ...initialResult, rows: [[999]] }); });
    expect(context.activeTab?.result?.rows).toEqual([[1]]);
    await advance(0); expect(queries()).toHaveLength(2);
  });

  it("uses a normal initial query to establish a restored tab's new schedule", async () => {
    render(<Harness initialTabs={[{ ...initialTab(), result: null }]} />);
    await advance(0); expect(queries()).toHaveLength(1);
    await advance(4999); expect(queries()).toHaveLength(1);
    await advance(1); expect(queries()).toHaveLength(2);
  });

  it("manual refresh retains the grid and resets the same deadline", async () => {
    render(<Harness />);
    const grid = screen.getByTestId("grid"); grid.scrollLeft = 80;
    await advance(4000);
    fireEvent.click(screen.getByRole("button", { name: "toolbar.autoRefresh.refresh" }));
    await advance(0);
    expect(queries()).toHaveLength(1);
    expect(screen.getByTestId("grid")).toBe(grid);
    expect(grid.scrollLeft).toBe(80);
    await advance(4999); expect(queries()).toHaveLength(1);
    await advance(1); expect(queries()).toHaveLength(2);
  });

  it("manual refresh recovers from a failed initial query", async () => {
    render(<Harness initialTabs={[{ ...initialTab(), result: null, error: "offline" }]} />);
    expect(context.activeTab?.error).toBe("offline");
    fireEvent.click(screen.getByRole("button", { name: "toolbar.autoRefresh.refresh" }));
    await advance(0);
    expect(queries()).toHaveLength(1);
    expect(context.activeTab?.error).toBe("");
    expect(screen.getByTestId("grid")).toHaveTextContent("[[2],[3]]");
    await advance(5000); expect(queries()).toHaveLength(2);
  });

  it("queues explicit table navigation behind a refresh and discards superseded rows", async () => {
    const first = deferred<QueryResult>();
    const second = deferred<QueryResult>();
    let index = 0;
    vi.mocked(invoke).mockImplementation((command) => command === "execute_query"
      ? (++index === 1 ? first.promise : second.promise) : Promise.resolve([]));
    render(<Harness />); await advance(5000);
    const filter = screen.getByDisplayValue("id > 0");
    fireEvent.change(filter, { target: { value: "id > 100" } });
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(queries()).toHaveLength(1);
    await act(async () => { first.resolve({ ...initialResult, rows: [[999]] }); });
    expect(queries()).toHaveLength(2);
    expect(String(queries()[1][1]?.query)).toContain("id > 100");
    await act(async () => { second.resolve({ ...initialResult, rows: [[101]] }); });
    expect(screen.getByTestId("grid")).toHaveTextContent("[[101]]");
    expect(context.activeTab?.filterClause).toBe("id > 100");
  });

  it("discards a refresh on connection switch and keeps its overdue deadline", async () => {
    const request = deferred<QueryResult>();
    vi.mocked(invoke).mockReturnValue(request.promise);
    const { rerender } = render(<Harness />);
    await advance(5000);
    mocks.connectionId = "connection-2"; rerender(<Harness />);
    await act(async () => { request.resolve({ ...initialResult, rows: [[999]] }); });
    expect(context.activeTab?.result?.rows).toEqual([[1]]);
    expect(context.getAutoRefreshSchedule("table-1").getSnapshot().nextDueAt).toBe(5000);
    mocks.connectionId = "connection-1"; rerender(<Harness />);
    await advance(0); expect(queries()).toHaveLength(2);
  });

  it("does not apply responses after the tab closes", async () => {
    const request = deferred<QueryResult>(); vi.mocked(invoke).mockReturnValue(request.promise);
    render(<Harness />); await advance(5000);
    act(() => context.closeTab("table-1"));
    await act(async () => { request.resolve({ ...initialResult, rows: [[999]] }); });
    expect(context.tabs).toHaveLength(0);
    await advance(60000); expect(queries()).toHaveLength(1);
  });

  it.each([[], [[2]], [[2], [3], [4]]].map((rows) => ({ rows })))("keeps the grid when row count changes to $rows", async ({ rows }) => {
    vi.mocked(invoke).mockResolvedValue({ ...initialResult, rows });
    render(<Harness />); const grid = screen.getByTestId("grid");
    await advance(5000);
    expect(screen.getByTestId("grid")).toBe(grid);
    expect(context.activeTab?.result?.rows).toEqual(rows);
  });
});
