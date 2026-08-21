import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import {
  createDefinitionRequest,
  createQueryableObjectRequests,
  createTableCountRequest,
  createTableConsoleRequest,
  loadRoutineDefinition,
  loadTriggerDefinition,
  openObjectDefinition,
  type DatabaseObjectActionRuntime,
} from "../../src/utils/databaseObjectActions";

function createActionRuntime(): DatabaseObjectActionRuntime {
  return {
    navigateToEditor: vi.fn(),
    loadRoutineDefinition: vi.fn(),
    loadTriggerDefinition: vi.fn(),
    showDefinitionError: vi.fn(),
  };
}

describe("openObjectDefinition", () => {
  it("should own routine definition loading, navigation, and error semantics", async () => {
    const runtime = createActionRuntime();
    vi.mocked(runtime.loadRoutineDefinition).mockResolvedValueOnce(
      "CREATE FUNCTION refresh_orders",
    );
    const object = {
      type: "routine" as const,
      connectionId: "connection-b",
      name: "refresh_orders",
      schema: "sales",
      routineType: "FUNCTION",
    };

    await openObjectDefinition(object, runtime);

    expect(runtime.loadRoutineDefinition).toHaveBeenCalledWith({
      connectionId: "connection-b",
      routineName: "refresh_orders",
      routineType: "FUNCTION",
      schema: "sales",
    });
    expect(runtime.navigateToEditor).toHaveBeenCalledWith({
      kind: "definition",
      initialQuery: "CREATE FUNCTION refresh_orders",
      queryName: "refresh_orders Definition",
      schema: "sales",
      targetConnectionId: "connection-b",
    });

    const error = new Error("definition unavailable");
    vi.mocked(runtime.loadRoutineDefinition).mockRejectedValueOnce(
      error,
    );
    await openObjectDefinition(object, runtime);
    expect(runtime.showDefinitionError).toHaveBeenCalledWith(
      "routine",
      error,
    );
  });

  it("should open trigger definitions as read-only through the same pipeline", async () => {
    const runtime = createActionRuntime();
    vi.mocked(runtime.loadTriggerDefinition).mockResolvedValue(
      "CREATE TRIGGER audit_orders",
    );

    await openObjectDefinition(
      {
        type: "trigger",
        connectionId: "connection-b",
        name: "audit_orders",
        tableName: "orders",
        schema: "sales",
      },
      runtime,
    );

    expect(runtime.loadTriggerDefinition).toHaveBeenCalledWith({
      connectionId: "connection-b",
      triggerName: "audit_orders",
      tableName: "orders",
      schema: "sales",
    });
    expect(runtime.navigateToEditor).toHaveBeenCalledWith({
      kind: "definition",
      initialQuery: "CREATE TRIGGER audit_orders",
      queryName: "audit_orders Definition",
      readOnly: true,
      schema: "sales",
      targetConnectionId: "connection-b",
    });
  });
});

describe("createQueryableObjectRequests", () => {
  it("should create open and count requests for the same scoped object", () => {
    const requests = createQueryableObjectRequests({
      connectionId: "connection-b",
      driver: "postgres",
      objectName: "orders",
      schema: "sales",
    });

    expect(requests.open).toEqual({
      kind: "table",
      initialQuery: 'SELECT * FROM "sales"."orders"',
      tableName: "orders",
      schema: "sales",
      targetConnectionId: "connection-b",
    });
    expect(requests.count).toEqual({
      kind: "console",
      initialQuery:
        'SELECT COUNT(*) as count FROM "sales"."orders"',
      schema: "sales",
      targetConnectionId: "connection-b",
    });
  });

  it("should omit the database prefix from SQL for multi-database drivers", () => {
    const requests = createQueryableObjectRequests({
      connectionId: "connection-b",
      driver: "clickhouse",
      objectName: "events",
      schema: "analytics",
      qualifySchema: false,
      title: "events (analytics)",
    });

    expect(requests.open.initialQuery).toBe(
      'SELECT * FROM "events"',
    );
    expect(requests.count.initialQuery).toBe(
      'SELECT COUNT(*) as count FROM "events"',
    );
    expect(requests.open.title).toBe("events (analytics)");
    expect(requests.open.schema).toBe("analytics");
    expect(requests.count.schema).toBe("analytics");
  });
});

describe("createTableCountRequest", () => {
  it("should create only the count request for a scoped table", () => {
    expect(
      createTableCountRequest(
        {
          connectionId: "connection-b",
          objectName: "orders",
          schema: "sales",
        },
        "postgres",
      ),
    ).toEqual({
      kind: "console",
      initialQuery: 'SELECT COUNT(*) as count FROM "sales"."orders"',
      schema: "sales",
      targetConnectionId: "connection-b",
    });
  });
});

describe("createTableConsoleRequest", () => {
  it("should preserve the connection and schema", () => {
    expect(
      createTableConsoleRequest(
        {
          connectionId: "connection-b",
          objectName: "orders",
          schema: "sales",
        },
        "postgres",
      ),
    ).toEqual({
      kind: "console",
      initialQuery: 'SELECT * FROM "sales"."orders"',
      queryName: "orders",
      preventAutoRun: true,
      schema: "sales",
      targetConnectionId: "connection-b",
    });
  });
});

describe("definition actions", () => {
  it("should load routine and trigger definitions with complete targets", async () => {
    const invokeCommand = vi.mocked(invoke);
    invokeCommand
      .mockReset()
      .mockResolvedValueOnce("routine sql")
      .mockResolvedValueOnce("trigger sql");

    await expect(
      loadRoutineDefinition({
        connectionId: "connection-b",
        routineName: "refresh_orders",
        routineType: "FUNCTION",
        schema: "sales",
      }),
    ).resolves.toBe("routine sql");
    await expect(
      loadTriggerDefinition({
        connectionId: "connection-b",
        triggerName: "audit_orders",
        tableName: "orders",
        schema: "sales",
      }),
    ).resolves.toBe("trigger sql");

    expect(invokeCommand).toHaveBeenNthCalledWith(
      1,
      "get_routine_definition",
      {
        connectionId: "connection-b",
        routineName: "refresh_orders",
        routineType: "FUNCTION",
        schema: "sales",
      },
    );
    expect(invokeCommand).toHaveBeenNthCalledWith(
      2,
      "get_trigger_definition",
      {
        connectionId: "connection-b",
        triggerName: "audit_orders",
        tableName: "orders",
        schema: "sales",
      },
    );
  });

  it("should create a typed definition navigation request", () => {
    expect(
      createDefinitionRequest({
        connectionId: "connection-b",
        definition: "CREATE FUNCTION refresh_orders",
        queryName: "refresh_orders Definition",
        readOnly: true,
        schema: "sales",
      }),
    ).toEqual({
      kind: "definition",
      initialQuery: "CREATE FUNCTION refresh_orders",
      queryName: "refresh_orders Definition",
      readOnly: true,
      schema: "sales",
      targetConnectionId: "connection-b",
    });
  });
});
