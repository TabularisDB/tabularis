// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRowEditorResize } from "../../src/hooks/useRowEditorResize";

const STORAGE_KEY = "tabularis_row_editor_sidebar_width";

const createLocalStorageStub = () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
};

describe("useRowEditorResize", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: createLocalStorageStub(),
    });
    vi.restoreAllMocks();
    // Pin innerWidth so clamps are deterministic.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1600,
    });
  });

  it("initializes with the default width when localStorage is empty", () => {
    const { result } = renderHook(() => useRowEditorResize());
    expect(result.current.width).toBe(384);
  });

  it("reads a persisted width from localStorage", () => {
    window.localStorage.setItem(STORAGE_KEY, "720");
    const { result } = renderHook(() => useRowEditorResize());
    expect(result.current.width).toBe(720);
  });

  it("never starts below the minimum even if localStorage was corrupted", () => {
    window.localStorage.setItem(STORAGE_KEY, "50");
    const { result } = renderHook(() => useRowEditorResize());
    expect(result.current.width).toBe(320);
  });

  it("widens when the mouse moves left (toward smaller clientX)", () => {
    const { result } = renderHook(() => useRowEditorResize());

    act(() => {
      result.current.startResize({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });
    expect(document.body.style.cursor).toBe("col-resize");

    // clientX = 1000  →  width = 1600 - 1000 = 600
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1000 }));
    });
    expect(result.current.width).toBe(600);
  });

  it("clamps below the minimum width", () => {
    const { result } = renderHook(() => useRowEditorResize());

    act(() => {
      result.current.startResize({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    // clientX = 1500  →  raw width = 100, below MIN 320
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1500 }));
    });
    expect(result.current.width).toBe(320);
  });

  it("clamps above the maximum width (90% of viewport)", () => {
    const { result } = renderHook(() => useRowEditorResize());

    act(() => {
      result.current.startResize({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    // clientX = 0  →  raw width = 1600, max is floor(1600 * 0.9) = 1440
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0 }));
    });
    expect(result.current.width).toBe(1440);
  });

  it("stops resizing on mouseup and persists the final width", () => {
    const { result } = renderHook(() => useRowEditorResize());

    act(() => {
      result.current.startResize({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1100 }));
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("500");
  });
});
