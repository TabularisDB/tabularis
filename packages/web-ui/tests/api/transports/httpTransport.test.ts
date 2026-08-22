import { afterEach, describe, expect, it, vi } from "vitest";
import { TabularisClientError } from "../../../src/api/errors";
import {
  HttpTransport,
  type WebSocketLike,
} from "../../../src/api/transports/httpTransport";

const SESSION = {
  apiVersion: "v1",
  serverVersion: "0.20.0",
  serverBuild: {
    target: "linux-x86_64",
    profile: "release",
    commit: "abc1234",
  },
  authenticated: true,
  csrfToken: "csrf-token",
  access: {
    remote: false,
    authorizationLevel: "local-admin",
    highRiskCapabilities: true,
  },
  capabilities: {
    rpc: true,
    events: true,
    uploads: false,
    downloads: false,
    pluginAssets: false,
    mcpHostConfiguration: true,
    nativeUpdater: false,
  },
  queryResponsePolicy: {
    maxRowsPerPage: 10_000,
    maxResponseBytes: 16_777_216,
    streaming: false,
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

  it("rejects a browser session that advertises native binary updates", async () => {
    const transport = new HttpTransport({
      fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          ...SESSION,
          capabilities: { ...SESSION.capabilities, nativeUpdater: true },
        }),
      ),
    });

    await expect(transport.initialize()).rejects.toMatchObject({
      code: "INVALID_SESSION_RESPONSE",
    });
  });

  it("rejects an unknown remote authorization policy", async () => {
    const transport = new HttpTransport({
      fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          ...SESSION,
          access: { ...SESSION.access, authorizationLevel: "super-admin" },
        }),
      ),
    });

    await expect(transport.initialize()).rejects.toMatchObject({
      code: "INVALID_SESSION_RESPONSE",
    });
  });

  it("loads authenticated plugin assets when advertised by the server", async () => {
    const pluginSession = {
      ...SESSION,
      capabilities: { ...SESSION.capabilities, pluginAssets: true },
    };
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(pluginSession))
      .mockResolvedValueOnce(
        new Response("window.pluginLoaded = true;", {
          headers: { "content-type": "text/javascript" },
        }),
      );
    const transport = new HttpTransport({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchRequest,
    });

    await expect(
      transport.readPluginAsset("my plugin", "ui/dist/index.js"),
    ).resolves.toBe("window.pluginLoaded = true;");

    expect(fetchRequest.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:8080/api/v1/assets/plugins/my%20plugin/ui/dist/index.js",
    );
    expect(fetchRequest.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("rejects plugin asset reads when the capability is unavailable", async () => {
    const transport = new HttpTransport({
      fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(SESSION)),
    });

    await expect(
      transport.readPluginAsset("plugin", "ui/index.js"),
    ).rejects.toMatchObject({ code: "PLUGIN_ASSETS_UNAVAILABLE" });
  });

  it("uploads connection icons with the authenticated session", async () => {
    const uploadSession = {
      ...SESSION,
      capabilities: { ...SESSION.capabilities, uploads: true },
    };
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(uploadSession))
      .mockResolvedValueOnce(jsonResponse({ token: "opaque-upload-token" }, 201));
    const transport = new HttpTransport({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchRequest,
    });
    const icon = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });

    await expect(transport.uploadConnectionIcon(icon)).resolves.toBe(
      "opaque-upload-token",
    );

    const [url, request] = fetchRequest.mock.calls[1];
    const headers = new Headers(request?.headers);
    expect(url).toBe(
      "http://127.0.0.1:8080/api/v1/uploads/connection-icons",
    );
    expect(request?.body).toBe(icon);
    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("x-tabularis-csrf")).toBe("csrf-token");
  });

  it("streams purpose-bound generic uploads and consumes token downloads", async () => {
    const transferSession = {
      ...SESSION,
      capabilities: {
        ...SESSION.capabilities,
        uploads: true,
        downloads: true,
      },
    };
    const metadata = {
      token: "opaque-file-token",
      fileName: "report.csv",
      mimeType: "text/csv",
      size: 7,
      expiresAt: "2026-08-22T05:30:00Z",
    };
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(transferSession))
      .mockResolvedValueOnce(jsonResponse(metadata, 201))
      .mockResolvedValueOnce(
        new Response("a,b\n1,2", { headers: { "content-type": "text/csv" } }),
      );
    const transport = new HttpTransport({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchRequest,
    });
    const contents = new Blob(["a,b\n1,2"], { type: "text/csv" });

    await expect(
      transport.uploadFile({
        contents,
        fileName: "../report.csv",
        purpose: "connection-import",
      }),
    ).resolves.toEqual(metadata);
    await expect(
      transport.consumeDownload("opaque-file-token").then((file) => file.text()),
    ).resolves.toBe("a,b\n1,2");

    const [uploadUrl, uploadRequest] = fetchRequest.mock.calls[1];
    const uploadHeaders = new Headers(uploadRequest?.headers);
    expect(uploadUrl).toBe("http://127.0.0.1:8080/api/v1/uploads");
    expect(uploadRequest?.body).toBe(contents);
    expect(uploadHeaders.get("x-tabularis-file-name")).toBe("..%2Freport.csv");
    expect(uploadHeaders.get("x-tabularis-purpose")).toBe("connection-import");
    const [downloadUrl] = fetchRequest.mock.calls[2];
    expect(downloadUrl).toBe(
      "http://127.0.0.1:8080/api/v1/downloads/opaque-file-token",
    );
  });

  it("hands generic downloads directly to the browser without buffering", async () => {
    const transferSession = {
      ...SESSION,
      capabilities: { ...SESSION.capabilities, downloads: true },
    };
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(transferSession));
    const startDownload = vi.fn();
    const transport = new HttpTransport({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchRequest,
      startDownload,
    });

    await expect(
      transport.requestDownload("opaque file token"),
    ).resolves.toBeUndefined();

    expect(startDownload).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/api/v1/downloads/opaque%20file%20token",
    );
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it("uploads BLOBs and consumes single-use downloads with the authenticated session", async () => {
    const transferSession = {
      ...SESSION,
      capabilities: {
        ...SESSION.capabilities,
        uploads: true,
        downloads: true,
      },
    };
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(transferSession))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            value:
              "BLOB_UPLOAD_REF:4:image/png:00000000-0000-4000-8000-000000000000",
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          headers: { "content-type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          headers: { "content-type": "image/png" },
        }),
      );
    const transport = new HttpTransport({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchRequest,
    });
    const file = new Blob([bytes], { type: "image/png" });

    await expect(transport.uploadBlob(file)).resolves.toBe(
      "BLOB_UPLOAD_REF:4:image/png:00000000-0000-4000-8000-000000000000",
    );
    expect(
      transport.uploadedBlobUrl("00000000-0000-4000-8000-000000000000"),
    ).toBe(
      "http://127.0.0.1:8080/api/v1/uploads/blobs/00000000-0000-4000-8000-000000000000",
    );
    const uploaded = await transport.readUploadedBlob(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(bytes);
    const downloaded = await transport.consumeBlobDownload(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(downloaded.type).toBe("image/png");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);

    const [uploadUrl, uploadRequest] = fetchRequest.mock.calls[1];
    expect(uploadUrl).toBe("http://127.0.0.1:8080/api/v1/uploads/blobs");
    expect(uploadRequest?.body).toBe(file);
    const [uploadReadUrl, uploadReadRequest] = fetchRequest.mock.calls[2];
    expect(uploadReadUrl).toBe(
      "http://127.0.0.1:8080/api/v1/uploads/blobs/00000000-0000-4000-8000-000000000000",
    );
    expect(uploadReadRequest).toEqual(
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    const [downloadUrl, downloadRequest] = fetchRequest.mock.calls[3];
    expect(downloadUrl).toBe(
      "http://127.0.0.1:8080/api/v1/downloads/11111111-1111-4111-8111-111111111111",
    );
    expect(downloadRequest).toEqual(
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
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

  it("restores active-operation event subscriptions after a browser refresh", async () => {
    const sockets: FakeWebSocket[] = [];
    const createTransport = () =>
      new HttpTransport({
        baseUrl: "http://127.0.0.1:8080",
        fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(SESSION)),
        createWebSocket: () => {
          const socket = new FakeWebSocket();
          sockets.push(socket);
          return socket;
        },
      });

    const beforeRefresh = createTransport();
    await beforeRefresh.initialize();
    const firstSubscription = beforeRefresh.subscribe("query-status", vi.fn());
    await Promise.resolve();
    sockets[0].open();
    const unsubscribeBeforeRefresh = await firstSubscription;
    unsubscribeBeforeRefresh();

    const afterRefresh = createTransport();
    const refreshedHandler = vi.fn();
    await afterRefresh.initialize();
    const refreshedSubscription = afterRefresh.subscribe(
      "query-status",
      refreshedHandler,
    );
    await Promise.resolve();
    sockets[1].open();
    const unsubscribeAfterRefresh = await refreshedSubscription;
    expect(JSON.parse(sockets[1].sent[0])).toEqual({
      type: "subscribe",
      events: ["query-status"],
    });

    sockets[1].message({
      type: "event",
      event: "query-status",
      payload: {
        requestId: "request-active",
        connectionId: "connection-1",
        status: "completed",
      },
      sequence: 9,
    });
    expect(refreshedHandler).toHaveBeenCalledWith({
      requestId: "request-active",
      connectionId: "connection-1",
      status: "completed",
    });

    unsubscribeAfterRefresh();
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
