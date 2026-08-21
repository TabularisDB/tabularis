import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExplorerSidebar } from "../../../src/components/layout/ExplorerSidebar";
import { useDatabase } from "../../../src/hooks/useDatabase";
import { useSavedQueries } from "../../../src/hooks/useSavedQueries";
import { useQueryHistory } from "../../../src/hooks/useQueryHistory";
import { useAlert } from "../../../src/hooks/useAlert";
import { useConnectionLayoutContext } from "../../../src/hooks/useConnectionLayoutContext";
import { useDrivers } from "../../../src/hooks/useDrivers";
import { useEditor } from "../../../src/hooks/useEditor";
import { useSettings } from "../../../src/hooks/useSettings";
import { useDatabaseObjectNavigation } from "../../../src/hooks/useDatabaseObjectNavigation";
import { invoke } from "@tauri-apps/api/core";

const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translateMock }),
}));

vi.mock("../../../src/hooks/useDatabase", () => ({ useDatabase: vi.fn() }));
vi.mock("../../../src/hooks/useSavedQueries", () => ({ useSavedQueries: vi.fn() }));
vi.mock("../../../src/hooks/useQueryHistory", () => ({ useQueryHistory: vi.fn() }));
vi.mock("../../../src/hooks/useAlert", () => ({ useAlert: vi.fn() }));
vi.mock("../../../src/hooks/useConnectionLayoutContext", () => ({ useConnectionLayoutContext: vi.fn() }));
vi.mock("../../../src/hooks/useDrivers", () => ({ useDrivers: vi.fn() }));
vi.mock("../../../src/hooks/useEditor", () => ({ useEditor: vi.fn() }));
vi.mock("../../../src/hooks/useSettings", () => ({ useSettings: vi.fn() }));
vi.mock("../../../src/hooks/useDatabaseObjectNavigation", () => ({
  useDatabaseObjectNavigation: vi.fn(),
}));
vi.mock("../../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => ({
    call: (command: string, request: unknown) => invoke(command, request),
  }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../../src/utils/notebookStore", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/utils/notebookStore")
    >();
  return {
    ...actual,
    listNotebooks: vi.fn(
      () => new Promise<never[]>(() => undefined),
    ),
  };
});

// ExplorerSidebar pulls in many lucide icons; use the real module so every icon resolves
// (the global setup mock only stubs a fixed subset).
vi.mock("lucide-react", async (importOriginal) => await importOriginal());

const sidebarItemMocks = vi.hoisted(() => ({
  sidebarTableItemProps: [] as Array<Record<string, unknown>>,
  sidebarViewItemProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../src/components/layout/sidebar/SidebarTableItem", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../src/components/layout/sidebar/SidebarTableItem")
  >();
  return {
    ...actual,
    SidebarTableItem: (props: Record<string, unknown>) => {
      sidebarItemMocks.sidebarTableItemProps.push(props);
      return <actual.SidebarTableItem {...(props as Parameters<typeof actual.SidebarTableItem>[0])} />;
    },
  };
});

vi.mock("../../../src/components/layout/sidebar/SidebarViewItem", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../src/components/layout/sidebar/SidebarViewItem")
  >();
  return {
    ...actual,
    SidebarViewItem: (props: Record<string, unknown>) => {
      sidebarItemMocks.sidebarViewItemProps.push(props);
      return <actual.SidebarViewItem {...(props as Parameters<typeof actual.SidebarViewItem>[0])} />;
    },
  };
});

const DISPLAY = "could not connect: TLS handshake failed";
const DEBUG = 'InvalidCertificate(UnknownIssuer)\n  caused by: certificate verify failed';
const RAW_ERROR = `${DISPLAY}\n\n${DEBUG}`;

const renderSidebar = () =>
  render(
    <ExplorerSidebar
      sidebarWidth={280}
      startResize={vi.fn()}
      onCollapse={vi.fn()}
      sidebarTab="structure"
      onSidebarTabChange={vi.fn()}
    />
  );

