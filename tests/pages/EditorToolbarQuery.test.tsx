import { useCallback, useLayoutEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Editor } from "../../src/pages/Editor";
import { EditorContext, type EditorContextType } from "../../src/contexts/EditorContext";
import { createAutoRefreshSchedule, type AutoRefreshSchedule } from "../../src/utils/autoRefresh";
import type { Tab, QueryResult } from "../../src/types/editor";
import type {
  DataGrid as DataGridType,
  DataGridCommandTarget,
} from "../../src/components/ui/DataGrid";
import type { ComponentProps } from "react";

// Captures the `onRunQuery` prop the Editor passes to TableToolbar so the test
// can drive it directly, exercising the real `runToolbarQuery` callback
// without rendering the filter-value picker UI.
let capturedRunToolbarQuery: ((sql: string) => Promise<QueryResult>) | undefined;
let capturedRefresh: (() => void) | undefined;
// Same for the DataGrid's column statistics loader (issue #1001).
type LoadColumnStats = NonNullable<ComponentProps<typeof DataGridType>["onLoadColumnStats"]>;
let capturedLoadColumnStats: LoadColumnStats | undefined;
// And the grid's filter-by-value handler (a top value in the popover, #1138).
type FilterByValue = NonNullable<ComponentProps<typeof DataGridType>["onFilterByValue"]>;
let capturedFilterByValue: FilterByValue | undefined;

