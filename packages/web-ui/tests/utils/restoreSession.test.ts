import { describe, expect, it, vi } from "vitest";
import { restoreSession } from "../../src/utils/restoreSession";

describe("restoreSession", () => {
  it("opens the active connection before slower background connections", async () => {
    let finishBackground!: () => void;
    const ready = vi.fn();
    const connect = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(() =>
      new Promise<void>((resolve) => { finishBackground = resolve; }));
    const pending = restoreSession({ connectionIds: ["slow", "active", "slow"], activeId: "active", connect,
      onForegroundStart: vi.fn(), onForegroundReady: ready, onError: vi.fn() });
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls).toEqual([["active", { activate: true }], ["slow", { activate: false }]]);
    finishBackground();
    await pending;
  });

  it("falls back to the next connection after a failed preferred connection", async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const onError = vi.fn();
    const ready = vi.fn();
    await restoreSession({ connectionIds: ["one", "two", "three"], activeId: "two", connect,
      onForegroundStart: vi.fn(), onForegroundReady: ready, onError });
    expect(connect.mock.calls).toEqual([["two", { activate: true }], ["one", { activate: true }], ["three", { activate: false }]]);
    expect(onError).toHaveBeenCalledWith("two", expect.any(Error));
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("does not navigate for an empty or entirely unavailable session", async () => {
    const ready = vi.fn();
    const options = { activeId: null, connect: vi.fn().mockRejectedValue("offline"),
      onForegroundStart: vi.fn(), onForegroundReady: ready, onError: vi.fn() };
    await restoreSession({ ...options, connectionIds: [] });
    await restoreSession({ ...options, connectionIds: ["missing"] });
    expect(ready).not.toHaveBeenCalled();
  });
});
