import { useCallback, useLayoutEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import { act, render } from "@testing-library/react";
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
// Same for the DataGrid's column statistics loader (issue #1001).
type LoadColumnStats = NonNullable<ComponentProps<typeof DataGridType>["onLoadColumnStats"]>;
let capturedLoadColumnStats: LoadColumnStats | undefined;

const mocks = vi.hoisted(() => ({
  connectionId: "connection-1",
  guard: vi.fn().mockResolvedValue(true),
  noop: vi.fn(),
  location: { state: null, pathname: "/editor", key: "test" },
  settings: { resultPageSize: 100, csvIncludeHeaders: true },
  capabilities: { schemas: true, sql_dialect: "postgresql", identifier_quote: '"' } as Record<
    string,
    unknown
  >,
  driver: "postgres",
  drivers: [{ id: "postgres", is_builtin: true }] as { id: string; is_builtin?: boolean }[],
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
    activeDriver: mocks.driver,
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
vi.mock("../../src/hooks/useDrivers", () => ({ useDrivers: () => ({ allDrivers: mocks.drivers }) }));
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
  TableToolbar: ({ onRunQuery }: { onRunQuery?: (sql: string) => Promise<QueryResult> }) => {
    useLayoutEffect(() => {
      capturedRunToolbarQuery = onRunQuery;
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
  }: {
    ref: Ref<DataGridCommandTarget>;
    data: unknown[][];
    onEditingChange?: (editing: boolean) => void;
    onLoadColumnStats?: LoadColumnStats;
  }) {
    const [editing, setEditing] = useState(false);
    useLayoutEffect(() => {
      capturedLoadColumnStats = onLoadColumnStats;
    });
    useImperativeHandle(
      ref,
      () => ({ isEditing: () => editing, getResultCommands: () => ({}) }),
      [editing],
    );
    useLayoutEffect(() => {
      onEditingChange?.(editing);
    }, [onEditingChange, editing]);
    useLayoutEffect(() => () => onEditingChange?.(false), [onEditingChange]);
    return (
      <div data-testid="grid" style={{ overflow: "auto" }}>
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

describe("column statistics from plugin drivers (#1137)", () => {
  const ALL = { distinct: true, minMax: true, topValues: true };
  const defaults = {
    capabilities: mocks.capabilities,
    driver: mocks.driver,
    drivers: mocks.drivers,
  };
  const optedIn = { schemas: false, identifier_quote: "`", column_stats: true };
  const pluginStats = {
    row_count: 4,
    null_count: 1,
    distinct_count: 2,
    min: 1,
    max: 9,
    top_values: [{ value: 7, count: 2 }],
  };

  function statsCalls() {
    return vi.mocked(invoke).mock.calls.filter(([command]) => command === "get_column_stats");
  }

  function usePlugin(capabilities: Record<string, unknown>) {
    mocks.capabilities = capabilities;
    mocks.driver = "surrealdb";
    mocks.drivers = [{ id: "surrealdb", is_builtin: false }];
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.connectionId = "connection-1";
    capturedLoadColumnStats = undefined;
    vi.mocked(invoke).mockReset();
  });
  afterEach(() => {
    Object.assign(mocks, defaults);
    vi.useRealTimers();
  });

  it("asks an opted-in plugin through get_column_stats and runs no SQL", async () => {
    usePlugin(optedIn);
    vi.mocked(invoke).mockImplementation((command) =>
      Promise.resolve(command === "get_column_stats" ? pluginStats : []),
    );
    render(<Harness initialTabs={[initialTab("table-1", "connection-1", "ns_db")]} />);

    let stats: Awaited<ReturnType<LoadColumnStats>> | undefined;
    await act(async () => {
      stats = await capturedLoadColumnStats?.("id", ALL, new AbortController().signal);
    });

    expect(statsCalls()).toEqual([
      [
        "get_column_stats",
        {
          connectionId: "connection-1",
          database: "ns_db",
          request: {
            table: "jobs",
            schema: null,
            column: "id",
            data_type: null,
            filter: "id > 0",
            top_values_limit: 10,
            include: { distinct: true, min_max: true, top_values: true },
          },
        },
      ],
    ]);
    expect(executeQueryCalls()).toHaveLength(0);
    expect(stats).toMatchObject({
      rowCount: 4,
      nullCount: 1,
      distinctCount: 2,
      min: 1,
      max: 9,
      topValues: [{ value: "7", count: 2 }],
      filtered: true,
    });
  });

  it("reports an error when a non-SQL plugin answers that it has no statistics", async () => {
    usePlugin(optedIn);
    vi.mocked(invoke).mockImplementation((command) =>
      Promise.resolve(command === "get_column_stats" ? null : []),
    );
    render(<Harness />);

    let error: unknown;
    await act(async () => {
      await capturedLoadColumnStats?.("id", ALL, new AbortController().signal).catch((e) => {
        error = e;
      });
    });
    expect(String(error)).toContain("doesn't provide column statistics");
    expect(executeQueryCalls()).toHaveLength(0);
  });

  it("falls back to the generic SQL when a SQL-compatible plugin has no statistics", async () => {
    usePlugin({ ...optedIn, sql_dialect: "mysql" });
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "get_column_stats") return Promise.resolve(null);
      if (command !== "execute_query") return Promise.resolve([]);
      const query = (args as { query: string }).query;
      return Promise.resolve({
        ...initialResult,
        rows: query.startsWith("SELECT COUNT(*)") ? [[2, 0, 2, 1, 2]] : [[1, 1], [2, 1]],
      });
    });
    render(<Harness />);

    await act(async () => {
      await capturedLoadColumnStats?.("id", ALL, new AbortController().signal);
    });
    expect(statsCalls()).toHaveLength(1);
    expect((executeQueryCalls()[0][1] as { query: string }).query).toBe(
      "SELECT COUNT(*), COUNT(*) - COUNT(`id`), COUNT(DISTINCT `id`), MIN(`id`), MAX(`id`) " +
        "FROM `jobs` WHERE (id > 0)",
    );
  });

  it("uses the generic SQL for a SQL-compatible plugin that doesn't opt in", async () => {
    usePlugin({ schemas: false, identifier_quote: "`", sql_dialect: "mysql" });
    vi.mocked(invoke).mockResolvedValue([]);
    render(<Harness />);
    expect(capturedLoadColumnStats).toBeDefined();
  });

  it.each([
    ["no sql_dialect", { schemas: false, identifier_quote: '"' }],
    ["a dialect without LIMIT", { schemas: false, identifier_quote: '"', sql_dialect: "mssql" }],
    ["the generic dialect", { schemas: false, identifier_quote: '"', sql_dialect: "generic" }],
  ])("hides the entry for a plugin with %s that doesn't opt in", (_name, capabilities) => {
    usePlugin(capabilities);
    vi.mocked(invoke).mockResolvedValue([]);
    render(<Harness />);
    expect(capturedLoadColumnStats).toBeUndefined();
  });

  it("drops a late plugin result after an abort and never sends cancel_query", async () => {
    usePlugin(optedIn);
    let finish: (value: unknown) => void = () => {};
    vi.mocked(invoke).mockImplementation((command) =>
      command === "get_column_stats"
        ? new Promise((resolve) => { finish = resolve; })
        : Promise.resolve([]),
    );
    render(<Harness />);
    const controller = new AbortController();

    let result: Promise<unknown> | undefined;
    await act(async () => {
      result = capturedLoadColumnStats?.("id", ALL, controller.signal);
      result?.catch(() => {});
    });
    expect(statsCalls()).toHaveLength(1);

    controller.abort();
    await act(async () => {
      finish(pluginStats);
      await result?.catch(() => {});
    });
    await expect(result).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    expect(invoke).not.toHaveBeenCalledWith("cancel_query", expect.anything());
  });

  it("sends no request when aborted before it runs", async () => {
    usePlugin(optedIn);
    vi.mocked(invoke).mockResolvedValue([]);
    render(<Harness />);
    const controller = new AbortController();
    controller.abort();

    await act(async () => {
      await capturedLoadColumnStats?.("id", ALL, controller.signal).catch(() => {});
    });
    expect(statsCalls()).toHaveLength(0);
  });
});
