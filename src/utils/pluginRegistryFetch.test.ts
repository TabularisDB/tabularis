import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

describe("fetchPluginRegistry", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.resetModules();
  });

  it("dedupes concurrent non-force fetches into one invoke", async () => {
    let resolveInvoke!: (value: unknown[]) => void;
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve as (value: unknown[]) => void;
        }),
    );

    const { fetchPluginRegistry } = await import("./pluginRegistryFetch");
    const a = fetchPluginRegistry();
    const b = fetchPluginRegistry();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("fetch_plugin_registry", {
      force: false,
    });

    resolveInvoke([]);
    await expect(Promise.all([a, b])).resolves.toEqual([[], []]);
  });

  it("serves a second call from memory within TTL", async () => {
    invoke.mockResolvedValue([{ id: "postgresql" }]);
    const { fetchPluginRegistry } = await import("./pluginRegistryFetch");
    const first = await fetchPluginRegistry();
    const second = await fetchPluginRegistry();
    expect(first).toEqual([{ id: "postgresql" }]);
    expect(second).toEqual([{ id: "postgresql" }]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("force bypasses the memory cache", async () => {
    invoke
      .mockResolvedValueOnce([{ id: "a" }])
      .mockResolvedValueOnce([{ id: "b" }]);
    const { fetchPluginRegistry } = await import("./pluginRegistryFetch");
    await fetchPluginRegistry();
    const forced = await fetchPluginRegistry({ force: true });
    expect(forced).toEqual([{ id: "b" }]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(2, "fetch_plugin_registry", {
      force: true,
    });
  });

  it("dedupes concurrent force fetches into one invoke", async () => {
    let resolveInvoke!: (value: unknown[]) => void;
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve as (value: unknown[]) => void;
        }),
    );

    const { fetchPluginRegistry } = await import("./pluginRegistryFetch");
    const a = fetchPluginRegistry({ force: true });
    const b = fetchPluginRegistry({ force: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    resolveInvoke([]);
    await expect(Promise.all([a, b])).resolves.toEqual([[], []]);
  });
});
