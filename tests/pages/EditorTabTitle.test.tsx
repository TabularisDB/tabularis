import { useCallback, useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Editor } from "../../src/pages/Editor";
import { EditorContext, type EditorContextType } from "../../src/contexts/EditorContext";
import { createAutoRefreshSchedule, type AutoRefreshSchedule } from "../../src/utils/autoRefresh";
import type { Tab } from "../../src/types/editor";

// Issue #1132: long tab titles are truncated with an ellipsis, so tabs that
// share a prefix ("global-mae_fi…", "global-mae_af…") cannot be told apart.
// Drives the real Editor tab strip and checks each tab exposes its full,
// qualified name as a tooltip and as its accessible name.

const mocks = vi.hoisted(() => ({
  noop: vi.fn(),
  guard: vi.fn().mockResolvedValue(true),
  location: { state: null, pathname: "/editor", key: "test" },
  settings: { resultPageSize: 100, csvIncludeHeaders: true },
  capabilities: { schemas: true, sql_dialect: "postgres", identifier_quote: '"' } as Record<
    string,
    unknown
  >,
  selectedDatabases: [] as string[],
  t: (key: string) => key,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("lucide-react", async (importOriginal) => await importOriginal());
vi.mock("react-router-dom", () => ({ useLocation: () => mocks.location, useNavigate: () => mocks.noop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}), emit: vi.fn() }));
vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    activeConnectionId: "connection-1",
    activeDriver: "postgres",
    activeSchema: "public",
    activeCapabilities: mocks.capabilities,
    activeDatabaseName: "testdb",
    activeConnectionName: "Test",
    connections: [],
    tables: [],
    views: [],
    materializedViews: [],
    selectedDatabases: mocks.selectedDatabases,
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
vi.mock("../../src/components/ui/SqlEditorWrapper", () => ({ SqlEditorWrapper: () => null }));
vi.mock("../../src/components/ui/TableToolbar", () => ({ TableToolbar: () => null }));
vi.mock("../../src/components/ui/RelatedRecordsPanel", () => ({ RelatedRecordsPanel: () => null }));
vi.mock("../../src/components/ui/DataGrid", () => ({ DataGrid: () => null }));
vi.mock("../../src/components/notebook/NotebookView", () => ({ NotebookView: () => null }));
vi.mock("../../src/components/users/UserManagementView", () => ({ UserManagementView: () => null }));
vi.mock("../../src/components/layout/CommandPaletteScopeBridge", () => ({
  CommandPaletteScopeBridge: () => null,
}));

const baseTab = (overrides: Partial<Tab>): Tab => ({
  id: "tab",
  connectionId: "connection-1",
  title: "tab",
  type: "console",
  query: "",
  result: null,
  error: "",
  executionTime: null,
  page: 1,
  activeTable: null,
  pkColumns: null,
  isEditorOpen: false,
  ...overrides,
});
const tableTab = (id: string, table: string, extra: Partial<Tab> = {}): Tab =>
  baseTab({ id, title: table, type: "table", activeTable: table, ...extra });

function Harness({ initialTabs }: { initialTabs: Tab[] }) {
  const [tabs] = useState(initialTabs);
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
  const value = {
    tabs,
    activeTabId,
    activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
    getAutoRefreshSchedule,
    updateTab: mocks.noop,
    setActiveTabId,
    addTab: mocks.noop,
    openNotebook: mocks.noop,
    closeTab: mocks.noop,
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

describe("Editor tab strip full titles (#1132)", () => {
  beforeEach(() => {
    mocks.capabilities = { schemas: true, sql_dialect: "postgres", identifier_quote: '"' };
    mocks.selectedDatabases = [];
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
  });

  it("gives tabs sharing a long prefix their full, schema-qualified name as tooltip and accessible name", () => {
    render(
      <Harness
        initialTabs={[
          baseTab({ id: "console-1", title: "Console" }),
          tableTab("t1", "global-mae_firewall_events", { schema: "public" }),
          tableTab("t2", "global-mae_affiliate_payouts", { schema: "public" }),
        ]}
      />,
    );

    const firewall = screen.getByRole("button", { name: "public.global-mae_firewall_events" });
    const payouts = screen.getByRole("button", { name: "public.global-mae_affiliate_payouts" });
    expect(firewall).toHaveAttribute("title", "public.global-mae_firewall_events");
    expect(payouts).toHaveAttribute("title", "public.global-mae_affiliate_payouts");
    // The visible (truncated) label is still part of the accessible name.
    expect(firewall).toHaveTextContent("global-mae_firewall_events");
  });

  it("includes the database for tabs of a multi-database driver", () => {
    render(
      <Harness
        initialTabs={[
          baseTab({ id: "console-1", title: "Console" }),
          tableTab("t1", "global-mae_zones", { schema: "public", database: "analytics" }),
        ]}
      />,
    );

    const tab = screen.getByRole("button", { name: "analytics.public.global-mae_zones" });
    expect(tab).toHaveAttribute("title", "analytics.public.global-mae_zones");
  });

  it("names a console tab with the database it runs against in a multi-database layout", () => {
    mocks.capabilities = { schemas: false, file_based: false, sql_dialect: "mysql" };
    mocks.selectedDatabases = ["sales", "hr"];
    render(<Harness initialTabs={[baseTab({ id: "console-1", title: "Console", schema: "hr" })]} />);

    const tab = screen.getByRole("button", { name: "Console (hr)" });
    expect(tab).toHaveAttribute("title", "Console (hr)");
  });
});
