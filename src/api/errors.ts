export type RequestId = string;

export interface TabularisError {
  code: string;
  message: string;
  details: unknown | null;
  requestId: RequestId;
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
