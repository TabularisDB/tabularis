import { invoke } from "@tauri-apps/api/core";
import {
  emit,
  listen,
  type EventCallback,
} from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriTransport } from "../../../src/api/transports/tauriTransport";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(),
}));

describe("TauriTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates typed and unmigrated commands to Tauri invoke", async () => {
    const transport = new TauriTransport();

    vi.mocked(invoke)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ value: 1 });

    await expect(transport.call("is_debug_mode", undefined)).resolves.toBe(true);
    await expect(
      transport.callUnmigrated(
        "legacy_command",
        { enabled: true },
        {
          task: "WEB-050",
          callSite: "src/example.ts:1",
          reason: "Awaiting its command-group migration",
        },
      ),
    ).resolves.toEqual({ value: 1 });

    expect(invoke).toHaveBeenNthCalledWith(1, "is_debug_mode", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "legacy_command", {
      enabled: true,
    });
  });

  it("loads plugin assets through the desktop command adapter", async () => {
    const transport = new TauriTransport();
    vi.mocked(invoke).mockResolvedValueOnce("window.pluginLoaded = true;");

    await expect(
      transport.readPluginAsset("plugin-id", "ui/dist/index.js"),
    ).resolves.toBe("window.pluginLoaded = true;");

    expect(invoke).toHaveBeenCalledWith("read_plugin_file", {
      pluginId: "plugin-id",
      filePath: "ui/dist/index.js",
    });
  });

  it("normalizes Tauri failures to the shared frontend error model", async () => {
    const transport = new TauriTransport();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("query failed"));

    const error = await transport
      .call("is_debug_mode", undefined, { requestId: "request-tauri" })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "TabularisClientError",
      code: "TAURI_COMMAND_FAILED",
      message: "query failed",
      details: null,
      requestId: "request-tauri",
    });
  });

  it("unwraps Tauri event payloads and returns the unlisten callback", async () => {
    const transport = new TauriTransport();
    const handler = vi.fn();
    const unlisten = vi.fn();
    let callback:
      | EventCallback<{ connectionId: string; error: string }>
      | undefined;

    vi.mocked(listen).mockImplementationOnce((_event, eventHandler) => {
      callback = eventHandler as EventCallback<{
        connectionId: string;
        error: string;
      }>;
      return Promise.resolve(unlisten);
    });

    await expect(
      transport.subscribe("connection-health-failed", handler),
    ).resolves.toBe(unlisten);

    callback?.({
      event: "connection-health-failed",
      id: 1,
      payload: { connectionId: "connection-1", error: "offline" },
    });

    expect(listen).toHaveBeenCalledWith(
      "connection-health-failed",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledWith({
      connectionId: "connection-1",
      error: "offline",
    });
  });

  it("delegates typed event payloads to Tauri emit", async () => {
    const transport = new TauriTransport();
    const payload = ["connection-1"];

    vi.mocked(emit).mockResolvedValueOnce(undefined);

    await transport.emit("connections:active-changed", payload);

    expect(emit).toHaveBeenCalledWith("connections:active-changed", payload);
  });
});
