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
  uploadConnectionIcon?(file: Blob): Promise<string>;
  uploadBlob?(file: Blob): Promise<string>;
  uploadedBlobUrl?(token: string): string;
  readUploadedBlob?(token: string): Promise<Blob>;
  consumeBlobDownload?(token: string): Promise<Blob>;
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

  uploadConnectionIcon(file: Blob): Promise<string> {
    if (!this.transport.uploadConnectionIcon) {
      return Promise.reject(
        new Error("The active transport does not support connection icon uploads"),
      );
    }
    return this.transport.uploadConnectionIcon(file);
  }

  uploadBlob(file: Blob): Promise<string> {
    if (!this.transport.uploadBlob) {
      return Promise.reject(
        new Error("The active transport does not support browser BLOB uploads"),
      );
    }
    return this.transport.uploadBlob(file);
  }

  uploadedBlobUrl(token: string): string {
    if (!this.transport.uploadedBlobUrl) {
      throw new Error("The active transport does not expose browser BLOB uploads");
    }
    return this.transport.uploadedBlobUrl(token);
  }

  readUploadedBlob(token: string): Promise<Blob> {
    if (!this.transport.readUploadedBlob) {
      return Promise.reject(
        new Error("The active transport does not support browser BLOB uploads"),
      );
    }
    return this.transport.readUploadedBlob(token);
  }

  consumeBlobDownload(token: string): Promise<Blob> {
    if (!this.transport.consumeBlobDownload) {
      return Promise.reject(
        new Error("The active transport does not support browser BLOB downloads"),
      );
    }
    return this.transport.consumeBlobDownload(token);
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
