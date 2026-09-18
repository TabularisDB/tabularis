import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadStartupConfig } from "../../src/utils/startupConfig";

describe("loadStartupConfig", () => {
  it("coalesces bootstrap readers without caching subsequent settings edits", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ language: "it" }).mockResolvedValueOnce({ language: "en" });
    const first = loadStartupConfig();
    expect(loadStartupConfig()).toBe(first);
    expect(await first).toEqual({ language: "it" });
    expect(await loadStartupConfig()).toEqual({ language: "en" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("allows retry after a failed read", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({});
    await expect(loadStartupConfig()).rejects.toThrow("unavailable");
    await expect(loadStartupConfig()).resolves.toEqual({});
  });
});
