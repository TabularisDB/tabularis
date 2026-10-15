import { describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import { loadStartupConfig } from "../../src/utils/startupConfig";

function mockClient() {
  const call = vi.fn();
  return { call, client: { call } as unknown as TabularisClient };
}

describe("loadStartupConfig", () => {
  it("coalesces bootstrap readers without caching subsequent settings edits", async () => {
    const { call, client } = mockClient();
    call.mockResolvedValueOnce({ language: "it" }).mockResolvedValueOnce({ language: "en" });
    const first = loadStartupConfig(client);
    expect(loadStartupConfig(client)).toBe(first);
    expect(await first).toEqual({ language: "it" });
    expect(await loadStartupConfig(client)).toEqual({ language: "en" });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith("get_config", undefined);
  });

  it("allows retry after a failed read", async () => {
    const { call, client } = mockClient();
    call.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({});
    await expect(loadStartupConfig(client)).rejects.toThrow("unavailable");
    await expect(loadStartupConfig(client)).resolves.toEqual({});
  });
});
