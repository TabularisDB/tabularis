import { afterEach, describe, expect, it, vi } from "vitest";
import { TabularisClientError } from "../../../src/api/errors";
import {
  HttpTransport,
  type WebSocketLike,
} from "../../../src/api/transports/httpTransport";

const SESSION = {
  apiVersion: "v1",
  serverVersion: "0.20.0",
  authenticated: true,
  csrfToken: "csrf-token",
  capabilities: {
    rpc: true,
    events: true,
    uploads: false,
    downloads: false,
    pluginAssets: false,
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  message(value: unknown): void {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }

  disconnect(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}

describe("HttpTransport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bootstraps one cookie-backed session and performs typed RPC calls", async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(SESSION))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: true }));
    const transport = new HttpTransport({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchRequest,
    });

    await expect(transport.initialize()).resolves.toEqual(SESSION);
    await expect(
      transport.call("is_debug_mode", undefined, {
        requestId: "request-1",
        deadlineMs: 1500,
        cancellationId: "startup-debug",
      }),
    ).resolves.toBe(true);

    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(fetchRequest.mock.calls[0]).toEqual([
      "http://127.0.0.1:8080/api/v1/session",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    ]);
    const [rpcUrl, rpcInit] = fetchRequest.mock.calls[1];
    const headers = new Headers(rpcInit?.headers);
    expect(rpcUrl).toBe("http://127.0.0.1:8080/api/v1/rpc/is_debug_mode");
    expect(rpcInit?.body).toBe("null");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-tabularis-csrf")).toBe("csrf-token");
    expect(headers.get("x-request-id")).toBe("request-1");
    expect(headers.get("x-tabularis-deadline-ms")).toBe("1500");
    expect(headers.get("x-tabularis-cancellation-id")).toBe("startup-debug");
  });

  it("normalizes RPC envelopes and network failures", async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(SESSION))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: {
              code: "QUERY_CANCELLATION_FAILED",
              message: "No active query",
              details: { connectionId: "connection-1" },
              requestId: "request-server",
            },
          },
          409,
        ),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const transport = new HttpTransport({ fetch: fetchRequest });

    const rpcError = await transport
      .call("cancel_query", { connectionId: "connection-1" })
      .catch((error: unknown) => error);
    expect(rpcError).toBeInstanceOf(TabularisClientError);
    expect(rpcError).toMatchObject({
      code: "QUERY_CANCELLATION_FAILED",
      message: "No active query",
      details: { connectionId: "connection-1" },
      requestId: "request-server",
    });

    const networkError = await transport
      .call("is_debug_mode", undefined, { requestId: "request-network" })
      .catch((error: unknown) => error);
    expect(networkError).toMatchObject({
      code: "NETWORK_ERROR",
      message: "Failed to fetch",
      requestId: "request-network",
    });
  });

  it("uses the same RPC path for tracked unmigrated commands", async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(SESSION))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { value: 1 } }));
    const transport = new HttpTransport({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchRequest,
    });

    await expect(
      transport.callUnmigrated(
        "legacy_command",
        { enabled: true },
        {
          task: "WEB-050",
          callSite: "src/example.ts:1",
          reason: "Awaiting command migration",
        },
      ),
    ).resolves.toEqual({ value: 1 });

    expect(fetchRequest.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:8080/api/v1/rpc/legacy_command",
    );
  });

  it("subscribes, dispatches typed events, and replays after reconnect", async () => {
    vi.useFakeTimers();
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(SESSION));
    const sockets: FakeWebSocket[] = [];
    const transport = new HttpTransport({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchRequest,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
      reconnectDelayMs: 100,
      maxReconnectDelayMs: 100,
    });
    const handler = vi.fn();

    await transport.initialize();
    const subscription = transport.subscribe("connection-health-failed", handler);
    await Promise.resolve();
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    const unsubscribe = await subscription;
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      type: "subscribe",
      events: ["connection-health-failed"],
    });

    sockets[0].message({
      type: "event",
      event: "connection-health-failed",
      payload: { connectionId: "connection-1", error: "offline" },
      sequence: 7,
    });
    expect(handler).toHaveBeenCalledWith({
      connectionId: "connection-1",
      error: "offline",
    });

    sockets[0].disconnect();
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(JSON.parse(sockets[1].sent[0])).toEqual({
      type: "subscribe",
      events: ["connection-health-failed"],
      since: 7,
    });

    unsubscribe();
    expect(JSON.parse(sockets[1].sent[1])).toEqual({
      type: "unsubscribe",
      events: ["connection-health-failed"],
    });
    expect(sockets[1].readyState).toBe(3);
  });

  it("rejects browser-side event emission explicitly", async () => {
    const transport = new HttpTransport({
      fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(SESSION)),
    });

    const error = await transport
      .emit("connections:active-changed", ["connection-1"])
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "EVENT_EMIT_UNSUPPORTED",
      message: "Browser clients cannot publish application events",
    });
  });
});
