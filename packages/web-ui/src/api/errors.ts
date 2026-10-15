export type RequestId = string;

export interface TabularisError {
  code: string;
  message: string;
  details: unknown | null;
  requestId: RequestId;
}

export class TabularisClientError extends Error implements TabularisError {
  readonly code: string;
  readonly details: unknown | null;
  readonly requestId: RequestId;

  constructor(error: TabularisError, options?: ErrorOptions) {
    super(error.message, options);
    this.name = "TabularisClientError";
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
  }
}

export function createRequestId(): RequestId {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeTabularisError(
  error: unknown,
  code: string,
  requestId: RequestId = createRequestId(),
): TabularisClientError {
  if (error instanceof TabularisClientError) return error;

  const message = errorMessage(error);
  return new TabularisClientError(
    {
      code,
      message,
      details: null,
      requestId,
    },
    error instanceof Error ? { cause: error } : undefined,
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export interface RpcSuccess<T> {
  ok: true;
  data: T;
}

export interface RpcFailure {
  ok: false;
  error: TabularisError;
}

export type RpcResponse<T> = RpcSuccess<T> | RpcFailure;
