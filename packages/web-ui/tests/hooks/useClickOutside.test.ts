import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useClickOutside } from "../../src/hooks/useClickOutside";

describe("useClickOutside", () => {
  let inside: HTMLDivElement;
  let outside: HTMLDivElement;

  beforeEach(() => {
    inside = document.createElement("div");
    outside = document.createElement("div");
    document.body.appendChild(inside);
    document.body.appendChild(outside);
  });

  afterEach(() => {
    inside.remove();
    outside.remove();
  });

  const mouseDownOn = (target: HTMLElement) => {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  };

  it("calls the handler on mousedown outside the element", () => {
    const onOutside = vi.fn();
    renderHook(() => useClickOutside({ current: inside }, onOutside, true));

    mouseDownOn(outside);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("does not call the handler on mousedown inside the element", () => {
    const onOutside = vi.fn();
    renderHook(() => useClickOutside({ current: inside }, onOutside, true));

    mouseDownOn(inside);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does not call the handler on a nested child of the element", () => {
    const child = document.createElement("button");
    inside.appendChild(child);
    const onOutside = vi.fn();
    renderHook(() => useClickOutside({ current: inside }, onOutside, true));

    mouseDownOn(child);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const onOutside = vi.fn();
    renderHook(() => useClickOutside({ current: inside }, onOutside, false));

    mouseDownOn(outside);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("starts listening when enabled flips to true", () => {
    const onOutside = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useClickOutside({ current: inside }, onOutside, enabled),
      { initialProps: { enabled: false } },
    );

    mouseDownOn(outside);
    expect(onOutside).not.toHaveBeenCalled();

    rerender({ enabled: true });
    mouseDownOn(outside);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("uses the latest handler without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }) => useClickOutside({ current: inside }, handler, true),
      { initialProps: { handler: first } },
    );

    rerender({ handler: second });
    mouseDownOn(outside);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unmount", () => {
    const onOutside = vi.fn();
    const { unmount } = renderHook(() =>
      useClickOutside({ current: inside }, onOutside, true),
    );

    unmount();
    mouseDownOn(outside);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("ignores events when the ref has no element", () => {
    const onOutside = vi.fn();
    renderHook(() => useClickOutside({ current: null }, onOutside, true));

    mouseDownOn(outside);
    expect(onOutside).not.toHaveBeenCalled();
  });
});
