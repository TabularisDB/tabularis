import { useCallback, useLayoutEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Editor } from "../../src/pages/Editor";
import { EditorContext, type EditorContextType } from "../../src/contexts/EditorContext";
import { createAutoRefreshSchedule, type AutoRefreshSchedule } from "../../src/utils/autoRefresh";
import type { Tab, QueryResult } from "../../src/types/editor";
import type { DataGridCommandTarget } from "../../src/components/ui/DataGrid";

// debba review (PR #822, 2026-10-10): "history still stores the schema as
// `database`, and replay uses it as a pool override, so it tries to connect
// to a database named `public`. This hits every existing PG connection that
// hasn't opted into multi-database browsing."
//
// This drives the REAL Editor component (not a reimplementation) with a
// plain, non-opted-in PostgreSQL connection — selectedDatabases: [] — and
// asserts exactly what addEntry (the history recorder) is called with.

const mocks = vi.hoisted(() => ({
  connectionId: "connection-1",
  addEntry: vi.fn(),
  guard: vi.fn().mockResolvedValue(true),
  noop: vi.fn(),
  location: { state: null, pathname: "/editor", key: "test" },
  settings: { resultPageSize: 100, csvIncludeHeaders: true },
  // A plain, single-database PostgreSQL connection: schemas: true (so
  // isMultiDatabaseCapable requires schemas === false — never satisfied),
  // and selectedDatabases is empty (not opted into multi-db browsing).
  capabilities: { schemas: true, sql_dialect: "postgres", identifier_quote: '"' },
  t: (key: string) => key,
  notify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/utils/queryNotification", () => ({ notifyQueryFinished: mocks.notify }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("lucide-react", async (importOriginal) => await importOriginal());
vi.mock("react-router-dom", () => ({ useLocation: () => mocks.location, useNavigate: () => mocks.noop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn() }));
vi.mock("../../src/hooks/useDatabase", () => ({ useDatabase: () => ({
  activeConnectionId: mocks.connectionId, activeDriver: "postgres", activeSchema: "public",
  activeCapabilities: mocks.capabilities, activeDatabaseName: "testdb", activeConnectionName: "Test",
  connections: [], tables: [], views: [], materializedViews: [],
  // The crux of the bug report: a plain PG connection has NOT opted into
  // multi-database browsing, so selectedDatabases is empty.
  selectedDatabases: [],
}) }));
vi.mock("../../src/hooks/useDrivers", () => ({ useDrivers: () => ({ allDrivers: [] }) }));
vi.mock("../../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: mocks.settings }) }));
vi.mock("../../src/hooks/useConnectionLayoutContext", () => ({ useConnectionLayoutContext: () => ({ explorerConnectionId: null }) }));
vi.mock("../../src/hooks/useSavedQueries", () => ({ useSavedQueries: () => ({ saveQuery: mocks.noop }) }));
vi.mock("../../src/hooks/useQueryHistory", () => ({ useQueryHistory: () => ({ addEntry: mocks.addEntry }) }));
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
    return <div data-testid="grid"><span>{JSON.stringify(data)}</span></div>;
  },
}));

const queryResult: QueryResult = { columns: ["db"], rows: [["testdb"]], affected_rows: 0 };

// A plain console tab on a non-opted-in PG connection: no `database` field at
// all (undefined), schema left at the connection default ("public" from
// useDatabase mock's activeSchema, since the tab doesn't override it either).
const consoleTab = (id = "console-1", connectionId = "connection-1"): Tab => ({
  id, connectionId, title: id, type: "console",
  query: "SELECT current_database() AS db",
  result: null, error: "", executionTime: null, page: 1,
  activeTable: null, pkColumns: null, isEditorOpen: true,
});

let context: EditorContextType;
function Harness({ initialTabs = [consoleTab()] }: { initialTabs?: Tab[] }) {
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
    addTab: mocks.noop, openNotebook: mocks.noop, closeTab: mocks.noop,
    closeAllTabs: mocks.noop, closeOtherTabs: mocks.noop, closeTabsToLeft: mocks.noop, closeTabsToRight: mocks.noop,
    reorderTab: mocks.noop, updateResultEntry: mocks.noop, getSchema: mocks.noop,
    reopenClosedTab: mocks.noop, canReopenClosedTab: false,
  } as EditorContextType;
  useLayoutEffect(() => { context = value; });
  return <EditorContext.Provider value={value}><Editor /></EditorContext.Provider>;
}

describe("history recording on a plain (non-opted-in) PostgreSQL connection", () => {
  beforeEach(() => {
    mocks.addEntry.mockClear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "execute_query" ? Promise.resolve(queryResult) : Promise.resolve([]));
  });
  afterEach(() => vi.restoreAllMocks());

  it("records the history entry's database as undefined/null, never the schema", async () => {
    render(<Harness />);

    // Run the query via the real runQuery path (keyboard shortcut path is
    // mocked out; invoke the exposed e2e hook that mirrors the Run button).
    await act(async () => {
      await (window as unknown as { __e2e_submitChanges?: unknown }); // no-op probe, keep act flushed
    });

    // Drive the real run via the component's exposed run entrypoint: locate
    // the Run button (aria-label starts with the "editor.run" i18n key under
    // the identity t() mock, followed by the keyboard shortcut hint).
    const runButton = screen.getByRole("button", { name: /^editor\.run/ });
    fireEvent.click(runButton);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.addEntry).toHaveBeenCalled();
    const [, , , , , historyDbArg] = mocks.addEntry.mock.calls[0];

    // The schema is "public" (connection default) — the entry's database must
    // NEVER be "public". It must be undefined (no override) since this
    // connection has not opted into multi-database browsing.
    expect(historyDbArg).not.toBe("public");
    expect(historyDbArg).toBeUndefined();
  });

  it("still records undefined when the tab carries an explicit schema (e.g. a console opened from a table)", async () => {
    // A console tab opened via a table's context menu carries the table's
    // schema explicitly (tab.schema = "public"), rather than relying on the
    // connection-level activeSchema fallback. This must not leak into the
    // history entry's database field either.
    render(<Harness initialTabs={[{ ...consoleTab(), schema: "public" }]} />);

    const runButton = screen.getByRole("button", { name: /^editor\.run/ });
    fireEvent.click(runButton);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.addEntry).toHaveBeenCalled();
    const [, , , , , historyDbArg] = mocks.addEntry.mock.calls[0];
    expect(historyDbArg).not.toBe("public");
    expect(historyDbArg).toBeUndefined();
  });
});
