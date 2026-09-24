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
  tableCategory: "Table",
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
});
