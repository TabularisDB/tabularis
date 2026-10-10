import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRightSidebarResize } from "../../src/hooks/useRightSidebarResize";
import { uiStateStore } from "../../src/utils/uiStateStore";

const KEY = "tabularis_row_editor_sidebar_width";

describe("useRightSidebarResize", () => {
  beforeEach(() => {
    localStorage.clear();
    uiStateStore.reset();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1600 });
  });

  it("uses the shared width, clamped to half the viewport", () => {
    uiStateStore.set(KEY, 1200);
    const { result } = renderHook(() => useRightSidebarResize());
    expect(result.current.width).toBe(800);
  });

  it("stores the dragged width in the shared UI state", () => {
    const { result } = renderHook(() => useRightSidebarResize());
    act(() => {
      result.current.startResize({ preventDefault: vi.fn() } as unknown as React.MouseEvent);
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1100 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(result.current.width).toBe(500);
    expect(uiStateStore.get(KEY, 0)).toBe(500);
  });
});
