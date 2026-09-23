import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import { DEFAULT_SETTINGS } from "../../src/contexts/SettingsContext";
import { detectAiDefaults } from "../../src/utils/aiDefaults";

const call = vi.fn();
const client = { call } as unknown as TabularisClient;

describe("detectAiDefaults", () => {
  beforeEach(() => call.mockReset());

  it("does no work when AI is disabled or already configured", async () => {
    await detectAiDefaults(client, { ...DEFAULT_SETTINGS, aiEnabled: false });
    await detectAiDefaults(client, { ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: "openai", aiModel: "chosen" });
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps the selected provider and requests cached models", async () => {
    call.mockResolvedValue({ anthropic: ["model-a"], openai: ["model-b"] });
    const result = await detectAiDefaults(client, { ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: "anthropic", aiModel: null });
    expect(result).toEqual({ aiProvider: "anthropic", aiModel: "model-a" });
    expect(call).toHaveBeenCalledExactlyOnceWith("get_ai_models", { forceRefresh: false });
  });

  it("preserves provider priority even if a key lookup fails", async () => {
    call.mockImplementation(async (command: string, args: { provider?: string } | undefined) => {
      const provider = args?.provider;
      if (command === "check_ai_key") {
        if (provider === "openai") throw new Error("key unavailable");
        return true;
      }
      return { anthropic: ["model-a"] };
    });
    expect(await detectAiDefaults(client, { ...DEFAULT_SETTINGS, aiEnabled: true, aiProvider: null, aiModel: null }))
      .toEqual({ aiProvider: "anthropic", aiModel: "model-a" });
  });
});
