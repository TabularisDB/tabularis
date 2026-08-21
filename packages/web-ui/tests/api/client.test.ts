import { describe, expect, it, vi } from "vitest";
import { TabularisClient, type TabularisTransport } from "../../src/api/client";
import type { RequestId } from "../../src/api/errors";

const createTransport = () =>
  ({
    call: vi.fn(),
    callUnmigrated: vi.fn(),
    subscribe: vi.fn(),
    emit: vi.fn(),
  }) as unknown as TabularisTransport;

describe("TabularisClient", () => {
  it("delegates typed and unmigrated commands to its transport", async () => {
    const transport = createTransport();
    const client = new TabularisClient(transport);
    const requestId = "request-1" as RequestId;

    vi.mocked(transport.call).mockResolvedValueOnce(true);
    vi.mocked(transport.callUnmigrated).mockResolvedValueOnce({ value: 1 });

    await expect(
      client.call("is_debug_mode", undefined, { requestId }),
    ).resolves.toBe(true);
    await expect(
      client.callUnmigrated(
        "legacy_command",
        { enabled: true },
        {
          task: "WEB-050",
          callSite: "src/example.ts:1",
          reason: "Awaiting its command-group migration",
        },
        { requestId },
      ),
    ).resolves.toEqual({ value: 1 });

    expect(transport.call).toHaveBeenCalledWith("is_debug_mode", undefined, {
      requestId,
    });
    expect(transport.callUnmigrated).toHaveBeenCalledWith(
      "legacy_command",
      { enabled: true },
      {
        task: "WEB-050",
        callSite: "src/example.ts:1",
        reason: "Awaiting its command-group migration",
      },
      { requestId },
    );
  });

  it("delegates subscriptions and emitted events to its transport", async () => {
    const transport = createTransport();
    const client = new TabularisClient(transport);
    const handler = vi.fn();
    const unsubscribe = vi.fn();
    const payload = ["connection-1"];

    vi.mocked(transport.subscribe).mockResolvedValueOnce(unsubscribe);

    await expect(
      client.subscribe("connections:active-changed", handler),
    ).resolves.toBe(unsubscribe);
    await client.emit("connections:active-changed", payload);

    expect(transport.subscribe).toHaveBeenCalledWith(
      "connections:active-changed",
      handler,
    );
    expect(transport.emit).toHaveBeenCalledWith(
      "connections:active-changed",
      payload,
    );
  });
});
