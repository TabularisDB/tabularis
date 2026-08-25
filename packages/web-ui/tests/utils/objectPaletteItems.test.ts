import { describe, expect, it, vi } from "vitest";

import {
  createObjectPaletteItems,
  type ObjectPaletteRuntime,
} from "../../src/utils/objectPaletteItems";
import type { NavigatorItem } from "../../src/utils/quickNavigator";

const labels = {
  inspect: "Inspect",
  newConsole: "New console",
  generateSql: "Generate SQL",
  countRows: "Count rows",
  query: "Query",
  copyName: "Copy name",
  type: {
    table: "Table",
    view: "View",
    routine: "Routine",
    trigger: "Trigger",
  },
};

function createRuntime(): ObjectPaletteRuntime {
  return {
    navigateToEditor: vi.fn(),
    inspect: vi.fn(),
    generateSql: vi.fn(),
    loadRoutineDefinition: vi.fn(),
    loadTriggerDefinition: vi.fn(),
    showDefinitionError: vi.fn(),
    copyText: vi.fn(),
    setActiveTable: vi.fn(),
  };
}

describe("createObjectPaletteItems", () => {
  it("should bind table actions to the complete target", async () => {
    const runtime = createRuntime();
    const navigatorItems: NavigatorItem[] = [
      {
        type: "table",
        name: "orders",
        schema: "sales",
        item: { name: "orders" },
      },
    ];

    const [item] = createObjectPaletteItems({
      navigatorItems,
      connectionId: "connection-b",
      driver: "postgres",
      hasGroups: true,
      isMultiDatabase: false,
      labels,
      runtime,
    });

    await item.primaryAction.execute();
    await item.actions?.find(
      (action) => action.id === "inspect",
    )?.execute();
    await item.actions?.find(
      (action) => action.id === "generate-sql",
    )?.execute();

    const target = {
      connectionId: "connection-b",
      tableName: "orders",
      schema: "sales",
    };
    expect(item.actions?.map((action) => action.id)).toEqual([
      "inspect",
      "new-console",
      "generate-sql",
      "count",
      "open",
      "copy",
    ]);
    expect(runtime.inspect).toHaveBeenCalledWith(target);
    expect(runtime.generateSql).toHaveBeenCalledWith(target);
    expect(runtime.setActiveTable).toHaveBeenCalledWith(
      "orders",
      "sales",
    );
    expect(runtime.navigateToEditor).toHaveBeenCalledWith({
      kind: "table",
      initialQuery: 'SELECT * FROM "sales"."orders"',
      tableName: "orders",
      schema: "sales",
      targetConnectionId: "connection-b",
      title: undefined,
    });
  });

  it("should use the discriminated routine payload without casting", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.loadRoutineDefinition).mockResolvedValue(
      "CREATE FUNCTION refresh_orders",
    );
    const navigatorItems: NavigatorItem[] = [
      {
        type: "routine",
        name: "refresh_orders",
        schema: "sales",
        detail: "FUNCTION",
        item: {
          name: "refresh_orders",
          routine_type: "FUNCTION",
        },
      },
    ];

    const [item] = createObjectPaletteItems({
      navigatorItems,
      connectionId: "connection-b",
      driver: "postgres",
      hasGroups: true,
      isMultiDatabase: false,
      labels,
      runtime,
    });

    await item.primaryAction.execute();

    expect(runtime.loadRoutineDefinition).toHaveBeenCalledWith({
      connectionId: "connection-b",
      routineName: "refresh_orders",
      routineType: "FUNCTION",
      schema: "sales",
    });
    expect(runtime.setActiveTable).not.toHaveBeenCalled();
  });

  it("should not select the explorer table when opening a view", async () => {
    const runtime = createRuntime();
    const navigatorItems: NavigatorItem[] = [
      {
        type: "view",
        name: "active_orders",
        schema: "sales",
        item: { name: "active_orders" },
      },
    ];

    const [item] = createObjectPaletteItems({
      navigatorItems,
      connectionId: "connection-b",
      driver: "postgres",
      hasGroups: true,
      isMultiDatabase: false,
      labels,
      runtime,
    });

    await item.primaryAction.execute();

    expect(runtime.navigateToEditor).toHaveBeenCalled();
    expect(runtime.setActiveTable).not.toHaveBeenCalled();
  });
});
