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

const PLUGIN_MANIFEST = {
  id: "postgres-driver",
  name: "PostgreSQL Driver",
  version: "1.2.3",
  description: "Contract plugin",
  default_port: 5432,
  is_builtin: false,
  capabilities: {
    schemas: true,
    views: true,
    routines: true,
    file_based: false,
    folder_based: false,
    identifier_quote: '"',
    alter_primary_key: false,
  },
};

const PLUGIN_REGISTRY_ENTRY = {
  id: "postgres-driver",
  name: "PostgreSQL Driver",
  description: "Contract plugin",
  author: "Tabularis",
  homepage: "https://example.com/postgres-driver",
  latest_version: "1.2.3",
  releases: [
    {
      version: "1.2.3",
      min_tabularis_version: null,
      platform_supported: true,
    },
  ],
  installed_version: null,
  update_available: false,
  platform_supported: true,
};

const SESSION = {
  apiVersion: "v1",
  serverVersion: "contract-fixture",
  serverBuild: {
    target: "test-contract",
    profile: "debug",
    commit: null,
  },
  authenticated: true,
  csrfToken: "contract-csrf-token",
  capabilities: {
    rpc: true,
    events: false,
    uploads: false,
    downloads: false,
    pluginAssets: false,
    mcpHostConfiguration: true,
    nativeUpdater: false,
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

    it("preserves connection file and backup contracts", async () => {
      await expect(
        harness.transport.call("export_connections_file", {
          mode: "noSecrets",
          connectionIds: ["connection-fixture"],
        }),
      ).resolves.toEqual({
        kind: "inline",
        fileName: "tabularis-connections.json",
        mimeType: "application/json",
        contents: "{\"version\":1}",
      });
      await expect(
        harness.transport.call("list_connection_import_sources", undefined),
      ).resolves.toEqual([]);
      await expect(
        harness.transport.call("get_connections_backup_status", undefined),
      ).resolves.toEqual({
        passwordSet: true,
        targetPasswordSet: true,
        lastBackupAt: null,
        targetKind: "serverDirectory",
        targetDisplay: "/srv/tabularis/backups",
      });
      await expect(
        harness.transport.call("set_connections_backup_password", {
          password: "backup-password",
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("run_connections_backup", undefined),
      ).resolves.toEqual({
        serverLocation: "/srv/tabularis/backups/tabularis-backup.json",
        targetKind: "serverDirectory",
        download: null,
      });
    });

    it("preserves generic export contracts", async () => {
      await expect(
        harness.transport.call("export_query_to_file", {
          connectionId: "query-export-fixture",
          query: "SELECT 1 AS value",
          format: "csv",
          csvDelimiter: ";",
        }),
      ).resolves.toEqual({
        kind: "download",
        fileName: "result.csv",
        mimeType: "text/csv",
        token: "query-export-download-token",
        size: 14,
      });
      await expect(
        harness.transport.call("cancel_export", {
          connectionId: "query-export-fixture",
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("export_ai_activity_json", undefined),
      ).resolves.toBe('{"id":"activity-1"}\n');
      await expect(
        harness.transport.call("export_ai_activity_csv", undefined),
      ).resolves.toBe("id,status\nactivity-1,success\n");
      await expect(
        harness.transport.call("export_ai_session_as_notebook", {
          sessionId: "ai-session-fixture",
        }),
      ).resolves.toMatchObject({ title: "AI session" });
      await expect(
        harness.transport.call("export_logs", {}),
      ).resolves.toEqual({
        kind: "download",
        fileName: "tabularis-logs.log",
        mimeType: "text/plain",
        token: "logs-download-token",
        size: 64,
      });
    });

    it("preserves AI, activity, and approval contracts without returning keys", async () => {
      await expect(
        harness.transport.call("set_ai_key", {
          provider: "openai",
          key: "write-only-contract-key",
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("check_ai_key_status", { provider: "openai" }),
      ).resolves.toEqual({ configured: true, fromEnv: false });
      await expect(
        harness.transport.call("get_ai_models", { forceRefresh: false }),
      ).resolves.toEqual({ openai: ["gpt-contract"] });
      await expect(
        harness.transport.call("generate_ai_query", {
          req: {
            provider: "openai",
            model: "gpt-contract",
            prompt: "Select one",
            schema: "table values(id integer)",
          },
        }),
      ).resolves.toBe("SELECT 1");
      await expect(
        harness.transport.call("get_ai_activity", { filter: { status: "success" } }),
      ).resolves.toEqual([]);
      await expect(
        harness.transport.call("list_pending_approvals", undefined),
      ).resolves.toEqual([]);
      await expect(
        harness.transport.call("decide_pending_approval", {
          approvalId: "approval-contract",
          decision: "deny",
          reason: "contract fixture",
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("delete_ai_key", { provider: "openai" }),
      ).resolves.toBeNull();
    });

    it("preserves local-admin MCP host configuration contracts", async () => {
      await expect(
        harness.transport.call("get_mcp_status", undefined),
      ).resolves.toEqual([
        {
          client_id: "claude",
          client_name: "Claude Desktop",
          installed: false,
          config_path: "/home/test/.config/Claude/claude_desktop_config.json",
          executable_path: "/usr/bin/tabularis",
          client_type: "file",
          manual_command: null,
        },
      ]);
      await expect(
        harness.transport.call("install_mcp_config", { clientId: "claude" }),
      ).resolves.toBe("Claude Desktop");
    });

    it("preserves local-admin plugin lifecycle contracts", async () => {
      await expect(
        harness.transport.call("fetch_plugin_registry", undefined),
      ).resolves.toEqual([PLUGIN_REGISTRY_ENTRY]);
      await expect(
        harness.transport.call("fetch_tabularium_plugin_preview", {
          slug: "postgres-driver",
          registryUrl: null,
          version: "1.2.3",
        }),
      ).resolves.toEqual({
        ...PLUGIN_REGISTRY_ENTRY,
        install_action: "install",
        signature: "verified",
      });
      await expect(
        harness.transport.call("fetch_plugin_readme", {
          slug: "postgres-driver",
          locale: "en",
          registryUrl: null,
        }),
      ).resolves.toEqual({
        html: "<p>Contract plugin</p>",
        locale: "en",
        available_locales: ["en"],
        documentation_url: null,
        repo_url: "https://example.com/postgres-driver",
      });
      await expect(
        harness.transport.call("get_installed_plugins", undefined),
      ).resolves.toEqual([]);
      await expect(
        harness.transport.call("get_plugin_manifest", {
          pluginId: "postgres-driver",
        }),
      ).resolves.toEqual(PLUGIN_MANIFEST);
      await expect(
        harness.transport.call("get_plugin_startup_errors", undefined),
      ).resolves.toEqual([]);
      await expect(
        harness.transport.call("cancel_plugin_install", {
          pluginId: "postgres-driver",
        }),
      ).resolves.toBe(true);

      await expect(
        harness.transport.call("install_plugin", {
          pluginId: "postgres-driver",
          version: "1.2.3",
          registryUrl: "https://registry.example/api",
        }),
      ).resolves.toBeNull();

      for (const command of [
        "disable_plugin",
        "enable_plugin",
        "kill_plugin_process",
        "restart_plugin_process",
        "uninstall_plugin",
      ] as const) {
        await expect(
          harness.transport.call(command, { pluginId: "postgres-driver" }),
        ).resolves.toBeNull();
      }
    });

    it("preserves logs and task manager contracts", async () => {
      await expect(
        harness.transport.call("get_logs", {
          request: { limit: 100, level_filter: "ERROR" },
        }),
      ).resolves.toEqual([
        {
          timestamp: "2026-08-22 09:00:00.000",
          level: "ERROR",
          message: "Contract log",
          target: "contract",
        },
      ]);
      await expect(
        harness.transport.call("get_log_settings", undefined),
      ).resolves.toEqual({ enabled: true, max_size: 1000, current_count: 1 });
      await expect(
        harness.transport.call("get_process_list", undefined),
      ).resolves.toEqual([
        {
          plugin_id: "postgres-driver",
          plugin_name: "PostgreSQL Driver",
          pid: 4100,
          cpu_percent: 1.5,
          memory_bytes: 2048,
          disk_read_bytes: 128,
          disk_write_bytes: 64,
          status: "running",
          children: [],
        },
      ]);
      await expect(
        harness.transport.call("get_system_stats", undefined),
      ).resolves.toEqual({
        cpu_percent: 12.5,
        memory_used: 4096,
        memory_total: 8192,
        disk_read_bytes: 256,
        disk_write_bytes: 128,
        process_count: 4,
        tabularis: null,
      });
      await expect(
        harness.transport.call("get_tabularis_children", undefined),
      ).resolves.toEqual([
        {
          pid: 4200,
          name: "tabularis-plugin",
          cpu_percent: 0.5,
          memory_bytes: 1024,
        },
      ]);

      await expect(
        harness.transport.call("set_log_enabled", { enabled: false }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("set_log_max_size", { maxSize: 500 }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("clear_logs", undefined),
      ).resolves.toBeNull();
    });

    it("preserves database dump and import job contracts", async () => {
      await expect(
        harness.transport.call("dump_database", {
          connectionId: "database-transfer-fixture",
          options: { structure: true, data: true, tables: ["users"] },
          schema: "public",
        }),
      ).resolves.toEqual({
        kind: "download",
        fileName: "database-transfer-fixture.sql",
        mimeType: "application/sql",
        token: "database-transfer-download-token",
        size: 128,
      });
      await expect(
        harness.transport.call("import_database", {
          connectionId: "database-transfer-fixture",
          uploadToken: "database-transfer-upload-token",
          schema: "public",
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("cancel_dump", {
          connectionId: "database-transfer-fixture",
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("cancel_import", {
          connectionId: "database-transfer-fixture",
        }),
      ).resolves.toBeNull();
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

    it("preserves saved query and query history contracts", async () => {
      const savedQuery = {
        id: "saved-query-1",
        name: "Active users",
        sql: "SELECT * FROM users WHERE active = 1",
        connection_id: "saved-query-fixture",
        database: "app",
        created_at: "2026-08-22T00:00:00Z",
        updated_at: "2026-08-22T00:00:00Z",
      };
      await expect(
        harness.transport.call("get_saved_queries", {
          connectionId: "saved-query-fixture",
        }),
      ).resolves.toEqual([savedQuery]);
      await expect(
        harness.transport.call("save_query", {
          connectionId: "saved-query-fixture",
          name: savedQuery.name,
          sql: savedQuery.sql,
          database: "app",
        }),
      ).resolves.toEqual(savedQuery);
      await expect(
        harness.transport.call("update_saved_query", {
          connectionId: "saved-query-fixture",
          id: savedQuery.id,
          name: "Recently active users",
          sql: savedQuery.sql,
          database: "analytics",
        }),
      ).resolves.toEqual({
        ...savedQuery,
        name: "Recently active users",
        database: "analytics",
      });
      await expect(
        harness.transport.call("delete_saved_query", {
          connectionId: "saved-query-fixture",
          id: savedQuery.id,
        }),
      ).resolves.toBeNull();

      const historyEntry = {
        id: "history-1",
        sql: "SELECT 1",
        executedAt: "2026-08-22T00:00:00Z",
        executionTimeMs: 2.5,
        status: "success" as const,
        rowsAffected: 1,
        error: null,
        database: "app",
      };
      await expect(
        harness.transport.call("get_query_history", {
          connectionId: "saved-query-fixture",
        }),
      ).resolves.toEqual({
        entries: [historyEntry],
        recoveredBackupPath: null,
      });
      await expect(
        harness.transport.call("add_query_history_entry", {
          connectionId: "saved-query-fixture",
          sql: historyEntry.sql,
          executedAt: historyEntry.executedAt,
          executionTimeMs: historyEntry.executionTimeMs,
          status: historyEntry.status,
          rowsAffected: historyEntry.rowsAffected,
          error: null,
          database: "app",
        }),
      ).resolves.toEqual(historyEntry);
      await expect(
        harness.transport.call("delete_query_history_entry", {
          connectionId: "saved-query-fixture",
          id: historyEntry.id,
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("clear_query_history", {
          connectionId: "saved-query-fixture",
        }),
      ).resolves.toBeNull();
    });

    it("preserves notebook CRUD contracts and file format content", async () => {
      const notebook = {
        version: 2,
        title: "Revenue",
        createdAt: "2026-08-22T00:00:00Z",
        connectionId: "notebook-fixture",
        cells: [{ type: "sql", content: "SELECT 42", name: "Answer" }],
      };
      const content = JSON.stringify(notebook);
      const target = {
        connectionId: "notebook-fixture",
        notebookId: "notebook-1",
      };

      await expect(
        harness.transport.call("create_notebook", { ...target, content }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("save_notebook", { ...target, content }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("load_notebook", target),
      ).resolves.toBe(content);
      await expect(
        harness.transport.call("rename_notebook", {
          ...target,
          title: "Revenue 2026",
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("list_notebooks", {
          connectionId: target.connectionId,
        }),
      ).resolves.toEqual([
        {
          id: target.notebookId,
          title: "Revenue 2026",
          createdAt: notebook.createdAt,
          updatedAt: "2026-08-22T00:01:00Z",
        },
      ]);
      await expect(
        harness.transport.call("delete_notebook", target),
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

    it("preserves settings and session preference contracts", async () => {
      await expect(
        harness.transport.call("get_config", undefined),
      ).resolves.toEqual({ theme: "tabularis-dark", resultPageSize: 500 });
      await expect(
        harness.transport.call("save_config", {
          config: { language: "en", resultPageSize: 250 },
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("get_keybindings", undefined),
      ).resolves.toEqual({ "editor.run": { mac: { key: "Enter", metaKey: true }, win: { key: "Enter", ctrlKey: true } } });
      await expect(
        harness.transport.call("save_keybindings", { keybindings: {} }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("get_all_themes", undefined),
      ).resolves.toEqual([]);
      await expect(
        harness.transport.call("get_system_prompt", undefined),
      ).resolves.toBe("Generate SQL only");
      await expect(
        harness.transport.call("save_system_prompt", { prompt: "Generate safe SQL" }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("reset_system_prompt", undefined),
      ).resolves.toBe("Generate SQL only");
      await expect(
        harness.transport.call("load_editor_preferences", {
          connectionId: "preference-fixture",
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("save_editor_preferences", {
          connectionId: "preference-fixture",
          preferences: { tabs: [], active_tab_id: null },
        }),
      ).resolves.toBeNull();
      await expect(
        harness.transport.call("get_last_open_connections", undefined),
      ).resolves.toEqual(["preference-fixture"]);
      await expect(
        harness.transport.call("set_last_active_connection", {
          connectionId: "preference-fixture",
        }),
      ).resolves.toBeNull();
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
  const notebookContent = JSON.stringify({
    version: 2,
    title: "Revenue",
    createdAt: "2026-08-22T00:00:00Z",
    connectionId: "notebook-fixture",
    cells: [{ type: "sql", content: "SELECT 42", name: "Answer" }],
  });
  const notebookTarget = {
    connectionId: "notebook-fixture",
    notebookId: "notebook-1",
  };
  const queryRequests: Record<string, unknown> = {
    create_notebook: {
      request: { ...notebookTarget, content: notebookContent },
      response: null,
    },
    save_notebook: {
      request: { ...notebookTarget, content: notebookContent },
      response: null,
    },
    load_notebook: {
      request: notebookTarget,
      response: notebookContent,
    },
    rename_notebook: {
      request: { ...notebookTarget, title: "Revenue 2026" },
      response: null,
    },
    list_notebooks: {
      request: { connectionId: "notebook-fixture" },
      response: [
        {
          id: "notebook-1",
          title: "Revenue 2026",
          createdAt: "2026-08-22T00:00:00Z",
          updatedAt: "2026-08-22T00:01:00Z",
        },
      ],
    },
    delete_notebook: {
      request: notebookTarget,
      response: null,
    },
    export_connections_file: {
      request: { mode: "noSecrets", connectionIds: ["connection-fixture"] },
      response: {
        kind: "inline",
        fileName: "tabularis-connections.json",
        mimeType: "application/json",
        contents: "{\"version\":1}",
      },
    },
    list_connection_import_sources: { request: null, response: [] },
    get_connections_backup_status: {
      request: null,
      response: {
        passwordSet: true,
        targetPasswordSet: true,
        lastBackupAt: null,
        targetKind: "serverDirectory",
        targetDisplay: "/srv/tabularis/backups",
      },
    },
    set_connections_backup_password: {
      request: { password: "backup-password" },
      response: null,
    },
    run_connections_backup: {
      request: null,
      response: {
        serverLocation: "/srv/tabularis/backups/tabularis-backup.json",
        targetKind: "serverDirectory",
        download: null,
      },
    },
    export_query_to_file: {
      request: {
        connectionId: "query-export-fixture",
        query: "SELECT 1 AS value",
        format: "csv",
        csvDelimiter: ";",
      },
      response: {
        kind: "download",
        fileName: "result.csv",
        mimeType: "text/csv",
        token: "query-export-download-token",
        size: 14,
      },
    },
    cancel_export: {
      request: { connectionId: "query-export-fixture" },
      response: null,
    },
    export_ai_activity_json: {
      request: null,
      response: '{"id":"activity-1"}\n',
    },
    export_ai_activity_csv: {
      request: null,
      response: "id,status\nactivity-1,success\n",
    },
    export_ai_session_as_notebook: {
      request: { sessionId: "ai-session-fixture" },
      response: { title: "AI session", cells: [] },
    },
    export_logs: {
      request: {},
      response: {
        kind: "download",
        fileName: "tabularis-logs.log",
        mimeType: "text/plain",
        token: "logs-download-token",
        size: 64,
      },
    },
    set_ai_key: {
      request: { provider: "openai", key: "write-only-contract-key" },
      response: null,
    },
    check_ai_key_status: {
      request: { provider: "openai" },
      response: { configured: true, fromEnv: false },
    },
    get_ai_models: {
      request: { forceRefresh: false },
      response: { openai: ["gpt-contract"] },
    },
    generate_ai_query: {
      request: {
        req: {
          provider: "openai",
          model: "gpt-contract",
          prompt: "Select one",
          schema: "table values(id integer)",
        },
      },
      response: "SELECT 1",
    },
    get_ai_activity: {
      request: { filter: { status: "success" } },
      response: [],
    },
    list_pending_approvals: { request: null, response: [] },
    decide_pending_approval: {
      request: {
        approvalId: "approval-contract",
        decision: "deny",
        reason: "contract fixture",
      },
      response: null,
    },
    delete_ai_key: {
      request: { provider: "openai" },
      response: null,
    },
    get_mcp_status: {
      request: null,
      response: [
        {
          client_id: "claude",
          client_name: "Claude Desktop",
          installed: false,
          config_path: "/home/test/.config/Claude/claude_desktop_config.json",
          executable_path: "/usr/bin/tabularis",
          client_type: "file",
          manual_command: null,
        },
      ],
    },
    install_mcp_config: {
      request: { clientId: "claude" },
      response: "Claude Desktop",
    },
    fetch_plugin_registry: {
      request: null,
      response: [PLUGIN_REGISTRY_ENTRY],
    },
    fetch_tabularium_plugin_preview: {
      request: {
        slug: "postgres-driver",
        registryUrl: null,
        version: "1.2.3",
      },
      response: {
        ...PLUGIN_REGISTRY_ENTRY,
        install_action: "install",
        signature: "verified",
      },
    },
    fetch_plugin_readme: {
      request: {
        slug: "postgres-driver",
        locale: "en",
        registryUrl: null,
      },
      response: {
        html: "<p>Contract plugin</p>",
        locale: "en",
        available_locales: ["en"],
        documentation_url: null,
        repo_url: "https://example.com/postgres-driver",
      },
    },
    get_installed_plugins: { request: null, response: [] },
    get_plugin_manifest: {
      request: { pluginId: "postgres-driver" },
      response: PLUGIN_MANIFEST,
    },
    get_plugin_startup_errors: { request: null, response: [] },
    cancel_plugin_install: {
      request: { pluginId: "postgres-driver" },
      response: true,
    },
    install_plugin: {
      request: {
        pluginId: "postgres-driver",
        version: "1.2.3",
        registryUrl: "https://registry.example/api",
      },
      response: null,
    },
    disable_plugin: {
      request: { pluginId: "postgres-driver" },
      response: null,
    },
    enable_plugin: {
      request: { pluginId: "postgres-driver" },
      response: null,
    },
    kill_plugin_process: {
      request: { pluginId: "postgres-driver" },
      response: null,
    },
    restart_plugin_process: {
      request: { pluginId: "postgres-driver" },
      response: null,
    },
    uninstall_plugin: {
      request: { pluginId: "postgres-driver" },
      response: null,
    },
    get_logs: {
      request: { request: { limit: 100, level_filter: "ERROR" } },
      response: [
        {
          timestamp: "2026-08-22 09:00:00.000",
          level: "ERROR",
          message: "Contract log",
          target: "contract",
        },
      ],
    },
    get_log_settings: {
      request: null,
      response: { enabled: true, max_size: 1000, current_count: 1 },
    },
    get_process_list: {
      request: null,
      response: [
        {
          plugin_id: "postgres-driver",
          plugin_name: "PostgreSQL Driver",
          pid: 4100,
          cpu_percent: 1.5,
          memory_bytes: 2048,
          disk_read_bytes: 128,
          disk_write_bytes: 64,
          status: "running",
          children: [],
        },
      ],
    },
    get_system_stats: {
      request: null,
      response: {
        cpu_percent: 12.5,
        memory_used: 4096,
        memory_total: 8192,
        disk_read_bytes: 256,
        disk_write_bytes: 128,
        process_count: 4,
        tabularis: null,
      },
    },
    get_tabularis_children: {
      request: null,
      response: [
        {
          pid: 4200,
          name: "tabularis-plugin",
          cpu_percent: 0.5,
          memory_bytes: 1024,
        },
      ],
    },
    set_log_enabled: { request: { enabled: false }, response: null },
    set_log_max_size: { request: { maxSize: 500 }, response: null },
    clear_logs: { request: null, response: null },
    dump_database: {
      request: {
        connectionId: "database-transfer-fixture",
        options: { structure: true, data: true, tables: ["users"] },
        schema: "public",
      },
      response: {
        kind: "download",
        fileName: "database-transfer-fixture.sql",
        mimeType: "application/sql",
        token: "database-transfer-download-token",
        size: 128,
      },
    },
    import_database: {
      request: {
        connectionId: "database-transfer-fixture",
        uploadToken: "database-transfer-upload-token",
        schema: "public",
      },
      response: null,
    },
    cancel_dump: {
      request: { connectionId: "database-transfer-fixture" },
      response: null,
    },
    cancel_import: {
      request: { connectionId: "database-transfer-fixture" },
      response: null,
    },
    get_saved_queries: {
      request: { connectionId: "saved-query-fixture" },
      response: [
        {
          id: "saved-query-1",
          name: "Active users",
          sql: "SELECT * FROM users WHERE active = 1",
          connection_id: "saved-query-fixture",
          database: "app",
          created_at: "2026-08-22T00:00:00Z",
          updated_at: "2026-08-22T00:00:00Z",
        },
      ],
    },
    save_query: {
      request: {
        connectionId: "saved-query-fixture",
        name: "Active users",
        sql: "SELECT * FROM users WHERE active = 1",
        database: "app",
      },
      response: {
        id: "saved-query-1",
        name: "Active users",
        sql: "SELECT * FROM users WHERE active = 1",
        connection_id: "saved-query-fixture",
        database: "app",
        created_at: "2026-08-22T00:00:00Z",
        updated_at: "2026-08-22T00:00:00Z",
      },
    },
    update_saved_query: {
      request: {
        connectionId: "saved-query-fixture",
        id: "saved-query-1",
        name: "Recently active users",
        sql: "SELECT * FROM users WHERE active = 1",
        database: "analytics",
      },
      response: {
        id: "saved-query-1",
        name: "Recently active users",
        sql: "SELECT * FROM users WHERE active = 1",
        connection_id: "saved-query-fixture",
        database: "analytics",
        created_at: "2026-08-22T00:00:00Z",
        updated_at: "2026-08-22T00:00:00Z",
      },
    },
    delete_saved_query: {
      request: { connectionId: "saved-query-fixture", id: "saved-query-1" },
      response: null,
    },
    get_query_history: {
      request: { connectionId: "saved-query-fixture" },
      response: {
        entries: [
          {
            id: "history-1",
            sql: "SELECT 1",
            executedAt: "2026-08-22T00:00:00Z",
            executionTimeMs: 2.5,
            status: "success",
            rowsAffected: 1,
            error: null,
            database: "app",
          },
        ],
        recoveredBackupPath: null,
      },
    },
    add_query_history_entry: {
      request: {
        connectionId: "saved-query-fixture",
        sql: "SELECT 1",
        executedAt: "2026-08-22T00:00:00Z",
        executionTimeMs: 2.5,
        status: "success",
        rowsAffected: 1,
        error: null,
        database: "app",
      },
      response: {
        id: "history-1",
        sql: "SELECT 1",
        executedAt: "2026-08-22T00:00:00Z",
        executionTimeMs: 2.5,
        status: "success",
        rowsAffected: 1,
        error: null,
        database: "app",
      },
    },
    delete_query_history_entry: {
      request: { connectionId: "saved-query-fixture", id: "history-1" },
      response: null,
    },
    clear_query_history: {
      request: { connectionId: "saved-query-fixture" },
      response: null,
    },
    get_config: {
      request: null,
      response: { theme: "tabularis-dark", resultPageSize: 500 },
    },
    save_config: {
      request: { config: { language: "en", resultPageSize: 250 } },
      response: null,
    },
    get_keybindings: {
      request: null,
      response: {
        "editor.run": {
          mac: { key: "Enter", metaKey: true },
          win: { key: "Enter", ctrlKey: true },
        },
      },
    },
    save_keybindings: { request: { keybindings: {} }, response: null },
    get_all_themes: { request: null, response: [] },
    get_system_prompt: { request: null, response: "Generate SQL only" },
    save_system_prompt: {
      request: { prompt: "Generate safe SQL" },
      response: null,
    },
    reset_system_prompt: { request: null, response: "Generate SQL only" },
    load_editor_preferences: {
      request: { connectionId: "preference-fixture" },
      response: null,
    },
    save_editor_preferences: {
      request: {
        connectionId: "preference-fixture",
        preferences: { tabs: [], active_tab_id: null },
      },
      response: null,
    },
    get_last_open_connections: {
      request: null,
      response: ["preference-fixture"],
    },
    set_last_active_connection: {
      request: { connectionId: "preference-fixture" },
      response: null,
    },
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
