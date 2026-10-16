import { useCallback, useLayoutEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Editor } from "../../src/pages/Editor";
import { EditorContext, type EditorContextType } from "../../src/contexts/EditorContext";
import { createAutoRefreshSchedule, type AutoRefreshSchedule } from "../../src/utils/autoRefresh";
import type { Tab, QueryResult } from "../../src/types/editor";
import type { DataGridCommandTarget } from "../../src/components/ui/DataGrid";

// Captures the `onRunQuery` prop the Editor passes to TableToolbar so the test
// can drive it directly, exercising the real `runToolbarQuery` callback
// without rendering the filter-value picker UI.
let capturedRunToolbarQuery: ((sql: string) => Promise<QueryResult>) | undefined;

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
  }: {
    ref: Ref<DataGridCommandTarget>;
    data: unknown[][];
    onEditingChange?: (editing: boolean) => void;
  }) {
    const [editing, setEditing] = useState(false);
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
