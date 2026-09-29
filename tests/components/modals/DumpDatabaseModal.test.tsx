import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DumpDatabaseModal } from "../../../src/components/modals/DumpDatabaseModal";
import { useDatabase } from "../../../src/hooks/useDatabase";

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: vi.fn(),
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: vi.fn() }),
}));

function mockUseDatabase(overrides: Partial<ReturnType<typeof useDatabase>>) {
  vi.mocked(useDatabase).mockReturnValue({
    activeSchema: null,
    activeCapabilities: null,
    databaseDataMap: {},
    nestedDatabaseDataMap: {},
    refreshDatabaseData: vi.fn(),
    refreshNestedSchemaData: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useDatabase>);
}

describe("DumpDatabaseModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the nested schema's table list on open for a schema-based (nested multi-db) dump", () => {
    const refreshNestedSchemaData = vi.fn();
    const refreshDatabaseData = vi.fn();
    mockUseDatabase({
      activeCapabilities: { schemas: true },
      nestedDatabaseDataMap: {
        analytics: {
          schemas: ["public"],
          schemasLoaded: true,
          isLoadingSchemas: false,
          selectedSchemas: ["public"],
          activeSchema: "public",
          needsSchemaSelection: false,
          schemaDataMap: {},
        },
      },
      refreshDatabaseData,
      refreshNestedSchemaData,
    });

    render(
      <DumpDatabaseModal
        isOpen
        onClose={vi.fn()}
        connectionId="conn-1"
        databaseName="analytics"
        tables={[]}
        schema="public"
        database="analytics"
      />,
    );

    expect(refreshNestedSchemaData).toHaveBeenCalledWith(
      "analytics",
      "public",
      "conn-1",
    );
    expect(refreshDatabaseData).not.toHaveBeenCalled();
  });

  it("refreshes the flat multi-db database's table list on open, not the nested loader", () => {
    const refreshNestedSchemaData = vi.fn();
    const refreshDatabaseData = vi.fn();
    mockUseDatabase({
      activeCapabilities: {
        schemas: false,
        file_based: false,
        folder_based: false,
      },
      databaseDataMap: {},
      refreshDatabaseData,
      refreshNestedSchemaData,
    });

    render(
      <DumpDatabaseModal
        isOpen
        onClose={vi.fn()}
        connectionId="conn-1"
        databaseName="sales_db"
        tables={[]}
      />,
    );

    expect(refreshDatabaseData).toHaveBeenCalledWith("sales_db");
    expect(refreshNestedSchemaData).not.toHaveBeenCalled();
  });
});