const mocks = vi.hoisted(() => ({
  connectionId: "connection-1",
  guard: vi.fn().mockResolvedValue(true),
  noop: vi.fn(),
  location: { state: null, pathname: "/editor", key: "test" },
  settings: { resultPageSize: 100, csvIncludeHeaders: true },
  capabilities: { schemas: true, sql_dialect: "postgresql", identifier_quote: '"' },
  t: (key: string, options?: Record<string, unknown>) =>
    key === "toolbar.autoRefresh.failed" ? String(options?.error) : key,
  notify: vi.fn().mockResolvedValue(undefined),
  sqlOnChange: new Map<string, (value: string) => void>(),
}));
vi.mock("../../src/utils/queryNotification", () => ({ notifyQueryFinished: mocks.notify }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("lucide-react", async (importOriginal) => await importOriginal());
vi.mock("react-router-dom", () => ({
  useLocation: () => mocks.location,
  useNavigate: () => mocks.noop,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));
vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    activeConnectionId: mocks.connectionId,
    activeDriver: "postgres",
    activeSchema: "public",
    activeCapabilities: mocks.capabilities,
    activeDatabaseName: "test",
    activeConnectionName: "Test",
    connections: [],
    tables: [],
    views: [],
    materializedViews: [],
    selectedDatabases: [],
  }),
}));
vi.mock("../../src/hooks/useDrivers", () => ({ useDrivers: () => ({ allDrivers: [] }) }));
vi.mock("../../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: mocks.settings }) }));
vi.mock("../../src/hooks/useConnectionLayoutContext", () => ({
  useConnectionLayoutContext: () => ({ explorerConnectionId: null }),
}));
vi.mock("../../src/hooks/useSavedQueries", () => ({ useSavedQueries: () => ({ saveQuery: mocks.noop }) }));
vi.mock("../../src/hooks/useQueryHistory", () => ({ useQueryHistory: () => ({ addEntry: mocks.noop }) }));
vi.mock("../../src/hooks/useKeybindings", () => ({
  useKeybindings: () => ({ matchesShortcut: mocks.noop, isMac: false }),
}));
vi.mock("../../src/hooks/useAlert", () => ({ useAlert: () => ({ showAlert: mocks.noop }) }));
vi.mock("../../src/hooks/useToast", () => ({ useToast: () => ({ showToast: mocks.noop }) }));
vi.mock("../../src/hooks/useProductionGuard", () => ({ useProductionGuard: () => mocks.guard }));
vi.mock("../../src/hooks/useQueryGuards", () => ({
  useQueryGuards: () => ({ guardQuery: mocks.guard, pending: null, resolve: mocks.noop }),
}));
vi.mock("../../src/hooks/useSqlAutocompleteRegistration", () => ({
  useSqlAutocompleteRegistration: () => {},
}));
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
vi.mock("../../src/components/ui/SqlEditorWrapper", () => ({
  SqlEditorWrapper: ({
    editorKey,
    onChange,
  }: {
    editorKey: string;
    onChange: (value: string) => void;
  }) => {
    mocks.sqlOnChange.set(editorKey, onChange);
    return null;
  },
}));
// Mock TableToolbar to capture `onRunQuery` (the real `runToolbarQuery`).
// The filter-value picker UI is too deep to drive in a unit test; capturing
// the prop lets us call the callback directly and verify the invoke payload.
vi.mock("../../src/components/ui/TableToolbar", () => ({
  TableToolbar: ({
    onRunQuery,
    onRefresh,
  }: {
    onRunQuery?: (sql: string) => Promise<QueryResult>;
    onRefresh?: () => void;
  }) => {
    useLayoutEffect(() => {
      capturedRunToolbarQuery = onRunQuery;
      capturedRefresh = onRefresh;
    });
    return null;
  },
}));
vi.mock("../../src/components/ui/RelatedRecordsPanel", () => ({ RelatedRecordsPanel: () => null }));
vi.mock("../../src/components/notebook/NotebookView", () => ({ NotebookView: () => null }));
vi.mock("../../src/components/users/UserManagementView", () => ({ UserManagementView: () => null }));
vi.mock("../../src/components/layout/CommandPaletteScopeBridge", () => ({
  CommandPaletteScopeBridge: () => null,
}));
vi.mock("../../src/components/ui/DataGrid", () => ({
  DataGrid: function Grid({
    ref,
    data,
    onEditingChange,
    onLoadColumnStats,
    onFilterByValue,
  }: {
    ref: Ref<DataGridCommandTarget>;
    data: unknown[][];
    onEditingChange?: (editing: boolean) => void;
    onLoadColumnStats?: LoadColumnStats;
    onFilterByValue?: FilterByValue;
  }) {
    const [editing, setEditing] = useState(false);
    const gridRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      capturedLoadColumnStats = onLoadColumnStats;
      capturedFilterByValue = onFilterByValue;
    });
    useImperativeHandle(
      ref,
      () => ({
        isEditing: () => editing,
        getResultCommands: () => ({}),
        focus: () => gridRef.current?.focus(),
      }),
      [editing],
    );
    useLayoutEffect(() => {
      onEditingChange?.(editing);
    }, [onEditingChange, editing]);
    useLayoutEffect(() => () => onEditingChange?.(false), [onEditingChange]);
    return (
      <div ref={gridRef} tabIndex={-1} data-testid="grid" style={{ overflow: "auto" }}>
        <span>{JSON.stringify(data)}</span>
        <button onClick={() => setEditing(!editing)}>Toggle editing</button>
      </div>
    );
  },
}));

