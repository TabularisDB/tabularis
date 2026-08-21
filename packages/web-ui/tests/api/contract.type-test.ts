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
void wrongAuthorization;
void rpcFailure;
void failureWithoutRequestId;
