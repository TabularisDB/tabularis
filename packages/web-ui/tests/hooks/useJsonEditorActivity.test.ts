import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useJsonEditorActivity } from "../../src/hooks/useJsonEditorActivity";

describe("editable JSON window activity", () => {
  it("blocks while opening and releases each editor independently", () => {
    const { result } = renderHook(useJsonEditorActivity);
    let first!: () => void;
    let second!: () => void;
    act(() => { first = result.current.begin(); second = result.current.begin(); });
    expect(result.current.count).toBe(2);
    expect(result.current.isEditing()).toBe(true);
    act(() => first());
    expect(result.current.count).toBe(1);
    // Save, close, or a failed open can all release the same activity safely.
    act(() => first());
    expect(result.current.count).toBe(1);
    act(() => second());
    expect(result.current.isEditing()).toBe(false);
  });

  it("clears activity on unmount and accepts a late window close", () => {
    const { result, unmount } = renderHook(useJsonEditorActivity);
    let end!: () => void;
    act(() => { end = result.current.begin(); });
    unmount();
    expect(result.current.isEditing()).toBe(false);
    expect(() => end()).not.toThrow();
  });
});
