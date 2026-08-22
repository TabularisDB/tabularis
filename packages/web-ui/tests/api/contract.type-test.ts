import type {
  CommandAuthorization,
  CommandRequest,
  CommandResponse,
  TypedCommandCaller,
} from "../../src/api/contract";
import type {
  EventEnvelope,
  EventSubscriber,
} from "../../src/api/events";
import type { RpcFailure } from "../../src/api/errors";
import type { QueryResult } from "../../src/types/editor";

function assertCommandContract(caller: TypedCommandCaller): void {
  const debugMode: Promise<boolean> = caller.call("is_debug_mode", undefined, {
    requestId: "request-1",
    deadlineMs: 30_000,
    cancellationId: "startup-debug",
  });
  const sshProfiles = caller.call("get_ssh_connections", undefined);
  const askpassResponse = caller.call("respond_ssh_askpass", {
    id: 7,
    response: null,
  });
  const queryResult: Promise<QueryResult> = caller.call(
    "execute_query",
    {
      connectionId: "connection-1",
      query: "SELECT 1",
      limit: 100,
      page: 1,
    },
    { requestId: "query-request-1", cancellationId: "query-request-1" },
  );
  const explainResult = caller.call("explain_query_plan", {
    connectionId: "connection-1",
    query: "SELECT 1",
    analyze: false,
  });
  const cancellation = caller.call("cancel_query", {
    connectionId: "connection-1",
    queryRequestId: "query-request-1",
  });
  const columns = caller.call("get_columns", {
    connectionId: "connection-1",
    tableName: "users",
    schema: "public",
  });
  const materializedViewDefinition: Promise<string> = caller.call(
    "get_materialized_view_definition",
    {
      connectionId: "connection-1",
      viewName: "active_users",
      schema: "public",
    },
  );
  const selectedSchemas: Promise<string[]> = caller.call(
    "get_selected_schemas",
    { connectionId: "connection-1" },
  );
  const updatedRows: Promise<number> = caller.call("update_record", {
    connectionId: "connection-1",
    table: "files",
    pkMap: { id: 1 },
    colName: "payload",
    newVal: "BLOB:4:application/octet-stream:AAECAw==",
  });
  const blob = caller.call("fetch_blob", {
    connectionId: "connection-1",
    table: "files",
    pkMap: { id: 1 },
    colName: "payload",
  });
  const viewDefinition: Promise<string> = caller.call("get_view_definition", {
    connectionId: "connection-1",
    viewName: "active_users",
    schema: "public",
  });
  const passwordChange: Promise<void> = caller.call("set_db_user_password", {
    connectionId: "connection-1",
    user: "app",
    host: "%",
    password: "write-only-secret",
  });
  const config = caller.call("get_config", undefined);
  const savedConfig: Promise<void> = caller.call("save_config", {
    config: { language: "en", formatterTabWidth: 2 },
  });
  const editorPreferences = caller.call("load_editor_preferences", {
    connectionId: "connection-1",
  });
  const sessionSelection: Promise<string[]> = caller.call(
    "get_last_open_connections",
    undefined,
  );
  const savedQueries = caller.call("get_saved_queries", {
    connectionId: "connection-1",
  });
  const history = caller.call("get_query_history", {
    connectionId: "connection-1",
  });
  const deletedSavedQuery: Promise<void> = caller.call("delete_saved_query", {
    connectionId: "connection-1",
    id: "saved-query-1",
  });
  const notebookContent: Promise<string | null> = caller.call("load_notebook", {
    connectionId: "connection-1",
    notebookId: "notebook-1",
  });
  const savedNotebook: Promise<void> = caller.call("save_notebook", {
    connectionId: "connection-1",
    notebookId: "notebook-1",
    content: "{}",
  });
  const notebooks = caller.call("list_notebooks", {
    connectionId: "connection-1",
  });
  const pluginRegistry = caller.call("fetch_plugin_registry", undefined);
  const pluginInstall: Promise<void> = caller.call("install_plugin", {
    pluginId: "postgres-driver",
    version: "1.2.3",
  });
  const pluginCancellation: Promise<boolean> = caller.call(
    "cancel_plugin_install",
    { pluginId: "postgres-driver" },
  );
  const pluginReadme = caller.call("fetch_plugin_readme", {
    slug: "postgres-driver",
    locale: "en",
  });
  const pluginRestart: Promise<void> = caller.call("restart_plugin_process", {
    pluginId: "postgres-driver",
  });

  // @ts-expect-error Plugin identifiers are required for lifecycle mutations.
  caller.call("install_plugin", { version: "1.2.3" });
  // @ts-expect-error Notebook operations require explicit connection scoping.
  caller.call("load_notebook", { notebookId: "notebook-1" });
  // @ts-expect-error Saved-query mutations require explicit connection scoping.
  caller.call("delete_saved_query", { id: "saved-query-1" });
  // @ts-expect-error execute_query requires a connection id.
  caller.call("execute_query", { query: "SELECT 1" });
  // @ts-expect-error Unknown commands must use the tracked escape hatch.
  caller.call("get_unmigrated_data", undefined);
  // @ts-expect-error The response of execute_query is not a string.
  const wrongResponse: Promise<string> = caller.call("execute_query", {
    connectionId: "connection-1",
    query: "SELECT 1",
  });

  const unmigratedResult: Promise<unknown> = caller.callUnmigrated(
    "get_unmigrated_data",
    { connectionId: "connection-1" },
    {
      task: "WEB-050",
      callSite: "src/example.ts:10",
      reason: "The command has not been added to CommandMap yet.",
    },
  );
  // @ts-expect-error Migrated commands cannot bypass their typed contract.
  caller.callUnmigrated("execute_query", {}, {
    task: "WEB-050",
    callSite: "src/example.ts:20",
    reason: "Invalid bypass attempt.",
  });
  // @ts-expect-error Every unmigrated call must include tracking metadata.
  caller.callUnmigrated("get_unmigrated_data", {});

  void [
    debugMode,
    sshProfiles,
    askpassResponse,
    queryResult,
    columns,
    materializedViewDefinition,
    selectedSchemas,
    updatedRows,
    blob,
    viewDefinition,
    passwordChange,
    config,
    savedConfig,
    editorPreferences,
    sessionSelection,
    savedQueries,
    history,
    deletedSavedQuery,
    notebookContent,
    savedNotebook,
    notebooks,
    pluginRegistry,
    pluginInstall,
    pluginCancellation,
    pluginReadme,
    pluginRestart,
    explainResult,
    cancellation,
    wrongResponse,
    unmigratedResult,
  ];
}

