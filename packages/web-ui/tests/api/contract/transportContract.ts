import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TabularisTransport } from "../../../src/api/client";

const QUERY_RESULT = {
  columns: ["value"],
  rows: [[1]],
  affected_rows: 0,
  truncated: false,
  pagination: {
    page: 1,
    page_size: 100,
    total_rows: null,
    has_more: false,
  },
};

const SESSION = {
  apiVersion: "v1",
  serverVersion: "contract-fixture",
  authenticated: true,
  csrfToken: "contract-csrf-token",
  capabilities: {
    rpc: true,
    events: false,
    uploads: false,
    downloads: false,
    pluginAssets: false,
  },
  queryResponsePolicy: {
    maxRowsPerPage: 10_000,
    maxResponseBytes: 16_777_216,
    streaming: false,
  },
};

interface TransportContractHarness {
  readonly transport: TabularisTransport;
  readonly close?: () => Promise<void> | void;
}

interface LiveWebContractServer {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

type CreateTransportContractHarness =
  () => Promise<TransportContractHarness> | TransportContractHarness;

export function defineTransportContractSuite(
  adapterName: string,
  serializationFixture: unknown,
  createHarness: CreateTransportContractHarness,
): void {
  describe(`${adapterName} transport contract`, () => {
    let harness: TransportContractHarness;

    beforeAll(async () => {
      harness = await createHarness();
    });

    afterAll(async () => {
      await harness.close?.();
    });

    it("preserves typed requests and responses", async () => {
      await expect(
        harness.transport.call("is_debug_mode", undefined, {
          requestId: "contract-debug-request",
        }),
      ).resolves.toBe(true);
    });

    it("preserves connection and tunnel profile contracts", async () => {
      await expect(
        harness.transport.call("get_connections_with_groups", undefined),
      ).resolves.toEqual({ groups: [], connections: [] });
      await expect(
        harness.transport.call("get_ssh_connections", undefined),
      ).resolves.toEqual([]);
      await expect(
        harness.transport.call("get_k8s_connections", undefined),
      ).resolves.toEqual([]);
    });

    it("preserves metadata explorer contracts", async () => {
      await expect(
        harness.transport.call("get_tables", {
          connectionId: "metadata-fixture",
          schema: "public",
        }),
      ).resolves.toEqual([{ name: "users", schema: "public" }]);
      await expect(
        harness.transport.call("get_columns", {
          connectionId: "metadata-fixture",
          tableName: "users",
          schema: "public",
        }),
      ).resolves.toEqual([
        {
          name: "id",
          data_type: "integer",
          is_pk: true,
          is_nullable: false,
          is_auto_increment: true,
        },
      ]);
      await expect(
        harness.transport.call("get_selected_schemas", {
          connectionId: "metadata-fixture",
        }),
      ).resolves.toEqual(["public"]);
    });

    it("preserves database object and user-management contracts", async () => {
      await expect(
        harness.transport.call("get_view_definition", {
          connectionId: "object-fixture",
          viewName: "active_users",
          schema: "public",
        }),
      ).resolves.toBe("SELECT id FROM users WHERE active = 1");
      await expect(
        harness.transport.call("get_routine_parameters", {
          connectionId: "object-fixture",
          routineName: "refresh_users",
          schema: "public",
        }),
      ).resolves.toEqual([
        {
          name: "batch_size",
          data_type: "integer",
          mode: "IN",
          ordinal_position: 1,
        },
      ]);
      await expect(
        harness.transport.call("get_trigger_definition", {
          connectionId: "object-fixture",
          triggerName: "audit_users",
          tableName: "users",
          schema: "public",
        }),
      ).resolves.toBe("CREATE TRIGGER audit_users AFTER UPDATE ON users");
      await expect(
        harness.transport.call("get_create_index_sql", {
          connectionId: "object-fixture",
          table: "users",
          indexName: "idx_users_email",
          columns: ["email"],
          isUnique: true,
          schema: "public",
        }),
      ).resolves.toEqual([
        'CREATE UNIQUE INDEX "idx_users_email" ON "public"."users" ("email")',
      ]);
      await expect(
        harness.transport.call("get_db_users", {
          connectionId: "object-fixture",
        }),
      ).resolves.toEqual([{ user: "app", host: "%", locked: false }]);
      await expect(
        harness.transport.call("apply_db_user_privileges", {
          connectionId: "object-fixture",
          user: "app",
          host: "%",
          database: "app_db",
          table: null,
          privileges: ["SELECT"],
          grant: true,
        }),
      ).resolves.toBeNull();
    });

    it("preserves query execution contracts and request-scoped cancellation", async () => {
      await expect(
        harness.transport.call(
          "execute_query",
          {
            connectionId: "query-fixture",
            query: "SELECT 1 AS value",
            limit: 100,
            page: 1,
          },
          { requestId: "query-request-1", cancellationId: "query-request-1" },
        ),
      ).resolves.toEqual(QUERY_RESULT);
      await expect(
        harness.transport.call("execute_query_batch", {
          connectionId: "query-fixture",
          queries: ["SELECT 1 AS value"],
          limit: 100,
          page: 1,
          batchId: "batch-contract-1",
        }),
      ).resolves.toEqual([
        { result: QUERY_RESULT, error: null, execution_time_ms: 1 },
      ]);
      await expect(
        harness.transport.call("count_query", {
          connectionId: "query-fixture",
          query: "SELECT 1 AS value",
        }),
      ).resolves.toBe(1);
      await expect(
        harness.transport.call("get_server_now", {
          connectionId: "query-fixture",
        }),
      ).resolves.toBe("2026-08-22 00:00:00");
      await expect(
        harness.transport.call("explain_query_plan", {
          connectionId: "query-fixture",
          query: "SELECT 1 AS value",
          analyze: false,
        }),
      ).resolves.toEqual({
        kind: "raw",
        raw: {
          engine: "sqlite",
          format: "sqlite-eqp-rows",
          payload: "[]",
          original_query: "SELECT 1 AS value",
        },
      });
      await expect(
        harness.transport.call("cancel_query", {
          connectionId: "query-fixture",
          queryRequestId: "query-request-1",
        }),
      ).resolves.toBeNull();
    });

    it("preserves data editing and blob contracts", async () => {
      const locator = {
        connectionId: "record-fixture",
        table: "files",
        database: "main",
        schema: "public",
      };
      await expect(
        harness.transport.call("insert_record", {
          ...locator,
          data: { id: 1, name: "before", payload: null },
        }),
      ).resolves.toBe(1);
      await expect(
        harness.transport.call("update_record", {
          ...locator,
          pkMap: { id: 1 },
          colName: "name",
          newVal: "after",
        }),
      ).resolves.toBe(1);
      await expect(
        harness.transport.call("fetch_blob", {
          ...locator,
          pkMap: { id: 1 },
          colName: "payload",
        }),
      ).resolves.toEqual({
        kind: "inline",
        wireValue: "BLOB:4:application/octet-stream:AAECAw==",
      });
      await expect(
        harness.transport.call("delete_record", {
          ...locator,
          pkMap: { id: 1 },
        }),
      ).resolves.toBe(1);
    });

    it("preserves complex JSON serialization without coercion", async () => {
      const result = await harness.transport.callUnmigrated(
        "contract_serialization_fixture",
        { fixture: "complex-query-result" },
        {
          task: "WEB-043",
          callSite:
            "packages/web-ui/tests/api/contract/transportContract.ts:58",
          reason: "Test-only command for transport serialization parity",
        },
        { requestId: "contract-serialization-request" },
      );

      expect(result).toEqual(serializationFixture);
    });

    it("normalizes failures to the shared error contract", async () => {
      const error = await harness.transport
        .call(
          "cancel_query",
          { connectionId: "missing-connection" },
          { requestId: "contract-error-request" },
        )
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        name: "TabularisClientError",
        message: "No running query found",
        details: null,
        requestId: "contract-error-request",
      });
      expect(error).toHaveProperty("code");
    });
  });
}

