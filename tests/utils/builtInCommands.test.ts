import { describe, expect, it, vi } from "vitest";

import { createBuiltInCommandItems } from "../../src/utils/builtInCommands";
import type { CommandScope } from "../../src/types/commands";

const labels = {
  openSettings: "Open settings",
  openConnections: "Open connection manager",
  newConsole: "New console",
  openTableInConsole: "Open table in console",
  inspectTable: "Inspect structure",
  generateSql: "Generate SQL templates",
  countRows: "Count rows",
  navigationCategory: "Navigation",
  connectionCategory: "Connection",
  editorCategory: "Editor",
  tableCategory: "Table",
  resultCategory: "Results",
  copySelectedCells: (count: number) => `Copy ${count} cells`,
  copySelectedRows: (count: number) => `Copy ${count} rows`,
  copySelectedColumns: (count: number) => `Copy ${count} columns`,
  copyColumnValuesAsSqlIn: "Copy column values as SQL IN",
  copyAllRows: (count?: number) => `Copy all ${count ?? "unknown"} rows`,
};

const findItem = (
  items: ReturnType<typeof createBuiltInCommandItems>,
  id: string,
) => {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing command: ${id}`);
  return item;
};

describe("createBuiltInCommandItems", () => {
  const createScope = (
    overrides: Partial<CommandScope> = {},
  ): CommandScope => ({
    connectionId: "connection-b",
    driver: "postgres",
    table: {
      connectionId: "connection-b",
      tableName: "orders",
      schema: "sales",
    },
    runtime: {
      navigate: vi.fn(),
      openEditor: vi.fn(),
    },
    ...overrides,
  });

  const modals = () => ({
    inspect: vi.fn(),
    generateSql: vi.fn(),
  });

  it("should return commands already bound to their scope", async () => {
    const scope = createScope();
    const items = createBuiltInCommandItems(scope, labels, modals());

    const consoleCommand = findItem(items, "table.open-in-console");
    expect(consoleCommand.description).toBe("orders");
    await consoleCommand.primaryAction.execute();
    expect(scope.runtime.openEditor).toHaveBeenCalledWith({
      kind: "console",
      initialQuery: 'SELECT * FROM "sales"."orders"',
      queryName: "orders",
      preventAutoRun: true,
      schema: "sales",
      targetConnectionId: "connection-b",
    });
  });

  it("should navigate to the connection manager", async () => {
    const scope = createScope();
    const items = createBuiltInCommandItems(scope, labels, modals());

    await findItem(items, "app.open-connections").primaryAction.execute();
    expect(scope.runtime.navigate).toHaveBeenCalledWith("/connections");
  });

  it("should open an empty console on the schema the user is looking at", async () => {
    const scope = createScope();
    const items = createBuiltInCommandItems(scope, labels, modals());

    await findItem(items, "connection.new-console").primaryAction.execute();
    expect(scope.runtime.openEditor).toHaveBeenCalledWith({
      kind: "console",
      initialQuery: "",
      preventAutoRun: true,
      schema: "sales",
      targetConnectionId: "connection-b",
    });
  });

  it("should count the rows of the current table", async () => {
    const scope = createScope();
    const items = createBuiltInCommandItems(scope, labels, modals());

    await findItem(items, "table.count-rows").primaryAction.execute();
    expect(scope.runtime.openEditor).toHaveBeenCalledWith({
      kind: "console",
      initialQuery: 'SELECT COUNT(*) as count FROM "sales"."orders"',
      schema: "sales",
      targetConnectionId: "connection-b",
    });
  });

  it("should hand the current table to the palette modals", async () => {
    const scope = createScope();
    const paletteModals = modals();
    const items = createBuiltInCommandItems(
      scope,
      labels,
      paletteModals,
    );

    await findItem(items, "table.inspect").primaryAction.execute();
    await findItem(items, "table.generate-sql").primaryAction.execute();

    expect(paletteModals.inspect).toHaveBeenCalledWith(scope.table);
    expect(paletteModals.generateSql).toHaveBeenCalledWith(scope.table);
  });

  it("should omit contextual commands outside their context", () => {
    const items = createBuiltInCommandItems(
      createScope({ connectionId: null, driver: null, table: null }),
      labels,
      modals(),
    );

    expect(items.map((item) => item.id)).toEqual([
      "app.open-settings",
      "app.open-connections",
    ]);
  });

  it("should offer connection commands without a table in scope", () => {
    const items = createBuiltInCommandItems(
      createScope({ table: null }),
      labels,
      modals(),
    );

    expect(items.map((item) => item.id)).toEqual([
      "app.open-settings",
      "app.open-connections",
      "connection.new-console",
    ]);
  });

  it("should add only the result actions available in the active grid", async () => {
    const copySelectedCells = vi.fn();
    const copySelectedRows = vi.fn();
    const copySelectedColumns = vi.fn();
    const copyColumnValuesAsSqlIn = vi.fn();
    const copyAllRows = vi.fn();
    const scope = createScope({
      getResultCommands: () => ({
        copySelectedCells: { count: 4, execute: copySelectedCells },
        copySelectedRows: { count: 2, execute: copySelectedRows },
        copySelectedColumns: { count: 1, execute: copySelectedColumns },
        copyColumnValuesAsSqlIn: {
          count: 2,
          columnName: "status",
          execute: copyColumnValuesAsSqlIn,
        },
        copyAllRows: { count: 12, execute: copyAllRows },
      }),
    });

    const items = createBuiltInCommandItems(scope, labels, modals());
    const resultItems = items.filter((item) => item.group === "Results");

    expect(resultItems.map((item) => [item.id, item.title])).toEqual([
      ["result.copy-selected-cells", "Copy 4 cells"],
      ["result.copy-selected-rows", "Copy 2 rows"],
      ["result.copy-selected-columns", "Copy 1 columns"],
      [
        "result.copy-column-values-as-sql-in",
        "Copy column values as SQL IN",
      ],
      ["result.copy-all-rows", "Copy all 12 rows"],
    ]);
    expect(
      findItem(items, "result.copy-column-values-as-sql-in").description,
    ).toBe("status");
    await findItem(items, "result.copy-selected-cells").primaryAction.execute();
    await findItem(items, "result.copy-selected-rows").primaryAction.execute();
    await findItem(items, "result.copy-selected-columns").primaryAction.execute();
    await findItem(items, "result.copy-column-values-as-sql-in").primaryAction.execute();
    await findItem(items, "result.copy-all-rows").primaryAction.execute();
    expect(copySelectedCells).toHaveBeenCalledOnce();
    expect(copySelectedRows).toHaveBeenCalledOnce();
    expect(copySelectedColumns).toHaveBeenCalledOnce();
    expect(copyColumnValuesAsSqlIn).toHaveBeenCalledOnce();
    expect(copyAllRows).toHaveBeenCalledOnce();
  });

  it("should resolve result actions when the palette opens", () => {
    const getResultCommands = vi.fn(() => null);
    const scope = createScope({ getResultCommands });

    createBuiltInCommandItems(scope, labels, modals());

    expect(getResultCommands).toHaveBeenCalledOnce();
  });

  it("should add only the editor actions available in the active tab", async () => {
    const run = vi.fn();
    const runAll = vi.fn();
    const saveSqlFile = vi.fn();
    const closeTab = vi.fn();
    const scope = createScope({
      getEditorCommands: () => ({
        run: { label: "Run statement", execute: run },
        runAll: { label: "Run all", execute: runAll },
        saveSqlFile: { label: "Save SQL file", execute: saveSqlFile },
        closeTab: { label: "Close tab", execute: closeTab },
      }),
    });

    const items = createBuiltInCommandItems(scope, labels, modals());
    const editorItems = items.filter((item) => item.group === "Editor");

    expect(editorItems.map((item) => [item.id, item.title])).toEqual([
      ["editor.run", "Run statement"],
      ["editor.run-all", "Run all"],
      ["editor.save-sql-file", "Save SQL file"],
      ["tab.close-active", "Close tab"],
    ]);

    for (const item of editorItems) {
      await item.primaryAction.execute();
    }
    expect(run).toHaveBeenCalledOnce();
    expect(runAll).toHaveBeenCalledOnce();
    expect(saveSqlFile).toHaveBeenCalledOnce();
    expect(closeTab).toHaveBeenCalledOnce();
  });
});