const initialResult: QueryResult = {
  columns: ["id"],
  rows: [[1]],
  affected_rows: 0,
  pagination: { page: 2, page_size: 50, total_rows: null, has_more: true },
};
const initialTab = (id = "table-1", connectionId = "connection-1", database?: string): Tab => ({
  id,
  connectionId,
  title: id,
  type: "table",
  query: 'SELECT * FROM "jobs"',
  activeTable: "jobs",
  schema: "private",
  page: 2,
  pageSize: 50,
  filterClause: "id > 0",
  sortClause: "id DESC",
  limitClause: 200,
  queryParams: { unused: "value" },
  pkColumns: ["id"],
  result: initialResult,
  error: "",
  executionTime: 1,
  isEditorOpen: false,
  autoRefreshIntervalMs: 0,
  database,
});
function Harness({ initialTabs = [initialTab()] }: { initialTabs?: Tab[] }) {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0].id);
  const schedules = useRef(new Map<string, AutoRefreshSchedule>());
  const getAutoRefreshSchedule = useCallback((id: string) => {
    let schedule = schedules.current.get(id);
    if (!schedule) {
      schedule = createAutoRefreshSchedule();
      schedules.current.set(id, schedule);
    }
    return schedule;
  }, []);
  const updateTab = useCallback<EditorContextType["updateTab"]>((id, partial) => {
    setTabs((tabs) =>
      tabs.map((tab) =>
        tab.id === id ? { ...tab, ...(typeof partial === "function" ? partial(tab) : partial) } : tab,
      ),
    );
  }, []);
  const value = {
    tabs,
    activeTabId,
    activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
    getAutoRefreshSchedule,
    updateTab,
    setActiveTabId,
    addTab: mocks.noop,
    openNotebook: mocks.noop,
    closeTab: (id: string) => setTabs((tabs) => tabs.filter((tab) => tab.id !== id)),
    closeAllTabs: mocks.noop,
    closeOtherTabs: mocks.noop,
    closeTabsToLeft: mocks.noop,
    closeTabsToRight: mocks.noop,
    reorderTab: mocks.noop,
    updateResultEntry: mocks.noop,
    getSchema: mocks.noop,
    reopenClosedTab: mocks.noop,
    canReopenClosedTab: false,
  } as EditorContextType;
  return (
    <EditorContext.Provider value={value}>
      <Editor />
    </EditorContext.Provider>
  );
}

function executeQueryCalls() {
  return vi.mocked(invoke).mock.calls.filter(([command]) => command === "execute_query");
}

describe("runToolbarQuery database field", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.connectionId = "connection-1";
    capturedRunToolbarQuery = undefined;
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "execute_query"
        ? Promise.resolve({
            ...initialResult,
            rows: [["a"]],
          })
        : Promise.resolve([]),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes the tab's database to execute_query when one is set", async () => {
    render(<Harness initialTabs={[initialTab("table-1", "connection-1", "mydb")]} />);
    expect(capturedRunToolbarQuery).toBeDefined();

    await act(async () => {
      await capturedRunToolbarQuery?.('SELECT DISTINCT "id" FROM "jobs"');
    });

    const calls = executeQueryCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      connectionId: "connection-1",
      database: "mydb",
      sessionId: "table-1",
      schema: "private",
    });
  });

  it("omits the database field when the tab has no database", async () => {
    render(<Harness initialTabs={[initialTab("table-1", "connection-1", undefined)]} />);
    expect(capturedRunToolbarQuery).toBeDefined();

    await act(async () => {
      await capturedRunToolbarQuery?.('SELECT DISTINCT "id" FROM "jobs"');
    });

    const calls = executeQueryCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      connectionId: "connection-1",
      sessionId: "table-1",
      schema: "private",
    });
    // The database key must not be present at all (the spread only adds it
    // when currentTab.database is truthy).
    expect(calls[0][1]).not.toHaveProperty("database");
  });
});

