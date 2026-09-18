import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS } from "../../src/contexts/SettingsContext";
import { detectAiDefaults } from "../../src/utils/aiDefaults";

describe("detectAiDefaults", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("does no work when AI is disabled or already configured", async () => {
    await detectAiDefaults({ ...DEFAULT_SETTINGS, aiEnabled: false });
    await detectAiDefaults({ ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: "openai", aiModel: "chosen" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the selected provider and requests cached models", async () => {
    vi.mocked(invoke).mockResolvedValue({ anthropic: ["model-a"], openai: ["model-b"] });
    const result = await detectAiDefaults({ ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: "anthropic", aiModel: null });
    expect(result).toEqual({ aiProvider: "anthropic", aiModel: "model-a" });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("get_ai_models", { forceRefresh: false });
  });

  it("preserves provider priority even if a key lookup fails", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const provider = (args as { provider?: string } | undefined)?.provider;
      if (command === "check_ai_key") {
        if (provider === "openai") throw new Error("key unavailable");
        return true;
      }
      return { anthropic: ["model-a"] };
    });
    expect(await detectAiDefaults({ ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: null, aiModel: null }))
      .toEqual({ aiProvider: "anthropic", aiModel: "model-a" });
  });
});
