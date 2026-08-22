import { invoke } from "@tauri-apps/api/core";
import { expect, vi } from "vitest";
import { HttpTransport } from "../../src/api/transports/httpTransport";
import { TauriTransport } from "../../src/api/transports/tauriTransport";
import serializationFixture from "../fixtures/transportSerialization.json";
import {
  createLiveWebContractServer,
  defineTransportContractSuite,
} from "./contract/transportContract";

defineTransportContractSuite(
  "Tauri adapter mock",
  serializationFixture,
  async () => {
    vi.mocked(invoke).mockImplementation(async (command, request) => {
      if (command === "is_debug_mode") {
        expect(request).toBeUndefined();
        return true;
      }
      if (command === "get_connections_with_groups") {
        expect(request).toBeUndefined();
        return { groups: [], connections: [] };
      }
      if (command === "get_ssh_connections" || command === "get_k8s_connections") {
        expect(request).toBeUndefined();
        return [];
      }
      if (command === "get_tables") {
        expect(request).toEqual({
          connectionId: "metadata-fixture",
          schema: "public",
        });
        return [{ name: "users", schema: "public" }];
      }
      if (command === "get_columns") {
        expect(request).toEqual({
          connectionId: "metadata-fixture",
          tableName: "users",
          schema: "public",
        });
        return [
          {
            name: "id",
            data_type: "integer",
            is_pk: true,
            is_nullable: false,
            is_auto_increment: true,
          },
        ];
      }
      if (command === "get_selected_schemas") {
        expect(request).toEqual({ connectionId: "metadata-fixture" });
        return ["public"];
      }
      if (command === "create_notebook" || command === "save_notebook") {
        return null;
      }
      if (command === "load_notebook") {
        return JSON.stringify({
          version: 2,
          title: "Revenue",
          createdAt: "2026-08-22T00:00:00Z",
          connectionId: "notebook-fixture",
          cells: [{ type: "sql", content: "SELECT 42", name: "Answer" }],
        });
      }
      if (command === "rename_notebook" || command === "delete_notebook") {
        return null;
      }
      if (command === "list_notebooks") {
        return [
          {
            id: "notebook-1",
            title: "Revenue 2026",
            createdAt: "2026-08-22T00:00:00Z",
            updatedAt: "2026-08-22T00:01:00Z",
          },
        ];
      }
      if (command === "get_saved_queries") {
        return [
          {
            id: "saved-query-1",
            name: "Active users",
            sql: "SELECT * FROM users WHERE active = 1",
            connection_id: "saved-query-fixture",
            database: "app",
            created_at: "2026-08-22T00:00:00Z",
            updated_at: "2026-08-22T00:00:00Z",
          },
        ];
      }
      if (command === "save_query") {
        return {
          id: "saved-query-1",
          name: "Active users",
          sql: "SELECT * FROM users WHERE active = 1",
          connection_id: "saved-query-fixture",
          database: "app",
          created_at: "2026-08-22T00:00:00Z",
          updated_at: "2026-08-22T00:00:00Z",
        };
      }
      if (command === "update_saved_query") {
        return {
          id: "saved-query-1",
          name: "Recently active users",
          sql: "SELECT * FROM users WHERE active = 1",
          connection_id: "saved-query-fixture",
          database: "analytics",
          created_at: "2026-08-22T00:00:00Z",
          updated_at: "2026-08-22T00:00:00Z",
        };
      }
      if (command === "delete_saved_query") return null;
      if (command === "get_query_history") {
        return {
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
        };
      }
      if (command === "add_query_history_entry") {
        return {
          id: "history-1",
          sql: "SELECT 1",
          executedAt: "2026-08-22T00:00:00Z",
          executionTimeMs: 2.5,
          status: "success",
          rowsAffected: 1,
          error: null,
          database: "app",
        };
      }
      if (
        command === "delete_query_history_entry" ||
        command === "clear_query_history"
      ) {
        return null;
      }
      if (command === "get_config") {
        expect(request).toBeUndefined();
        return { theme: "tabularis-dark", resultPageSize: 500 };
      }
      if (command === "save_config") return null;
      if (command === "get_keybindings") {
        return {
          "editor.run": {
            mac: { key: "Enter", metaKey: true },
            win: { key: "Enter", ctrlKey: true },
          },
        };
      }
      if (command === "save_keybindings") return null;
      if (command === "get_all_themes") return [];
      if (command === "get_system_prompt" || command === "reset_system_prompt") {
        return "Generate SQL only";
      }
      if (command === "save_system_prompt") return null;
      if (command === "load_editor_preferences") return null;
      if (command === "save_editor_preferences") return null;
      if (command === "get_last_open_connections") {
        return ["preference-fixture"];
      }
      if (command === "set_last_active_connection") return null;
      if (command === "get_view_definition") {
        return "SELECT id FROM users WHERE active = 1";
      }
      if (command === "get_routine_parameters") {
        return [
          {
            name: "batch_size",
            data_type: "integer",
            mode: "IN",
            ordinal_position: 1,
          },
        ];
      }
      if (command === "get_trigger_definition") {
        return "CREATE TRIGGER audit_users AFTER UPDATE ON users";
      }
      if (command === "get_create_index_sql") {
        return [
          'CREATE UNIQUE INDEX "idx_users_email" ON "public"."users" ("email")',
        ];
      }
      if (command === "get_db_users") {
        return [{ user: "app", host: "%", locked: false }];
      }
      if (command === "apply_db_user_privileges") return null;
      if (
        command === "insert_record" ||
        command === "update_record" ||
        command === "delete_record"
      ) {
        return 1;
      }
      if (command === "fetch_blob") {
        return {
          kind: "inline",
          wireValue: "BLOB:4:application/octet-stream:AAECAw==",
        };
      }
      if (command === "execute_query") {
        expect(request).toEqual({
          connectionId: "query-fixture",
          query: "SELECT 1 AS value",
          limit: 100,
          page: 1,
        });
        return {
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
      }
      if (command === "execute_query_batch") {
        return [
          {
            result: {
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
            },
            error: null,
            execution_time_ms: 1,
          },
        ];
      }
      if (command === "count_query") return 1;
      if (command === "get_server_now") return "2026-08-22 00:00:00";
      if (command === "explain_query_plan") {
        return {
          kind: "raw",
          raw: {
            engine: "sqlite",
            format: "sqlite-eqp-rows",
            payload: "[]",
            original_query: "SELECT 1 AS value",
          },
        };
      }
      if (command === "contract_serialization_fixture") {
        expect(request).toEqual({ fixture: "complex-query-result" });
        return serializationFixture;
      }
      if (command === "cancel_query") {
        if ("queryRequestId" in (request as Record<string, unknown>)) return null;
        expect(request).toEqual({ connectionId: "missing-connection" });
        throw new Error("No running query found");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    return { transport: new TauriTransport() };
  },
);

defineTransportContractSuite(
  "live web server",
  serializationFixture,
  async () => {
    const server = await createLiveWebContractServer(serializationFixture);
    return {
      transport: new HttpTransport({ baseUrl: server.baseUrl }),
      close: server.close,
    };
  },
);