export async function createLiveWebContractServer(
  serializationFixture: unknown,
): Promise<LiveWebContractServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response, serializationFixture);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address) {
    server.close();
    throw new Error("The live contract server did not expose an address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  serializationFixture: unknown,
): Promise<void> {
  if (request.method === "GET" && request.url === "/api/v1/session") {
    sendJson(response, 200, SESSION, "contract-session-request");
    return;
  }

  const command = request.url?.match(/^\/api\/v1\/rpc\/([^/?]+)$/)?.[1];
  if (request.method !== "POST" || !command) {
    sendJson(response, 404, { error: "not found" }, "contract-not-found");
    return;
  }

  const requestId = headerValue(request, "x-request-id") ?? "missing-request-id";
  if (
    headerValue(request, "content-type") !== "application/json" ||
    headerValue(request, "x-tabularis-csrf") !== SESSION.csrfToken
  ) {
    sendFailure(response, 400, "INVALID_HEADERS", "Invalid RPC headers", requestId);
    return;
  }

  const body = await readBody(request);
  if (command === "is_debug_mode" && body === "null") {
    sendSuccess(response, true, requestId);
    return;
  }
  if (command === "get_connections_with_groups" && body === "null") {
    sendSuccess(response, { groups: [], connections: [] }, requestId);
    return;
  }
  if (
    (command === "get_ssh_connections" || command === "get_k8s_connections") &&
    body === "null"
  ) {
    sendSuccess(response, [], requestId);
    return;
  }
  if (
    command === "get_tables" &&
    body ===
      JSON.stringify({ connectionId: "metadata-fixture", schema: "public" })
  ) {
    sendSuccess(response, [{ name: "users", schema: "public" }], requestId);
    return;
  }
  if (
    command === "get_columns" &&
    body === JSON.stringify({
      connectionId: "metadata-fixture",
      tableName: "users",
      schema: "public",
    })
  ) {
    sendSuccess(
      response,
      [
        {
          name: "id",
          data_type: "integer",
          is_pk: true,
          is_nullable: false,
          is_auto_increment: true,
        },
      ],
      requestId,
    );
    return;
  }
  if (
    command === "get_selected_schemas" &&
    body === JSON.stringify({ connectionId: "metadata-fixture" })
  ) {
    sendSuccess(response, ["public"], requestId);
    return;
  }
  const queryRequests: Record<string, unknown> = {
    get_view_definition: {
      request: {
        connectionId: "object-fixture",
        viewName: "active_users",
        schema: "public",
      },
      response: "SELECT id FROM users WHERE active = 1",
    },
    get_routine_parameters: {
      request: {
        connectionId: "object-fixture",
        routineName: "refresh_users",
        schema: "public",
      },
      response: [
        {
          name: "batch_size",
          data_type: "integer",
          mode: "IN",
          ordinal_position: 1,
        },
      ],
    },
    get_trigger_definition: {
      request: {
        connectionId: "object-fixture",
        triggerName: "audit_users",
        tableName: "users",
        schema: "public",
      },
      response: "CREATE TRIGGER audit_users AFTER UPDATE ON users",
    },
    get_create_index_sql: {
      request: {
        connectionId: "object-fixture",
        table: "users",
        indexName: "idx_users_email",
        columns: ["email"],
        isUnique: true,
        schema: "public",
      },
      response: [
        'CREATE UNIQUE INDEX "idx_users_email" ON "public"."users" ("email")',
      ],
    },
    get_db_users: {
      request: { connectionId: "object-fixture" },
      response: [{ user: "app", host: "%", locked: false }],
    },
    apply_db_user_privileges: {
      request: {
        connectionId: "object-fixture",
        user: "app",
        host: "%",
        database: "app_db",
        table: null,
        privileges: ["SELECT"],
        grant: true,
      },
      response: null,
    },
    insert_record: {
      request: {
        connectionId: "record-fixture",
        table: "files",
        database: "main",
        schema: "public",
        data: { id: 1, name: "before", payload: null },
      },
      response: 1,
    },
    update_record: {
      request: {
        connectionId: "record-fixture",
        table: "files",
        database: "main",
        schema: "public",
        pkMap: { id: 1 },
        colName: "name",
        newVal: "after",
      },
      response: 1,
    },
    fetch_blob: {
      request: {
        connectionId: "record-fixture",
        table: "files",
        database: "main",
        schema: "public",
        pkMap: { id: 1 },
        colName: "payload",
      },
      response: {
        kind: "inline",
        wireValue: "BLOB:4:application/octet-stream:AAECAw==",
      },
    },
    delete_record: {
      request: {
        connectionId: "record-fixture",
        table: "files",
        database: "main",
        schema: "public",
        pkMap: { id: 1 },
      },
      response: 1,
    },
    execute_query: {
      request: {
        connectionId: "query-fixture",
        query: "SELECT 1 AS value",
        limit: 100,
        page: 1,
      },
      response: QUERY_RESULT,
    },
    execute_query_batch: {
      request: {
        connectionId: "query-fixture",
        queries: ["SELECT 1 AS value"],
        limit: 100,
        page: 1,
        batchId: "batch-contract-1",
      },
      response: [{ result: QUERY_RESULT, error: null, execution_time_ms: 1 }],
    },
    count_query: {
      request: { connectionId: "query-fixture", query: "SELECT 1 AS value" },
      response: 1,
    },
    get_server_now: {
      request: { connectionId: "query-fixture" },
      response: "2026-08-22 00:00:00",
    },
    explain_query_plan: {
      request: {
        connectionId: "query-fixture",
        query: "SELECT 1 AS value",
        analyze: false,
      },
      response: {
        kind: "raw",
        raw: {
          engine: "sqlite",
          format: "sqlite-eqp-rows",
          payload: "[]",
          original_query: "SELECT 1 AS value",
        },
      },
    },
    cancel_query: {
      request: {
        connectionId: "query-fixture",
        queryRequestId: "query-request-1",
      },
      response: null,
    },
  };
  const queryFixture = queryRequests[command] as
    | { request: unknown; response: unknown }
    | undefined;
  if (queryFixture && body === JSON.stringify(queryFixture.request)) {
    sendSuccess(response, queryFixture.response, requestId);
    return;
  }
  if (
    command === "contract_serialization_fixture" &&
    body === JSON.stringify({ fixture: "complex-query-result" })
  ) {
    sendSuccess(response, serializationFixture, requestId);
    return;
  }
  if (
    command === "cancel_query" &&
    body === JSON.stringify({ connectionId: "missing-connection" })
  ) {
    sendFailure(
      response,
      409,
      "QUERY_CANCELLATION_FAILED",
      "No running query found",
      requestId,
    );
    return;
  }

  sendFailure(response, 400, "CONTRACT_DRIFT", "Unexpected RPC request", requestId);
}

function sendSuccess(
  response: ServerResponse,
  data: unknown,
  requestId: string,
): void {
  sendJson(response, 200, { ok: true, data }, requestId);
}

function sendFailure(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  requestId: string,
): void {
  sendJson(
    response,
    status,
    { ok: false, error: { code, message, details: null, requestId } },
    requestId,
  );
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  requestId: string,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-request-id": requestId,
  });
  response.end(JSON.stringify(body));
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
