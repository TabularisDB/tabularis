import type { Page } from "@playwright/test";

interface RpcError {
  code: string;
  message: string;
  requestId: string;
}

interface RpcSuccess {
  ok: true;
  data: unknown;
}

interface RpcFailure {
  ok: false;
  error: RpcError;
}

type RpcEnvelope = RpcSuccess | RpcFailure;

function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  return (value as { ok: unknown }).ok === true || (value as { ok: unknown }).ok === false;
}

export async function rpc<T>(
  page: Page,
  command: string,
  payload: unknown = null,
): Promise<T> {
  const envelope = await page.evaluate(
    async ({ commandName, commandPayload }) => {
      const sessionResponse = await fetch("/api/v1/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!sessionResponse.ok) {
        throw new Error(`Session negotiation failed with HTTP ${sessionResponse.status}`);
      }
      const session = (await sessionResponse.json()) as { csrfToken?: unknown };
      if (typeof session.csrfToken !== "string") {
        throw new Error("Session negotiation omitted its CSRF token");
      }
      const response = await fetch(
        `/api/v1/rpc/${encodeURIComponent(commandName)}`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-tabularis-csrf": session.csrfToken,
          },
          body: JSON.stringify(commandPayload),
        },
      );
      return response.json() as Promise<unknown>;
    },
    { commandName: command, commandPayload: payload },
  );

  if (!isRpcEnvelope(envelope)) {
    throw new Error(`RPC ${command} returned an invalid response envelope`);
  }
  if (!envelope.ok) {
    throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
  }
  return envelope.data as T;
}
