import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCommandPaletteObjectItems } from "../../src/hooks/useCommandPaletteObjectItems";
import { useActiveCommandPaletteScope } from "../../src/hooks/useCommandPaletteScope";
import { useDatabase } from "../../src/hooks/useDatabase";
import { useDatabaseObjectActionRuntime } from "../../src/hooks/useDatabaseObjectActionRuntime";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../src/hooks/useCommandPaletteScope", () => ({
  useActiveCommandPaletteScope: vi.fn(),
}));

vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: vi.fn(),
}));

vi.mock("../../src/hooks/useDatabaseObjectActionRuntime", () => ({
  useDatabaseObjectActionRuntime: vi.fn(),
}));

describe("useCommandPaletteObjectItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useActiveCommandPaletteScope).mockReturnValue({
      connectionId: "connection-1",
      driver: "postgres",
      table: null,
      runtime: {
        navigate: vi.fn(),
        openEditor: vi.fn(),
      },
    });
    vi.mocked(useDatabaseObjectActionRuntime).mockReturnValue({
      navigateToEditor: vi.fn(),
      loadRoutineDefinition: vi.fn(),
      loadTriggerDefinition: vi.fn(),
      showDefinitionError: vi.fn(),
    });
  });

  it("should ignore loader identity changes but retry after schema state changes", () => {
    const schemas = ["public"];
    let schemaDataMap = {
      public: {
        tables: [],
        views: [],
        routines: [],
        triggers: [],
        isLoading: false,
        isLoaded: false,
      },
    };
    const databaseDataMap = {};
    let loadSchemaData = vi.fn();
    vi.mocked(useDatabase).mockImplementation(
      () => {
        const connectionData = {
          driver: "postgres",
          capabilities: { schemas: true },
          schemas,
          schemaDataMap,
          databaseDataMap,
          tables: [],
          views: [],
          routines: [],
          triggers: [],
          activeSchema: "public",
        };

        return {
          activeConnectionId: "connection-1",
          connectionDataMap: { "connection-1": connectionData },
          connections: [
            {
              id: "connection-1",
              params: { database: "app" },
            },
          ],
          loadDatabaseData: vi.fn(),
          loadSchemaData,
          setActiveTable: vi.fn(),
        } as unknown as ReturnType<typeof useDatabase>;
      },
    );

    const { rerender, result } = renderHook(() =>
      useCommandPaletteObjectItems(vi.fn(), vi.fn()),
    );
    expect(loadSchemaData).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();

    const replacementLoadSchemaData = vi.fn();
    loadSchemaData = replacementLoadSchemaData;
    rerender();

    expect(replacementLoadSchemaData).not.toHaveBeenCalled();

    schemaDataMap = {
      public: {
        ...schemaDataMap.public,
        isLoading: false,
        isLoaded: false,
      },
    };
    rerender();

    expect(replacementLoadSchemaData).toHaveBeenCalledOnce();
    expect(replacementLoadSchemaData).toHaveBeenCalledWith(
      "public",
      "connection-1",
    );

    schemaDataMap = {
      public: {
        ...schemaDataMap.public,
        isLoading: false,
        isLoaded: false,
      },
    };
    rerender();

    expect(replacementLoadSchemaData).toHaveBeenCalledOnce();
  });

  it("should report the schemas it gave up on instead of dropping them silently", () => {
    const failingSchema = {
      tables: [],
      views: [],
      routines: [],
      triggers: [],
      isLoading: false,
      isLoaded: false,
    };
    vi.mocked(useDatabase).mockImplementation(
      () =>
        ({
          activeConnectionId: "connection-1",
          connectionDataMap: {
            "connection-1": {
              driver: "postgres",
              capabilities: { schemas: true },
              schemas: ["billing"],
              // A failed load resets the entry to neither loading nor loaded.
              schemaDataMap: { billing: { ...failingSchema } },
              databaseDataMap: {},
              tables: [],
              views: [],
              routines: [],
              triggers: [],
              activeSchema: "billing",
            },
          },
          connections: [
            { id: "connection-1", params: { database: "app" } },
          ],
          loadDatabaseData: vi.fn(),
          loadSchemaData: vi.fn(),
          setActiveTable: vi.fn(),
        }) as unknown as ReturnType<typeof useDatabase>,
    );

    const { rerender, result } = renderHook(() =>
      useCommandPaletteObjectItems(vi.fn(), vi.fn()),
    );

    // Every render hands the effect a fresh map identity, the way a failing
    // load does, until the attempt cap trips.
    rerender();
    rerender();
    rerender();

    expect(result.current.error).toBe("commandPalette.objectsLoadError");
    expect(result.current.items).toEqual([]);
  });

  it("should drop the failure once the schema loads after all", () => {
    let schemaDataMap: Record<string, unknown> = {
      billing: {
        tables: [],
        views: [],
        routines: [],
        triggers: [],
        isLoading: false,
        isLoaded: false,
      },
    };
    vi.mocked(useDatabase).mockImplementation(
      () =>
        ({
          activeConnectionId: "connection-1",
          connectionDataMap: {
            "connection-1": {
              driver: "postgres",
              capabilities: { schemas: true },
              schemas: ["billing"],
              schemaDataMap,
              databaseDataMap: {},
              tables: [],
              views: [],
              routines: [],
              triggers: [],
              activeSchema: "billing",
            },
          },
          connections: [
            { id: "connection-1", params: { database: "app" } },
          ],
          loadDatabaseData: vi.fn(),
          loadSchemaData: vi.fn(),
          setActiveTable: vi.fn(),
        }) as unknown as ReturnType<typeof useDatabase>,
    );

    const { rerender, result } = renderHook(() =>
      useCommandPaletteObjectItems(vi.fn(), vi.fn()),
    );

    rerender();
    rerender();
    rerender();
    expect(result.current.error).toBe("commandPalette.objectsLoadError");

    // Something outside the palette — a reconnect, an in-flight load — lands
    // the schema the palette already gave up on.
    schemaDataMap = {
      billing: {
        tables: [{ name: "invoices" }],
        views: [],
        routines: [],
        triggers: [],
        isLoading: false,
        isLoaded: true,
      },
    };
    rerender();

    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });
});
