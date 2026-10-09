import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// useSearchParams returns a getter for the test's current search string.
const mocks = vi.hoisted(() => ({
  search: "",
  invokeMock: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams(mocks.search);
    return [params];
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invokeMock,
}));

vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

vi.mock("lucide-react", () => ({
  Maximize2: () => null,
  Minimize2: () => null,
  RefreshCw: () => null,
}));

// DatabaseProvider / EditorProvider are heavy contexts the page wraps in; mock
// them as pass-through wrappers so the page renders in isolation.
vi.mock("../../src/contexts/DatabaseProvider", () => ({
  DatabaseProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../src/contexts/EditorProvider", () => ({
  EditorProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// SchemaDiagram is a canvas component; mock it to surface the props the picker
// controls (schema + refreshTrigger) so the test can assert on them.
vi.mock("../../src/components/ui/SchemaDiagram", () => ({
  SchemaDiagram: ({
    schema,
    refreshTrigger,
    database,
    connectionId,
  }: {
    schema?: string;
    refreshTrigger: number;
    database?: string;
    connectionId: string | null;
  }) => (
    <div
      data-testid="schema-diagram"
      data-schema={schema ?? ""}
      data-refresh={refreshTrigger}
      data-database={database ?? ""}
      data-connection={connectionId ?? ""}
    />
  ),
}));

import { SchemaDiagramPage } from "../../src/pages/SchemaDiagramPage";

/**
 * ER diagram schema-picker regression tests (debba review, PR #822 — requested
 * test coverage for the schema picker dropdown in SchemaDiagramPage).
 */
describe("SchemaDiagramPage schema picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = "";
  });

  it("renders the schema picker for a schema-capable connection and fetches schemas with the database override", async () => {
    // A schema-based multi-db connection carries an explicit `schema` URL param
    // AND a `database` override. The picker fetches get_schemas with the database.
    mocks.search = "connectionId=conn-1&connectionName=pg&databaseName=analytics&schema=public&database=analytics";
    mocks.invokeMock.mockResolvedValue(["public", "store", "analytics"]);

    render(<SchemaDiagramPage />);

    // The picker fetches schemas with the database override for nested multi-db.
    await waitFor(() => {
      expect(mocks.invokeMock).toHaveBeenCalledWith("get_schemas", {
        connectionId: "conn-1",
        database: "analytics",
      });
    });

    // The select renders with all fetched schemas, defaulting to the initial one.
    const select = await screen.findByRole("combobox");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "public",
      "store",
      "analytics",
    ]);
    expect(select).toHaveValue("public");
    // The picker exposes an accessible name (debba review, gap 8).
    expect(select).toHaveAttribute("aria-label", "sidebar.schemas");
  });

  it("updates the diagram's schema and triggers a refresh when the picker changes", async () => {
    mocks.search = "connectionId=conn-1&connectionName=pg&databaseName=analytics&schema=public&database=analytics";
    mocks.invokeMock.mockResolvedValue(["public", "store"]);

    render(<SchemaDiagramPage />);

    const select = await screen.findByRole("combobox");
    // Initial render passes the initial schema and refreshTrigger 0.
    const diagram = screen.getByTestId("schema-diagram");
    expect(diagram).toHaveAttribute("data-schema", "public");
    expect(diagram).toHaveAttribute("data-refresh", "0");
    expect(diagram).toHaveAttribute("data-database", "analytics");

    // Switch to a different schema.
    fireEvent.change(select, { target: { value: "store" } });

    // The diagram now receives the new schema and an incremented refresh trigger.
    await waitFor(() => {
      const d = screen.getByTestId("schema-diagram");
      expect(d).toHaveAttribute("data-schema", "store");
      expect(d).toHaveAttribute("data-refresh", "1");
    });
  });

  it("does not render the schema picker for a non-schema-capable connection (no schema param)", async () => {
    // A MySQL flat multi-db connection has no `schema` URL param — only a
    // databaseName used as the effective schema. The picker must not show.
    mocks.search = "connectionId=conn-1&connectionName=mysql&databaseName=shop";
    mocks.invokeMock.mockResolvedValue([]);

    render(<SchemaDiagramPage />);

    // No get_schemas fetch fires (isSchemaCapable is false), and no select.
    await waitFor(() => {
      expect(mocks.invokeMock).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
