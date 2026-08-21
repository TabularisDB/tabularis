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
import { createRequestId, normalizeTabularisError } from "../errors";

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
    options?: CommandCallOptions,
  ): Promise<CommandResponse<K>> {
    const requestId = options?.requestId ?? createRequestId();
    return this.invokeCommand<CommandResponse<K>>(
      command,
      request as InvokeArgs | undefined,
    ).catch((error: unknown) => {
      throw normalizeTabularisError(error, "TAURI_COMMAND_FAILED", requestId);
    });
  }

  callUnmigrated<K extends string>(
    command: K extends CommandName ? never : K,
    request: unknown,
    _tracking: UnmigratedCommandTracking,
    options?: CommandCallOptions,
  ): Promise<unknown> {
    void _tracking;
    const requestId = options?.requestId ?? createRequestId();
    return this.invokeCommand(command, request as InvokeArgs | undefined).catch(
      (error: unknown) => {
        throw normalizeTabularisError(
          error,
          "TAURI_COMMAND_FAILED",
          requestId,
        );
      },
    );
  }

  subscribe<K extends EventName>(
    event: K,
    handler: (payload: EventPayload<K>) => void,
  ): Promise<Unsubscribe> {
    return this.listenToEvent<EventPayload<K>>(event, ({ payload }) => {
      handler(payload);
    }).catch((error: unknown) => {
      throw normalizeTabularisError(error, "TAURI_EVENT_FAILED");
    });
  }

  emit<K extends EventName>(
    event: K,
    payload: EventPayload<K>,
  ): Promise<void> {
    return this.emitEvent(event, payload).catch((error: unknown) => {
      throw normalizeTabularisError(error, "TAURI_EVENT_FAILED");
    });
  }
}