function assertEventContract(subscriber: EventSubscriber): void {
  subscriber.subscribe("database-dropped", (payload) => {
    const connectionId: string = payload.connectionId;
    const database: string = payload.database;
    void [connectionId, database];
  });

  subscriber.subscribe("ssh-askpass://request", (payload) => {
    const id: number = payload.id;
    const prompt: string = payload.prompt;
    void [id, prompt];
  });

  subscriber.subscribe("query-status", (payload) => {
    const requestId: string = payload.requestId;
    const status: "started" | "completed" | "failed" = payload.status;
    void [requestId, status];
  });

  // @ts-expect-error database-dropped does not carry a batch id.
  subscriber.subscribe("database-dropped", (payload) => payload.batch_id);
  // @ts-expect-error Unknown event names are rejected.
  subscriber.subscribe("untracked-event", () => undefined);
}

type ExecuteQueryRequest = CommandRequest<"execute_query">;
type ExecuteQueryResponse = CommandResponse<"execute_query">;
type DatabaseDroppedEnvelope = EventEnvelope<"database-dropped">;

const executeQueryAuthorization: CommandAuthorization<"execute_query"> = "database";
const sshAuthorization: CommandAuthorization<"get_ssh_connections"> = "local-admin";
const askpassAuthorization: CommandAuthorization<"respond_ssh_askpass"> = "sensitive";
const passwordAuthorization: CommandAuthorization<"set_db_user_password"> = "sensitive";
const userListAuthorization: CommandAuthorization<"get_db_users"> = "sensitive";
const configAuthorization: CommandAuthorization<"get_config"> = "local-admin";
const editorPreferencesAuthorization: CommandAuthorization<"load_editor_preferences"> = "database";
const sessionSelectionAuthorization: CommandAuthorization<"get_last_open_connections"> = "session";
const savedQueryAuthorization: CommandAuthorization<"save_query"> = "database";
const queryHistoryAuthorization: CommandAuthorization<"get_query_history"> = "database";
const notebookAuthorization: CommandAuthorization<"save_notebook"> = "database";
const pluginInstallAuthorization: CommandAuthorization<"install_plugin"> =
  "local-admin";
// @ts-expect-error Plugin installation is never a plain session operation.
const wrongPluginAuthorization: CommandAuthorization<"install_plugin"> = "session";
// @ts-expect-error execute_query is not a local-admin operation.
const wrongAuthorization: CommandAuthorization<"execute_query"> = "local-admin";
const rpcFailure: RpcFailure = {
  ok: false,
  error: {
    code: "QUERY_FAILED",
    message: "Query failed",
    details: null,
    requestId: "request-1",
  },
};
const failureWithoutRequestId: RpcFailure = {
  ok: false,
  // @ts-expect-error Errors must expose the request id used for diagnostics.
  error: {
    code: "QUERY_FAILED",
    message: "Query failed",
    details: null,
  },
};

void assertCommandContract;
void assertEventContract;
void (null as unknown as ExecuteQueryRequest);
void (null as unknown as ExecuteQueryResponse);
void (null as unknown as DatabaseDroppedEnvelope);
void executeQueryAuthorization;
void sshAuthorization;
void askpassAuthorization;
void passwordAuthorization;
void userListAuthorization;
void configAuthorization;
void editorPreferencesAuthorization;
void sessionSelectionAuthorization;
void savedQueryAuthorization;
void queryHistoryAuthorization;
void notebookAuthorization;
void pluginInstallAuthorization;
void wrongPluginAuthorization;
void wrongAuthorization;
void rpcFailure;
void failureWithoutRequestId;
