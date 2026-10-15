import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarNestedDatabaseItem } from "../../../../src/components/layout/sidebar/SidebarNestedDatabaseItem";
import type { NestedDatabaseData } from "../../../../src/contexts/DatabaseContext";

// The global lucide-react mock (tests/setup.ts) doesn't stub Settings2 (the
// edit-schemas gear icon), so use the real icon set for this file.
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseProps = {
  databaseName: "tabularis_pr822_demo",
  activeTable: null,
  connectionId: "conn-1",
  driver: "postgresql",
  schemaVersion: 1,
  onLoadSchemas: vi.fn(),
  onLoadSchemaData: vi.fn(),
  onRefreshSchemaData: vi.fn(),
  onTableClick: vi.fn(),
  onTableDoubleClick: vi.fn(),
  onViewClick: vi.fn(),
  onViewDoubleClick: vi.fn(),
  onRoutineDoubleClick: vi.fn(),
  onTriggerDoubleClick: vi.fn(),
  onContextMenu: vi.fn(),
  onAddColumn: vi.fn(),
  onEditColumn: vi.fn(),
  onAddIndex: vi.fn(),
  onDropIndex: vi.fn(),
  onAddForeignKey: vi.fn(),
  onDropForeignKey: vi.fn(),
  onCreateTable: vi.fn(),
  onCreateView: vi.fn(),
  onCreateTrigger: vi.fn(),
  onNewConsole: vi.fn(),
};

const confirmedNestedData: NestedDatabaseData = {
  schemas: ["public", "internal"],
  schemasLoaded: true,
  isLoadingSchemas: false,
  selectedSchemas: ["public"],
  activeSchema: "public",
  needsSchemaSelection: false,
  schemaDataMap: {},
};

describe("SidebarNestedDatabaseItem", () => {
  it("shows a gear icon to edit an already-confirmed schema selection, not just the first-time picker", async () => {
    const onSetSelectedSchemas = vi.fn();

    render(
      <SidebarNestedDatabaseItem
        {...baseProps}
        nestedData={confirmedNestedData}
        onSetSelectedSchemas={onSetSelectedSchemas}
      />,
    );

    // Expand the database row.
    fireEvent.click(screen.getByText("tabularis_pr822_demo"));

    // The header shows the current selection count and an "Edit Schemas" gear.
    expect(await screen.findByText("sidebar.schemas (1/2)")).toBeInTheDocument();
    const editButton = screen.getByTitle("sidebar.editSchemas");

    // Open the edit dropdown, add the second schema, and confirm.
    fireEvent.click(editButton);
    fireEvent.click(screen.getByText("internal"));
    fireEvent.click(screen.getByText("sidebar.confirmSelection"));

    await waitFor(() => {
      expect(onSetSelectedSchemas).toHaveBeenCalledWith("tabularis_pr822_demo", ["public", "internal"]);
    });
  });

  it("does not show the edit gear while the first-time schema picker is showing", () => {
    render(
      <SidebarNestedDatabaseItem
        {...baseProps}
        nestedData={{
          schemas: ["public", "internal"],
          schemasLoaded: true,
          isLoadingSchemas: false,
          selectedSchemas: [],
          activeSchema: null,
          needsSchemaSelection: true,
          schemaDataMap: {},
        }}
        onSetSelectedSchemas={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("tabularis_pr822_demo"));

    expect(screen.queryByTitle("sidebar.editSchemas")).not.toBeInTheDocument();
    expect(screen.getByText("sidebar.selectSchemasHint")).toBeInTheDocument();
  });

  it(
    "opens a new console scoped to the schema and database via the schema row's console button " +
      "(the nested tree otherwise has no way to open one against an empty database with no " +
      "existing table/routine to right-click)",
    () => {
      const onNewConsole = vi.fn();

      render(
        <SidebarNestedDatabaseItem
          {...baseProps}
          nestedData={confirmedNestedData}
          onSetSelectedSchemas={vi.fn()}
          onNewConsole={onNewConsole}
        />,
      );

      // Expand the database. The "public" schema row is already expanded
      // by default (confirmedNestedData.activeSchema === "public").
      fireEvent.click(screen.getByText("tabularis_pr822_demo"));

      fireEvent.click(screen.getByTitle("sidebar.newConsole"));

      expect(onNewConsole).toHaveBeenCalledWith("public", "tabularis_pr822_demo");
    },
  );

  it(
    "opens an ER diagram scoped to the database (and its active schema) via the database row's " +
      "own action icon (the nested tree has no context menu on the database/schema row to reach " +
      "this any other way, and the connection-level header button it replaces read the wrong, " +
      "top-level schema/database state — see ExplorerSidebar's isNestedMultiDb)",
    () => {
      const onViewERDiagram = vi.fn();

      render(
        <SidebarNestedDatabaseItem
          {...baseProps}
          nestedData={confirmedNestedData}
          onSetSelectedSchemas={vi.fn()}
          onViewERDiagram={onViewERDiagram}
        />,
      );

      fireEvent.click(screen.getByText("tabularis_pr822_demo"));
      fireEvent.click(screen.getByTitle("sidebar.viewERDiagram"));

      expect(onViewERDiagram).toHaveBeenCalledWith("tabularis_pr822_demo", "public");
    },
  );
});
