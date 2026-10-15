import { describe, expect, it, vi } from "vitest";
import type { TabularisTransport } from "../../src/api/client";
import {
  bootstrapTabularisClient,
  bootstrapTabularisRuntime,
} from "../../src/api/bootstrap";
import type { SessionNegotiation } from "../../src/api/session";

const transport = (): TabularisTransport =>
  ({
    call: vi.fn().mockResolvedValue(true),
    callUnmigrated: vi.fn(),
    subscribe: vi.fn(),
    emit: vi.fn(),
  }) as unknown as TabularisTransport;

const session: SessionNegotiation = {
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
    serverFileBrowser: false,
    nativeUpdater: false,
  },
  queryResponsePolicy: {
    maxRowsPerPage: 10_000,
    maxResponseBytes: 16_777_216,
    streaming: false,
  },
};

describe("bootstrapTabularisClient", () => {
  it("selects Tauri without starting a browser session", async () => {
    const tauriTransport = transport();
    const createTauriTransport = vi.fn(() => tauriTransport);
    const createHttpTransport = vi.fn();

    const client = await bootstrapTabularisClient("tauri", {
      createTauriTransport,
      createHttpTransport,
    });

    await expect(client.call("is_debug_mode", undefined)).resolves.toBe(true);
    expect(createTauriTransport).toHaveBeenCalledOnce();
    expect(createHttpTransport).not.toHaveBeenCalled();
  });

  it("negotiates the browser session before returning the client", async () => {
    const browserTransport = Object.assign(transport(), {
      initialize: vi.fn().mockResolvedValue(session),
    });
    const createTauriTransport = vi.fn();
    const createHttpTransport = vi.fn(() => browserTransport);

    const client = await bootstrapTabularisClient("browser", {
      createTauriTransport,
      createHttpTransport,
    });

    expect(browserTransport.initialize).toHaveBeenCalledOnce();
    expect(createHttpTransport).toHaveBeenCalledOnce();
    expect(createTauriTransport).not.toHaveBeenCalled();
    await expect(client.call("is_debug_mode", undefined)).resolves.toBe(true);
  });

  it("retains negotiated server build information for browser providers", async () => {
    const browserTransport = Object.assign(transport(), {
      initialize: vi.fn().mockResolvedValue(session),
    });

    const runtime = await bootstrapTabularisRuntime("browser", {
      createHttpTransport: () => browserTransport,
    });

    expect(runtime.session).toEqual(session);
    expect(runtime.session?.capabilities.nativeUpdater).toBe(false);
    expect(runtime.session?.serverBuild).toEqual({
      target: "linux-x86_64",
      profile: "release",
      commit: "abc1234",
    });
  });
});
