import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import {
  SUPPORT_PROMPT_DISMISSED_KEY,
  dismissSupportPrompt,
  isSupportPromptDismissed,
  subscribeToSupportPrompt,
} from "../../src/utils/supportPrompt";
import { uiStateStore } from "../../src/utils/uiStateStore";

function attachClient(call = vi.fn(async (command: string) => (command === "get_ui_state" ? {} : undefined))) {
  const client = {
    call,
    subscribe: vi.fn(async () => () => {}),
  } as unknown as TabularisClient;
  const detach = uiStateStore.attach(client);
  return { call, detach };
}

describe("supportPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    uiStateStore.reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("defaults to visible and only treats true as dismissed", async () => {
    expect(isSupportPromptDismissed()).toBe(false);
    uiStateStore.set(SUPPORT_PROMPT_DISMISSED_KEY, "true");
    expect(isSupportPromptDismissed()).toBe(false);
    await dismissSupportPrompt();
    expect(isSupportPromptDismissed()).toBe(true);
  });

  it("persists dismissal in the shared store before notifying subscribers", async () => {
    const { call, detach } = attachClient();
    const listener = vi.fn(() => expect(isSupportPromptDismissed()).toBe(true));
    await Promise.resolve();
    const unsubscribe = subscribeToSupportPrompt(listener);
    try {
      await dismissSupportPrompt();
      expect(call).toHaveBeenCalledWith("set_ui_state", {
        key: SUPPORT_PROMPT_DISMISSED_KEY,
        value: true,
      });
      expect(listener).toHaveBeenCalled();
    } finally {
      unsubscribe();
      detach();
    }
  });

  it("propagates write failures without notifying subscribers", async () => {
    const { detach } = attachClient(
      vi.fn(async (command: string) => {
        if (command === "get_ui_state") return {};
        throw new Error("Storage unavailable");
      }),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeToSupportPrompt(listener);
    try {
      await expect(dismissSupportPrompt()).rejects.toThrow("Storage unavailable");
      expect(isSupportPromptDismissed()).toBe(false);
    } finally {
      unsubscribe();
      detach();
    }
  });
});
