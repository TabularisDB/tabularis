import type { ConnectionTestProgressPayload } from "../utils/connectionTest";
import type { BatchStatementResult } from "../types/editor";
import type { AuthorizationLevel } from "./contract";
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
