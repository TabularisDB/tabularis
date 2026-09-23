/// <reference types="vitest/jsdom" />
import { afterEach, describe, expect, it, vi } from "vitest";

// Capture during module evaluation, before any test hooks can repair the globals.
const initialStorage = {
  localStorage: globalThis.localStorage,
  sessionStorage: globalThis.sessionStorage,
};

describe("jsdom storage environment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    jsdom.window.localStorage.clear();
    jsdom.window.sessionStorage.clear();
  });

  it.each(["localStorage", "sessionStorage"] as const)(
    "%s uses this test environment's browser storage before test imports",
    (name) => {
      const storage = initialStorage[name];
      expect(storage).toBe(jsdom.window[name]);
      expect(storage).toBeInstanceOf(jsdom.window.Storage);
      storage.setItem("storage-regression", "value");
      expect(window[name].getItem("storage-regression")).toBe("value");
      expect(storage.key(0)).toBe("storage-regression");
      storage.removeItem("storage-regression");
      expect(storage.length).toBe(0);
    },
  );

  it("keeps local and session storage separate", () => {
    localStorage.setItem("shared-key", "local");
    sessionStorage.setItem("shared-key", "session");
    localStorage.clear();
    expect(sessionStorage.getItem("shared-key")).toBe("session");
  });

  it("restores browser storage after a test replaces a global", () => {
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("sessionStorage", undefined);
    vi.unstubAllGlobals();
    expect(localStorage).toBe(jsdom.window.localStorage);
    expect(sessionStorage).toBe(jsdom.window.sessionStorage);
  });
});
