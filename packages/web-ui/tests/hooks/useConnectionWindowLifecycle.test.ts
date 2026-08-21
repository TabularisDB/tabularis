import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConnectionWindowLifecycle } from "../../src/hooks/useConnectionWindowLifecycle";

const closeMock = vi.fn();
let windowLabel = "main";
let globallyOpen: string[] = [];

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ label: windowLabel, close: closeMock })),
}));

vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ globallyOpenConnectionIds: globallyOpen }),
}));

const setUrl = (search: string) => {
  window.history.pushState({}, "", search);
};

describe("useConnectionWindowLifecycle", () => {
  beforeEach(() => {
    closeMock.mockReset();
    vi.mocked(getCurrentWindow).mockClear();
    windowLabel = "main";
    globallyOpen = [];
    setUrl("/");
  });

  it("never closes the main window", () => {
    windowLabel = "main";
    setUrl("/?connect=conn-1");
    globallyOpen = [];
    renderHook(() => useConnectionWindowLifecycle());
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("does not close a dedicated window before its connection has opened", () => {
    windowLabel = "connection-window-conn-1";
    setUrl("/?connect=conn-1");
    globallyOpen = []; // not open yet
    renderHook(() => useConnectionWindowLifecycle());
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("closes a dedicated window once its connection was open and then closes", () => {
    windowLabel = "connection-window-conn-1";
    setUrl("/?connect=conn-1");
    globallyOpen = ["conn-1"];
    const { rerender } = renderHook(() => useConnectionWindowLifecycle());
    expect(closeMock).not.toHaveBeenCalled();

    // Connection disconnected elsewhere -> disappears from the global set.
    globallyOpen = [];
    rerender();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("ignores changes to other connections", () => {
    windowLabel = "connection-window-conn-1";
    setUrl("/?connect=conn-1");
    globallyOpen = ["conn-1", "conn-2"];
    const { rerender } = renderHook(() => useConnectionWindowLifecycle());

    globallyOpen = ["conn-1"]; // conn-2 closed, ours still open
    rerender();
    expect(closeMock).not.toHaveBeenCalled();
  });
});
