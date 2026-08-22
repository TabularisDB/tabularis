import type { ConnectionTestProgressPayload } from "../utils/connectionTest";
import type { BatchStatementResult } from "../types/editor";
import type { AuthorizationLevel } from "./contract";
import type { SshAskpassRequest } from "../types/askpass";
import type { RequestId } from "./errors";

export interface EventDefinition<
  Payload,
  Authorization extends AuthorizationLevel,
> {
  readonly payload: Payload;
  readonly authorization: Authorization;
}

export interface EventMap {
  "connection-test-progress": EventDefinition<
    ConnectionTestProgressPayload,
    "database"
  >;
  "connection-health-failed": EventDefinition<
    { connectionId: string; error: string },
    "database"
  >;
  "connections:active-changed": EventDefinition<string[], "database">;
  "database-dropped": EventDefinition<
    { connectionId: string; database: string },
    "database"
  >;
  "batch-statement-complete": EventDefinition<
    { batch_id: string; index: number; statement: BatchStatementResult },
    "database"
  >;
  "query-status": EventDefinition<
    {
      requestId: RequestId;
      connectionId: string;
      status: "started" | "completed" | "failed";
    },
    "database"
  >;
  "query-cancelled": EventDefinition<
    { requestId: RequestId; connectionId: string },
    "database"
  >;
  "dump_progress": EventDefinition<
    {
      connection_id: string;
      tables_processed: number;
      total_tables: number;
      percentage: number;
      current_operation: string;
    },
    "database"
  >;
  "import_progress": EventDefinition<
    {
      connection_id: string;
      statements_executed: number;
      total_statements: number;
      percentage: number;
      current_operation: string;
    },
    "database"
  >;
  "export_progress": EventDefinition<
    { connection_id: string; rows_processed: number },
    "database"
  >;
  "ssh-askpass://request": EventDefinition<SshAskpassRequest, "sensitive">;
  "ssh-askpass://dismiss": EventDefinition<number, "sensitive">;
}

export type EventName = keyof EventMap;
export type EventPayload<K extends EventName> = EventMap[K]["payload"];
export type EventAuthorization<K extends EventName> =
  EventMap[K]["authorization"];

export type EventEnvelope<K extends EventName = EventName> = {
  [E in K]: {
    event: E;
    payload: EventPayload<E>;
    requestId?: RequestId;
    sequence?: number;
  };
}[K];

export type Unsubscribe = () => void;

export interface EventSubscriber {
  subscribe<K extends EventName>(
    event: K,
    handler: (payload: EventPayload<K>) => void,
  ): Promise<Unsubscribe>;
}