describe("column statistics loader (#1001)", () => {
  const ALL = { distinct: true, minMax: true, topValues: true };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.connectionId = "connection-1";
    capturedLoadColumnStats = undefined;
    vi.mocked(invoke).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the rows matching the tab's filter on the tab's session, then lists top values", async () => {
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command !== "execute_query") return Promise.resolve([]);
      const query = (args as { query: string }).query;
      return Promise.resolve({
        ...initialResult,
        rows: query.startsWith("SELECT COUNT(*)") ? [[4, 1, 3, 1, 9]] : [[7, 2], [9, 1]],
      });
    });
    render(<Harness />);
    expect(capturedLoadColumnStats).toBeDefined();

    let stats: Awaited<ReturnType<LoadColumnStats>> | undefined;
    await act(async () => {
      stats = await capturedLoadColumnStats?.("id", ALL, new AbortController().signal);
    });

    const calls = executeQueryCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatchObject({
      connectionId: "connection-1",
      sessionId: "table-1",
      query:
        'SELECT COUNT(*), COUNT(*) - COUNT("id"), COUNT(DISTINCT "id"), MIN("id"), MAX("id") ' +
        'FROM "private"."jobs" WHERE (id > 0)',
    });
    expect((calls[1][1] as { query: string }).query).toBe(
      'SELECT "id", COUNT(*) FROM "private"."jobs" WHERE "id" IS NOT NULL AND (id > 0) ' +
        'GROUP BY "id" ORDER BY 2 DESC, 1 LIMIT 10',
    );
    expect(stats).toMatchObject({
      rowCount: 4,
      nullCount: 1,
      distinctCount: 3,
      min: 1,
      max: 9,
      topValues: [{ value: "7", count: 2 }, { value: "9", count: 1 }],
      filtered: true,
    });
  });

  it("leaves a running query to finish on abort, drops its result and starts no further one", async () => {
    let finish: (value: QueryResult) => void = () => {};
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "execute_query") {
        return new Promise((resolve) => { finish = resolve; });
      }
      return Promise.resolve();
    });
    render(<Harness />);
    const controller = new AbortController();

    let result: Promise<unknown> | undefined;
    await act(async () => {
      result = capturedLoadColumnStats?.("id", ALL, controller.signal);
      result?.catch(() => {});
    });
    expect(executeQueryCalls()).toHaveLength(1);

    controller.abort();
    // cancel_query stops everything on the connection, so it is never sent.
    expect(invoke).not.toHaveBeenCalledWith("cancel_query", expect.anything());

    await act(async () => {
      finish({ ...initialResult, rows: [[4, 0, 4, 1, 9]] });
      await result?.catch(() => {});
    });
    await expect(result).rejects.toThrow();
    expect(executeQueryCalls()).toHaveLength(1);
  });

  it("sends neither the query nor a cancel when aborted before it runs", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    render(<Harness />);
    const controller = new AbortController();
    controller.abort();

    await act(async () => {
      await capturedLoadColumnStats?.("id", ALL, controller.signal).catch(() => {});
    });

    expect(executeQueryCalls()).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalledWith("cancel_query", expect.anything());
  });
});

describe("focus after filtering by a grid value (#1138)", () => {
  let finish: (value: QueryResult) => void = () => {};
  let fail: (reason: unknown) => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.connectionId = "connection-1";
    capturedFilterByValue = undefined;
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "execute_query"
        ? new Promise((resolve, reject) => { finish = resolve; fail = reject; })
        : Promise.resolve([]),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Picks a value with focus in the grid; the filter remounts the grid and
  // the loading state replaces it until the query returns.
  const filterFromGrid = async () => {
    render(<Harness />);
    screen.getByTestId("grid").focus();
    await act(async () => {
      capturedFilterByValue?.("id", "=", "7", "integer");
    });
    expect(executeQueryCalls()).toHaveLength(1);
    expect(screen.queryByTestId("grid")).toBeNull();
  };

  it("focuses the grid that shows the filtered rows", async () => {
    await filterFromGrid();
    expect(document.body).toHaveFocus();

    await act(async () => {
      finish({ ...initialResult, rows: [[7]] });
    });

    expect(screen.getByTestId("grid")).toHaveTextContent("[[7]]");
    expect(screen.getByTestId("grid")).toHaveFocus();
  });

  it("leaves focus where the user moved it while the query ran", async () => {
    await filterFromGrid();
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    try {
      elsewhere.focus();
      await act(async () => {
        finish({ ...initialResult, rows: [[7]] });
      });
      expect(screen.getByTestId("grid")).toHaveTextContent("[[7]]");
      expect(elsewhere).toHaveFocus();
    } finally {
      elsewhere.remove();
    }
  });

  it("drops the focus request when the filtered query fails", async () => {
    await filterFromGrid();
    await act(async () => {
      fail("syntax error");
    });
    expect(document.body).toHaveFocus();

    // An unrelated refresh succeeds later: it must not pull focus to the grid.
    await act(async () => {
      capturedRefresh?.();
    });
    await act(async () => {
      finish({ ...initialResult, rows: [[9]] });
    });

    expect(screen.getByTestId("grid")).toHaveTextContent("[[9]]");
    expect(document.body).toHaveFocus();
  });
});
