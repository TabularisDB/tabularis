import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcPort } from "../../src/plugins/sandbox/rpc";

describe("sandbox RPC timeout", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects a request when its peer does not respond", async () => {
    vi.useFakeTimers();
    const channel = new MessageChannel();
    const rpc = new RpcPort(channel.port1, () => new Promise(() => undefined));
    const pending = rpc.call("explain.parse", ["json", "{}"]);
    const rejection = expect(pending).rejects.toThrow("Plugin RPC timed out: explain.parse");

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;

    rpc.close();
    channel.port2.close();
  });
});
