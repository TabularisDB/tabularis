import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { DatabaseSwitcherModal } from "../../../src/components/modals/DatabaseSwitcherModal";
import type { DriverCapabilities } from "../../../src/types/plugins";

const dbMocks = vi.hoisted(() => ({
  setSelectedDatabases: vi.fn(),
  setActiveTable: vi.fn(),
  state: {
    capabilities: null as DriverCapabilities | null,
    selectedDatabases: [] as string[],
    activeSchema: null as string | null,
  },
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    activeConnectionId: "conn-1",
    activeCapabilities: dbMocks.state.capabilities,
    activeSchema: dbMocks.state.activeSchema,
    selectedDatabases: dbMocks.state.selectedDatabases,
    setSelectedDatabases: dbMocks.setSelectedDatabases,
    setActiveTable: dbMocks.setActiveTable,
  }),
}));

const multiDbCapabilities: DriverCapabilities = {
  schemas: false,
  views: true,
  routines: true,
  file_based: false,
  folder_based: false,
  identifier_quote: "`",
  alter_primary_key: true,
};

describe("DatabaseSwitcherModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.state.capabilities = multiDbCapabilities;
    dbMocks.state.selectedDatabases = ["shop"];
    dbMocks.state.activeSchema = "shop";
    vi.mocked(invoke).mockResolvedValue(["shop", "analytics", "archive"]);
  });

  it("renders nothing for non multi-database drivers", () => {
    dbMocks.state.capabilities = {
      ...multiDbCapabilities,
      single_database: true,
    };
    const { container } = render(
      <DatabaseSwitcherModal isOpen={true} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalledWith(
      "get_available_databases",
      expect.anything(),
    );
  });

  it("loads and lists databases sorted, marking the current one", async () => {
    render(<DatabaseSwitcherModal isOpen={true} onClose={() => {}} />);
    expect(invoke).toHaveBeenCalledWith("get_available_databases", {
      connectionId: "conn-1",
    });
    await waitFor(() => {
      expect(screen.getByText("analytics")).toBeInTheDocument();
    });
    const names = screen
      .getAllByText(/^(shop|analytics|archive)$/)
      .map((el) => el.textContent);
    expect(names).toEqual(["analytics", "archive", "shop"]);
    expect(screen.getByText("databaseSwitcher.current")).toBeInTheDocument();
  });

  it("filters databases as the user types", async () => {
    render(<DatabaseSwitcherModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("analytics")).toBeInTheDocument();
    });
    fireEvent.change(
      screen.getByPlaceholderText("databaseSwitcher.placeholder"),
      { target: { value: "arch" } },
    );
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(screen.queryByText("analytics")).not.toBeInTheDocument();
  });

  it("adds an unselected database to the selection and focuses it", async () => {
    const onClose = vi.fn();
    render(<DatabaseSwitcherModal isOpen={true} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("analytics")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("analytics"));
    expect(dbMocks.setSelectedDatabases).toHaveBeenCalledWith([
      "shop",
      "analytics",
    ]);
    expect(dbMocks.setActiveTable).toHaveBeenCalledWith(null, "analytics");
    expect(onClose).toHaveBeenCalled();
  });

  it("focuses an already selected database without re-adding it", async () => {
    dbMocks.state.selectedDatabases = ["shop", "analytics"];
    render(<DatabaseSwitcherModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("analytics")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("analytics"));
    expect(dbMocks.setSelectedDatabases).not.toHaveBeenCalled();
    expect(dbMocks.setActiveTable).toHaveBeenCalledWith(null, "analytics");
  });

  it("shows the error state with a retry that refetches", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Access denied for user 'x'");
    render(<DatabaseSwitcherModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(
        screen.getByText("Access denied for user 'x'"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("sidebar.retry"));
    await waitFor(() => {
      expect(screen.getByText("analytics")).toBeInTheDocument();
    });
  });
});