describe("ExplorerSidebar — schema load error block", () => {
  const connect = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    vi.mocked(useDatabase).mockReturnValue({
      activeConnectionId: "c1",
      activeCapabilities: { schemas: true },
      schemas: [],
      connectionDataMap: { c1: { error: RAW_ERROR } },
      isLoadingTables: false,
      isLoadingSchemas: false,
      connect,
    } as unknown as ReturnType<typeof useDatabase>);

    vi.mocked(useSavedQueries).mockReturnValue({
      queries: [],
      deleteQuery: vi.fn(),
      updateQuery: vi.fn(),
      saveQuery: vi.fn(),
    } as unknown as ReturnType<typeof useSavedQueries>);

    vi.mocked(useQueryHistory).mockReturnValue({
      entries: [],
      isLoading: false,
      deleteEntry: vi.fn(),
      clearHistory: vi.fn(),
      recoveryNotice: null,
      dismissRecoveryNotice: vi.fn(),
    } as unknown as ReturnType<typeof useQueryHistory>);

    vi.mocked(useAlert).mockReturnValue({ showAlert: vi.fn() } as unknown as ReturnType<typeof useAlert>);

    vi.mocked(useDrivers).mockReturnValue({
      allDrivers: [],
    } as unknown as ReturnType<typeof useDrivers>);

    vi.mocked(useEditor).mockReturnValue({
      tabs: [],
      openNotebook: vi.fn(),
      updateTab: vi.fn(),
      closeTab: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    vi.mocked(useSettings).mockReturnValue({
      settings: { displayTimezone: "auto" },
    } as unknown as ReturnType<typeof useSettings>);

    vi.mocked(useConnectionLayoutContext).mockReturnValue({
      splitView: { connectionIds: [] },
      isSplitVisible: false,
      explorerConnectionId: null,
      setExplorerConnectionId: vi.fn(),
    } as unknown as ReturnType<typeof useConnectionLayoutContext>);
  });

  it("shows the error title and retry button instead of an empty tree", () => {
    renderSidebar();
    expect(screen.getByText("sidebar.schemaLoadError")).toBeInTheDocument();
    expect(screen.getByText("sidebar.retry")).toBeInTheDocument();
  });

  it("preview shows only the Display part (before the \\n\\n separator)", () => {
    renderSidebar();
    expect(screen.getByText(DISPLAY)).toBeInTheDocument();
    expect(screen.queryByText(RAW_ERROR)).not.toBeInTheDocument();
  });

  it("expanding the chevron reveals the full raw error (debug part) in a <pre>", () => {
    const { container } = renderSidebar();
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.queryByText(/InvalidCertificate/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("sidebar.errorDetails"));

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain(DEBUG);
  });

  it("copy button writes the full raw error to the clipboard", () => {
    renderSidebar();
    fireEvent.click(screen.getByText("sidebar.errorDetails"));
    fireEvent.click(screen.getByTitle("sidebar.copyError"));
    expect(writeText).toHaveBeenCalledWith(RAW_ERROR);
  });

  it("retry reconnects the active connection", () => {
    renderSidebar();
    fireEvent.click(screen.getByText("sidebar.retry"));
    expect(connect).toHaveBeenCalledWith("c1");
  });
});

