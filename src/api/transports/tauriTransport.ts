import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { TabularisTransport } from "../client";
import type {
  CommandCallOptions,
  CommandName,
  CommandRequest,
  CommandResponse,
  UnmigratedCommandTracking,
} from "../contract";
import type {
  EventName,
  EventPayload,
  Unsubscribe,
} from "../events";

type TauriInvoke = typeof invoke;
type TauriListen = typeof listen;
type TauriEmit = typeof emit;

export class TauriTransport implements TabularisTransport {
  private readonly invokeCommand: TauriInvoke;
  private readonly listenToEvent: TauriListen;
  private readonly emitEvent: TauriEmit;

  constructor(
    invokeCommand: TauriInvoke = invoke,
    listenToEvent: TauriListen = listen,
    emitEvent: TauriEmit = emit,
  ) {
    this.invokeCommand = invokeCommand;
    this.listenToEvent = listenToEvent;
    this.emitEvent = emitEvent;
  }

  call<K extends CommandName>(
    command: K,
    request: CommandRequest<K>,
    _options?: CommandCallOptions,
  ): Promise<CommandResponse<K>> {
    void _options;
    return this.invokeCommand<CommandResponse<K>>(
      command,
      request as InvokeArgs | undefined,
    );
  }

  callUnmigrated<K extends string>(
    command: K extends CommandName ? never : K,
    request: unknown,
    _tracking: UnmigratedCommandTracking,
    _options?: CommandCallOptions,
  ): Promise<unknown> {
    void _tracking;
    void _options;
    return this.invokeCommand(command, request as InvokeArgs | undefined);
  }

  subscribe<K extends EventName>(
    event: K,
    handler: (payload: EventPayload<K>) => void,
  ): Promise<Unsubscribe> {
    return this.listenToEvent<EventPayload<K>>(event, ({ payload }) => {
      handler(payload);
    });
  }

  emit<K extends EventName>(
    event: K,
    payload: EventPayload<K>,
  ): Promise<void> {
    return this.emitEvent(event, payload);
  }
}
