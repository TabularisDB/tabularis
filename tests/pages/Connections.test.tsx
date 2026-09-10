import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Connections } from "../../src/pages/Connections";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  connectionGroups: [],
  connections: [],
  createSqliteDatabase: vi.fn(),
  drivers: [],
  loadConnections: vi.fn(),
  navigate: vi.fn(),
  openConnectionInNewWindow: vi.fn(),
  settings: { autoConnectLastConnection: false },
}));

vi.mock("lucide-react", () => ({
  AlertCircle: () => null,
  AppWindow: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  Database: () => null,
  Download: () => null,
  Edit: () => null,
  Folder: () => null,
  FolderInput: () => null,
  FolderPlus: () => null,
  FolderTree: () => null,
  LayoutGrid: () => null,
  List: () => null,
  Loader2: () => null,
  Plus: () => null,
  Search: () => null,
  Trash2: () => null,
  X: () => null,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useLocation: () => ({ state: null }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    connect: mocks.connect,
    disconnect: vi.fn(),
    isConnectionOpen: () => false,
    isConnectionOpenAnywhere: () => false,
    switchConnection: vi.fn(),
    connectionGroups: mocks.connectionGroups,
    createGroupPath: vi.fn(),
    updateGroup: vi.fn(),
    moveGroupToParent: vi.fn(),
    deleteGroup: vi.fn(),
    moveConnectionToGroup: vi.fn(),
    reorderGroups: vi.fn(),
    toggleGroupCollapsed: vi.fn(),
    loadConnections: mocks.loadConnections,
    connections: mocks.connections,
  }),
}));

vi.mock("../../src/hooks/useDrivers", () => ({
  useDrivers: () => ({ drivers: mocks.drivers, allDrivers: mocks.drivers, installedPlugins: [] }),
}));

vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));

vi.mock("../../src/hooks/useConnectionTags", () => ({
  useConnectionTags: () => ({
    tags: [],
    refresh: vi.fn().mockResolvedValue(undefined),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useOpenConnectionInNewWindow", () => ({
  useOpenConnectionInNewWindow: () => mocks.openConnectionInNewWindow,
}));

vi.mock("../../src/hooks/useCreateSqliteDatabase", () => ({
  useCreateSqliteDatabase: () => ({
    createSqliteDatabase: mocks.createSqliteDatabase,
    isCreating: false,
  }),
}));

// The migration banner hook pulls in useConnectionCatalogue and others the
// SQLite-creation tests don't otherwise need. Mock it to a hidden-banner
// no-op so the tests stay focused on the SQLite action.
vi.mock("../../src/hooks/useBuiltinDriverMigration", () => ({
  useBuiltinPostgresMigration: () => ({
    builtinId: "postgres",
    pluginId: "postgresql",
    builtinConnections: [],
    needsMigration: false,
    pluginReady: false,
    registryOffline: false,
    banner: null,
    dismissBanner: vi.fn(),
    migrateConnection: vi.fn(),
    undoMigration: vi.fn(),
  }),
}));

// Connections.tsx also calls useConnectionCatalogue directly (for the
// migration outcome toast's repo_url lookup) — mock it the same way.
vi.mock("../../src/hooks/useConnectionCatalogue", () => ({
  useConnectionCatalogue: () => ({
    groups: [],
    facets: [],
    loading: false,
    registryOffline: false,
    registry: [],
    refresh: vi.fn(),
  }),
}));

vi.mock("../../src/components/modals/NewConnectionModal", () => ({
  NewConnectionModal: () => null,
}));

vi.mock("../../src/components/modals/ConfirmModal", () => ({
  ConfirmModal: () => null,
}));

vi.mock("../../src/components/modals/ExportConnectionsModal", () => ({
  ExportConnectionsModal: () => null,
}));

vi.mock("../../src/components/modals/ImportFromAppModal", () => ({
  ImportFromAppModal: () => null,
}));

const sqliteConnection = {
  id: "sqlite-1",
  name: "customers",
  params: {
    driver: "sqlite",
    database: "/tmp/customers.db",
  },
};

describe("Connections SQLite database action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(undefined);
    mocks.createSqliteDatabase.mockResolvedValue(sqliteConnection);
    mocks.loadConnections.mockResolvedValue(undefined);
  });

  it("creates, refreshes, and opens a database from the empty state", async () => {
    render(<Connections />);

    fireEvent.click(screen.getByText("connections.newSqliteDatabase.menuLabel"));

    await waitFor(() => {
      expect(mocks.createSqliteDatabase).toHaveBeenCalledTimes(1);
      expect(mocks.loadConnections).toHaveBeenCalledTimes(2);
      expect(mocks.connect).toHaveBeenCalledWith("sqlite-1");
      expect(mocks.navigate).toHaveBeenCalledWith("/editor");
    });
  });

  it("also exposes the action in the add-connection menu", () => {
    render(<Connections />);

    fireEvent.click(screen.getByTitle("connections.addConnection"));

    expect(
      screen.getAllByText("connections.newSqliteDatabase.menuLabel"),
    ).toHaveLength(2);
  });

  it("shows a creation error without attempting to connect", async () => {
    mocks.createSqliteDatabase.mockRejectedValue(new Error("permission denied"));
    render(<Connections />);

    fireEvent.click(screen.getByText("connections.newSqliteDatabase.menuLabel"));

    expect(
      await screen.findByText("connections.newSqliteDatabase.error"),
    ).toBeInTheDocument();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
