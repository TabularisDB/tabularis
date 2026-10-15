import { describe, expect, it, vi } from "vitest";

import { createConnectionCommandItems } from "../../src/utils/connectionCommandItems";

describe("createConnectionCommandItems", () => {
  it("should create switch commands for other open connections", async () => {
    const switchConnection = vi.fn();
    const items = createConnectionCommandItems({
      activeConnectionId: "connection-a",
      connections: [
        {
          id: "connection-a",
          name: "Primary",
          driver: "postgres",
          database: "app",
          host: "localhost",
        },
        {
          id: "connection-b",
          name: "Analytics",
          driver: "mysql",
          database: "warehouse",
          host: "db.internal",
        },
      ],
      group: "Connection",
      switchConnection,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "connection.switch:connection-b",
      title: "Analytics",
      description: "mysql · warehouse · db.internal",
      group: "Connection",
    });

    await items[0].primaryAction.execute();
    expect(switchConnection).toHaveBeenCalledWith("connection-b");
  });

  it("should omit switch commands when no other connection is open", () => {
    const items = createConnectionCommandItems({
      activeConnectionId: "connection-a",
      connections: [
        {
          id: "connection-a",
          name: "Primary",
          driver: "postgres",
          database: "app",
        },
      ],
      group: "Connection",
      switchConnection: vi.fn(),
    });

    expect(items).toEqual([]);
  });

  it("should omit empty connection keywords", () => {
    const items = createConnectionCommandItems({
      activeConnectionId: "connection-a",
      connections: [
        {
          id: "connection-b",
          name: "Analytics",
          driver: "sqlite",
          database: "warehouse.db",
        },
      ],
      group: "Connection",
      switchConnection: vi.fn(),
    });

    expect(items[0].keywords).toEqual([
      "switch",
      "connection",
      "sqlite",
      "warehouse.db",
    ]);
  });
});