describe("ExplorerSidebar — database object navigation", () => {
  const objectNavigation = {
    open: vi.fn(),
    count: vi.fn(),
    newConsole: vi.fn(),
    openRoutineDefinition: vi.fn(),
    openTriggerDefinition: vi.fn(),
    openDefinition: vi.fn(),
  };

  const routine = { name: "refresh_orders", routine_type: "FUNCTION" };
  const trigger = {
    name: "audit_orders",
    table_name: "orders",
    event: "INSERT",
    timing: "AFTER",
  };
  const databaseState = {
    activeConnectionId: "c1" as string | null,
    activeDriver: "postgres",
    activeCapabilities: { routines: true, triggers: true },
    activeTable: null,
    setActiveTable: vi.fn(),
    tables: [{ name: "orders" }],
    views: [{ name: "active_orders" }],
    routines: [routine],
    triggers: [trigger] as Array<typeof trigger>,
    schemas: [] as string[],
    connectionDataMap: { c1: {} },
    schemaDataMap: {},
    databaseDataMap: {},
    selectedSchemas: [] as string[],
    selectedDatabases: [] as string[],
    connections: [],
    isLoadingTables: false,
    isLoadingSchemas: false,
    connect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    databaseState.activeConnectionId = "c1";
    databaseState.triggers = [trigger];

    vi.mocked(useDatabaseObjectNavigation).mockReturnValue(
      objectNavigation as unknown as ReturnType<
        typeof useDatabaseObjectNavigation
      >,
    );

    // No `schemas` capability keeps the sidebar in its flat layout, where tables,
    // views, routines and triggers all render off the connection root.
    vi.mocked(useDatabase).mockReturnValue(
      databaseState as unknown as ReturnType<typeof useDatabase>,
    );

    vi.mocked(useSavedQueries).mockReturnValue({
      queries: [],
      deleteQuery: vi.fn(),
      updateQuery: vi.fn(),
      saveQuery: vi.fn(),
    } as unknown as ReturnType<typeof useSavedQueries>);

    vi.mocked(useQueryHistory).mockReturnValue({
      entries: [],
      isLoading: false,
      deleteEntry: vi.fn(),
      clearHistory: vi.fn(),
      recoveryNotice: null,
      dismissRecoveryNotice: vi.fn(),
    } as unknown as ReturnType<typeof useQueryHistory>);

    vi.mocked(useAlert).mockReturnValue({
      showAlert: vi.fn(),
    } as unknown as ReturnType<typeof useAlert>);

    vi.mocked(useDrivers).mockReturnValue({
      allDrivers: [],
    } as unknown as ReturnType<typeof useDrivers>);

    vi.mocked(useEditor).mockReturnValue({
      tabs: [],
      openNotebook: vi.fn(),
      updateTab: vi.fn(),
      closeTab: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    vi.mocked(useSettings).mockReturnValue({
      settings: { displayTimezone: "auto" },
    } as unknown as ReturnType<typeof useSettings>);

    vi.mocked(useConnectionLayoutContext).mockReturnValue({
      splitView: { connectionIds: [] },
      isSplitVisible: false,
      explorerConnectionId: null,
      setExplorerConnectionId: vi.fn(),
    } as unknown as ReturnType<typeof useConnectionLayoutContext>);
  });

  const openContextMenuOn = (name: string) => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByText(name));
  };

  it("double-clicking a table opens it", () => {
    renderSidebar();
    fireEvent.doubleClick(screen.getByText("orders"));
    expect(objectNavigation.open).toHaveBeenCalledWith("orders", undefined);
  });

  it("double-clicking a view opens it as a non-materialized view", () => {
    renderSidebar();
    fireEvent.doubleClick(screen.getByText("active_orders"));
    expect(objectNavigation.open).toHaveBeenCalledWith(
      "active_orders",
      undefined,
      { materialized: false },
    );
  });

  it("double-clicking a routine loads its definition", () => {
    renderSidebar();
    fireEvent.click(screen.getByText("sidebar.routines (1)"));
    fireEvent.doubleClick(screen.getByText("refresh_orders"));
    expect(objectNavigation.openRoutineDefinition).toHaveBeenCalledWith(
      routine,
      undefined,
    );
  });

  it("double-clicking a trigger loads its definition", () => {
    renderSidebar();
    fireEvent.click(screen.getByText("sidebar.triggers (1)"));
    fireEvent.doubleClick(screen.getByText("audit_orders"));
    expect(objectNavigation.openTriggerDefinition).toHaveBeenCalledWith(
      trigger,
      undefined,
    );
  });

  it("context menu — show data opens the table", () => {
    openContextMenuOn("orders");
    fireEvent.click(screen.getByText("sidebar.showData"));
    expect(objectNavigation.open).toHaveBeenCalledWith("orders", undefined);
  });

  it("context menu — new console opens a console for the table", () => {
    openContextMenuOn("orders");
    fireEvent.click(screen.getByText("sidebar.newConsole"));
    expect(objectNavigation.newConsole).toHaveBeenCalledWith(
      "orders",
      undefined,
    );
  });

  it("context menu — count rows counts the table", () => {
    openContextMenuOn("orders");
    fireEvent.click(screen.getByText("sidebar.countRows"));
    expect(objectNavigation.count).toHaveBeenCalledWith("orders", undefined);
  });

  it("disables table actions that require an active connection", () => {
    databaseState.activeConnectionId = null;

    openContextMenuOn("orders");

    expect(
      screen.getByRole("button", { name: "sidebar.viewSchema" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "sidebar.generateSQL" }),
    ).toBeDisabled();
  });

  it("disables trigger definition without trigger metadata", () => {
    databaseState.triggers = [
      {
        name: "orphan_trigger",
        event: "INSERT",
        timing: "AFTER",
      } as typeof trigger,
    ];
    renderSidebar();
    fireEvent.click(screen.getByText("sidebar.triggers (1)"));
    fireEvent.contextMenu(screen.getByText("orphan_trigger"));

    expect(
      screen.getByRole("button", {
        name: "sidebar.viewTriggerDefinition",
      }),
    ).toBeDisabled();
  });
});

