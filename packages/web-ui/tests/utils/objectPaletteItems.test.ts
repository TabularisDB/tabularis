import { describe, expect, it, vi } from "vitest";

import {
  createObjectPaletteItems,
  OBJECT_TYPE_RELEVANCE,
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
  it("should collapse overloaded routines but keep distinct triggers apart", () => {
    const navigatorItems: NavigatorItem[] = [
      {
        type: "routine",
        name: "approx_percentile",
        schema: "public",
        item: { name: "approx_percentile", routine_type: "FUNCTION" },
      },
      {
        type: "routine",
        name: "approx_percentile",
        schema: "public",
        item: { name: "approx_percentile", routine_type: "FUNCTION" },
      },
      {
        type: "routine",
        name: "approx_percentile",
        schema: "public",
        item: { name: "approx_percentile", routine_type: "PROCEDURE" },
      },
      {
        type: "trigger",
        name: "set_updated_at",
        schema: "public",
        item: {
          name: "set_updated_at",
          table_name: "users",
          event: "UPDATE",
          timing: "BEFORE",
        },
      },
      {
        type: "trigger",
        name: "set_updated_at",
        schema: "public",
        item: {
          name: "set_updated_at",
          table_name: "orders",
          event: "UPDATE",
          timing: "BEFORE",
        },
      },
    ];

    const items = createObjectPaletteItems({
      navigatorItems,
      connectionId: "connection-a",
      driver: "postgres",
      hasGroups: true,
      isMultiDatabase: false,
      labels,
      runtime: createRuntime(),
    });

    expect(items.map((item) => item.title)).toEqual([
      "approx_percentile",
      "approx_percentile",
      "set_updated_at",
      "set_updated_at",
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
  });

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

  it("should rank tables above views and views above routines and triggers", () => {
    const navigatorItems: NavigatorItem[] = [
      {
        type: "routine",
        name: "fn",
        schema: "public",
        item: { name: "fn", routine_type: "FUNCTION" },
      },
      {
        type: "trigger",
        name: "trg",
        schema: "public",
        item: {
          name: "trg",
          table_name: "orders",
          event: "INSERT",
          timing: "AFTER",
        },
      },
      {
        type: "view",
        name: "v",
        schema: "public",
        item: { name: "v" },
      },
      {
        type: "table",
        name: "t",
        schema: "public",
        item: { name: "t" },
      },
    ];

    const relevance = Object.fromEntries(
      createObjectPaletteItems({
        navigatorItems,
        connectionId: "connection-a",
        driver: "postgres",
        hasGroups: true,
        isMultiDatabase: false,
        labels,
        runtime: createRuntime(),
      }).map((item) => [item.icon, item.relevance]),
    );

    expect(relevance).toEqual(OBJECT_TYPE_RELEVANCE);
    expect(relevance.table).toBeGreaterThan(relevance.view);
    expect(relevance.view).toBeGreaterThan(relevance.routine);
    expect(relevance.view).toBeGreaterThan(relevance.trigger);
  });
});
