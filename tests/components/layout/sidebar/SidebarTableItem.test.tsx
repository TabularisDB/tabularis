import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SidebarTableItem } from "../../../../src/components/layout/sidebar/SidebarTableItem";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));

describe("SidebarTableItem", () => {
  const defaultProps = {
    table: { name: "products" },
    activeTable: null,
    onTableClick: vi.fn(),
    onTableDoubleClick: vi.fn(),
    onContextMenu: vi.fn(),
    connectionId: "conn-123",
    driver: "postgresql",
    onAddColumn: vi.fn(),
    onEditColumn: vi.fn(),
    onAddIndex: vi.fn(),
    onDropIndex: vi.fn(),
    onAddForeignKey: vi.fn(),
    onDropForeignKey: vi.fn(),
    schemaVersion: 1,
    schema: "store",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(invoke).mockImplementation(() => Promise.resolve([]));
  });

  const expandTable = () => {
    fireEvent.click(screen.getByRole("button", { name: "sidebar.expandTable" }));
  };

  it(
    "regression: passes the database prop through to get_columns/get_foreign_keys/get_indexes " +
      "when browsing a non-primary database in the nested multi-db tree",
    async () => {
      render(<SidebarTableItem {...defaultProps} database="tabularis_pr822_demo" />);

      expandTable();

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("get_columns", {
          connectionId: "conn-123",
          tableName: "products",
          schema: "store",
          database: "tabularis_pr822_demo",
        });
        expect(invoke).toHaveBeenCalledWith("get_foreign_keys", {
          connectionId: "conn-123",
          tableName: "products",
          schema: "store",
          database: "tabularis_pr822_demo",
        });
        expect(invoke).toHaveBeenCalledWith("get_indexes", {
          connectionId: "conn-123",
          tableName: "products",
          schema: "store",
          database: "tabularis_pr822_demo",
        });
      });
    },
  );

  it("omits database from the invoke calls for a primary/single-database connection", async () => {
    render(<SidebarTableItem {...defaultProps} />);

    expandTable();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_columns", {
        connectionId: "conn-123",
        tableName: "products",
        schema: "store",
      });
    });

    // None of the calls should carry a `database` key at all when the prop is absent.
    for (const call of vi.mocked(invoke).mock.calls) {
      expect(call[1]).not.toHaveProperty("database");
    }
  });

  it("re-fetches metadata when the database prop changes for the same table", async () => {
    const { rerender } = render(<SidebarTableItem {...defaultProps} database="db_one" />);

    expandTable();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "get_columns",
        expect.objectContaining({ database: "db_one" }),
      );
    });

    vi.mocked(invoke).mockClear();
    rerender(<SidebarTableItem {...defaultProps} database="db_two" />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "get_columns",
        expect.objectContaining({ database: "db_two" }),
      );
    });
  });
});
