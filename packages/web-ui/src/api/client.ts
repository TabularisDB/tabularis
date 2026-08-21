import type {
  CommandCallOptions,
  CommandName,
  CommandRequest,
  CommandResponse,
  TypedCommandCaller,
  UnmigratedCommandTracking,
} from "./contract";
import type {
  EventName,
  EventPayload,
  EventSubscriber,
  Unsubscribe,
} from "./events";

export interface TabularisTransport
  extends TypedCommandCaller,
    EventSubscriber {
  emit<K extends EventName>(
    event: K,
    payload: EventPayload<K>,
  ): Promise<void>;
}

export class TabularisClient implements TabularisTransport {
  private readonly transport: TabularisTransport;

  constructor(transport: TabularisTransport) {
    this.transport = transport;
  }

  call<K extends CommandName>(
    command: K,
    request: CommandRequest<K>,
    options?: CommandCallOptions,
  ): Promise<CommandResponse<K>> {
    return this.transport.call(command, request, options);
  }

  callUnmigrated<K extends string>(
    command: K extends CommandName ? never : K,
    request: unknown,
    tracking: UnmigratedCommandTracking,
    options?: CommandCallOptions,
  ): Promise<unknown> {
    return this.transport.callUnmigrated(
      command,
      request,
      tracking,
      options,
    );
  }

  subscribe<K extends EventName>(
    event: K,
    handler: (payload: EventPayload<K>) => void,
  ): Promise<Unsubscribe> {
    return this.transport.subscribe(event, handler);
  }

  emit<K extends EventName>(
    event: K,
    payload: EventPayload<K>,
  ): Promise<void> {
    return this.transport.emit(event, payload);
  }
}