describe("ExplorerSidebar — capabilities threading (issue #614)", () => {
  const databaseState = {
    activeConnectionId: "c1" as string | null,
    activeDriver: "postgresql",
    activeCapabilities: { sql_dialect: "postgres", identifier_quote: '"' },
    activeTable: null,
    setActiveTable: vi.fn(),
    tables: [{ name: "orders" }],
    views: [{ name: "active_orders" }],
    routines: [],
    triggers: [],
    schemas: [] as string[],
    connectionDataMap: { c1: {} },
    schemaDataMap: {},
    databaseDataMap: {},
    selectedSchemas: [] as string[],
    selectedDatabases: [] as string[],
    connections: [],
    isLoadingTables: false,
    isLoadingSchemas: false,
    connect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sidebarItemMocks.sidebarTableItemProps.length = 0;
    sidebarItemMocks.sidebarViewItemProps.length = 0;

    vi.mocked(useDatabaseObjectNavigation).mockReturnValue({
      open: vi.fn(),
      count: vi.fn(),
      newConsole: vi.fn(),
      openRoutineDefinition: vi.fn(),
      openTriggerDefinition: vi.fn(),
      openDefinition: vi.fn(),
    } as unknown as ReturnType<typeof useDatabaseObjectNavigation>);

    vi.mocked(useDatabase).mockReturnValue(
      databaseState as unknown as ReturnType<typeof useDatabase>,
    );

    vi.mocked(useSavedQueries).mockReturnValue({
      queries: [],
      deleteQuery: vi.fn(),
      updateQuery: vi.fn(),
      saveQuery: vi.fn(),
    } as unknown as ReturnType<typeof useSavedQueries>);

    vi.mocked(useQueryHistory).mockReturnValue({
      entries: [],
      isLoading: false,
      deleteEntry: vi.fn(),
      clearHistory: vi.fn(),
      recoveryNotice: null,
      dismissRecoveryNotice: vi.fn(),
    } as unknown as ReturnType<typeof useQueryHistory>);

    vi.mocked(useAlert).mockReturnValue({
      showAlert: vi.fn(),
    } as unknown as ReturnType<typeof useAlert>);

    vi.mocked(useDrivers).mockReturnValue({
      allDrivers: [],
    } as unknown as ReturnType<typeof useDrivers>);

    vi.mocked(useEditor).mockReturnValue({
      tabs: [],
      openNotebook: vi.fn(),
      updateTab: vi.fn(),
      closeTab: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    vi.mocked(useSettings).mockReturnValue({
      settings: { displayTimezone: "auto" },
    } as unknown as ReturnType<typeof useSettings>);

    vi.mocked(useConnectionLayoutContext).mockReturnValue({
      splitView: { connectionIds: [] },
      isSplitVisible: false,
      explorerConnectionId: null,
      setExplorerConnectionId: vi.fn(),
    } as unknown as ReturnType<typeof useConnectionLayoutContext>);
  });

  it("passes activeCapabilities through to SidebarTableItem, not just the driver id", () => {
    renderSidebar();
    expect(sidebarItemMocks.sidebarTableItemProps).toHaveLength(1);
    expect(sidebarItemMocks.sidebarTableItemProps[0].capabilities).toBe(
      databaseState.activeCapabilities,
    );
  });

  it("passes activeCapabilities through to SidebarViewItem, not just the driver id", () => {
    renderSidebar();
    expect(sidebarItemMocks.sidebarViewItemProps).toHaveLength(1);
    expect(sidebarItemMocks.sidebarViewItemProps[0].capabilities).toBe(
      databaseState.activeCapabilities,
    );
  });
});
