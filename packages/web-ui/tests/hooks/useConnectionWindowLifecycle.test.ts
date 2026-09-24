import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useConnectionWindowLifecycle } from "../../src/hooks/useConnectionWindowLifecycle";

const closeMock = vi.fn();
let globallyOpen: string[] = [];

vi.mock("../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({ closeRoute: closeMock }),
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
    globallyOpen = [];
    setUrl("/");
  });

  it("never closes the main window", () => {
    setUrl("/?connect=conn-1");
    globallyOpen = [];
    renderHook(() => useConnectionWindowLifecycle());
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("does not close a dedicated window before its connection has opened", () => {
    setUrl("/connections?connect=conn-1&standalone=connection");
    globallyOpen = []; // not open yet
    renderHook(() => useConnectionWindowLifecycle());
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("closes a dedicated window once its connection was open and then closes", () => {
    setUrl("/connections?connect=conn-1&standalone=connection");
    globallyOpen = ["conn-1"];
    const { rerender } = renderHook(() => useConnectionWindowLifecycle());
    expect(closeMock).not.toHaveBeenCalled();

    // Connection disconnected elsewhere -> disappears from the global set.
    globallyOpen = [];
    rerender();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("ignores changes to other connections", () => {
    setUrl("/connections?connect=conn-1&standalone=connection");
    globallyOpen = ["conn-1", "conn-2"];
    const { rerender } = renderHook(() => useConnectionWindowLifecycle());

    globallyOpen = ["conn-1"]; // conn-2 closed, ours still open
    rerender();
    expect(closeMock).not.toHaveBeenCalled();
  });
});
