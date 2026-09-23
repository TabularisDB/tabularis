import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUPPORT_PROMPT_DISMISSED_KEY,
  dismissSupportPrompt,
  isSupportPromptDismissed,
  subscribeToSupportPrompt,
} from "../../src/utils/supportPrompt";

describe("supportPrompt", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults to visible and only treats true as dismissed", () => {
    expect(isSupportPromptDismissed()).toBe(false);
    for (const value of ["false", "", "invalid"]) {
      localStorage.setItem(SUPPORT_PROMPT_DISMISSED_KEY, value);
      expect(isSupportPromptDismissed()).toBe(false);
    }
    dismissSupportPrompt();
    expect(isSupportPromptDismissed()).toBe(true);
  });

  it("handles unavailable storage reads without breaking the changelog", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(isSupportPromptDismissed()).toBe(false);
  });

  it("persists dismissal before notifying local subscribers and unsubscribes", () => {
    const listener = vi.fn(() => expect(isSupportPromptDismissed()).toBe(true));
    const unsubscribe = subscribeToSupportPrompt(listener);
    try {
      dismissSupportPrompt();
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
    dismissSupportPrompt();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("notifies on relevant cross-window changes and clearing storage only", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSupportPrompt(listener);
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
      expect(listener).not.toHaveBeenCalled();
      window.dispatchEvent(new StorageEvent("storage", { key: SUPPORT_PROMPT_DISMISSED_KEY }));
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
    window.dispatchEvent(new StorageEvent("storage", { key: SUPPORT_PROMPT_DISMISSED_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("propagates write failures without notifying subscribers", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const listener = vi.fn();
    const unsubscribe = subscribeToSupportPrompt(listener);
    try {
      expect(dismissSupportPrompt).toThrow("Storage unavailable");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
