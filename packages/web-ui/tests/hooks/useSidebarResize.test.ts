import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSidebarResize } from "../../src/hooks/useSidebarResize";
import { UI_STATE_CACHE_KEY, uiStateStore } from "../../src/utils/uiStateStore";

describe("useSidebarResize", () => {
  beforeEach(() => {
    localStorage.clear();
    uiStateStore.reset();
    vi.restoreAllMocks();
  });

  it("should initialize with default width (256)", () => {
    const { result } = renderHook(() => useSidebarResize());
    expect(result.current.sidebarWidth).toBe(256);
  });

  it("should initialize with the width an older version saved in localStorage", () => {
    localStorage.setItem("tabularis_sidebar_width", "300");
    uiStateStore.reset();
    const { result } = renderHook(() => useSidebarResize());
    expect(result.current.sidebarWidth).toBe(300);
  });

  it("should update width on resize", () => {
    const { result } = renderHook(() => useSidebarResize());
    const { startResize } = result.current;

    // Simulate start resize
    const preventDefault = vi.fn();
    startResize({ preventDefault } as unknown as React.MouseEvent);

    expect(document.body.style.cursor).toBe("col-resize");

    // Simulate mouse move (new width = 1000 - 64 = 936 -> clamped to 600)
    // Actually let's try a valid width. 300 + 64 = 364
    act(() => {
      const moveEvent = new MouseEvent("mousemove", { clientX: 364 });
      document.dispatchEvent(moveEvent);
    });

    expect(result.current.sidebarWidth).toBe(300);
  });

  it("should clamp width between MIN (150) and MAX (600)", () => {
    const { result } = renderHook(() => useSidebarResize());
    const { startResize } = result.current;

    const preventDefault = vi.fn();
    startResize({ preventDefault } as unknown as React.MouseEvent);

    // Try too small (100 - 64 = 36 < 150) -> should not update (remains 256)
    act(() => {
      const moveEvent = new MouseEvent("mousemove", { clientX: 100 });
      document.dispatchEvent(moveEvent);
    });
    expect(result.current.sidebarWidth).toBe(256); // No update

    // Try too large (1000 - 64 = 936 > 600) -> should not update
    act(() => {
      const moveEvent = new MouseEvent("mousemove", { clientX: 1000 });
      document.dispatchEvent(moveEvent);
    });
    expect(result.current.sidebarWidth).toBe(256); // No update
  });

  it("should stop resizing on mouseup and save to the shared UI state", () => {
    const { result } = renderHook(() => useSidebarResize());
    const { startResize } = result.current;

    const preventDefault = vi.fn();
    startResize({ preventDefault } as unknown as React.MouseEvent);

    // Move to valid width
    act(() => {
      const moveEvent = new MouseEvent("mousemove", { clientX: 364 }); // 300px
      document.dispatchEvent(moveEvent);
    });

    // Stop resize
    act(() => {
      const upEvent = new MouseEvent("mouseup");
      document.dispatchEvent(upEvent);
    });

    expect(document.body.style.cursor).toBe("default");
    expect(uiStateStore.get("tabularis_sidebar_width", 0)).toBe(300);
    // Mirrored for the next first paint, so the sidebar does not jump.
    expect(JSON.parse(localStorage.getItem(UI_STATE_CACHE_KEY) ?? "{}")).toEqual({
      tabularis_sidebar_width: 300,
    });
  });
});
