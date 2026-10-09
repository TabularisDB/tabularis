import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useJsonEditorActivity } from "../../src/hooks/useJsonEditorActivity";

vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: { getByLabel: vi.fn() } }));

describe("editable JSON window activity", () => {
  beforeEach(() => { vi.mocked(WebviewWindow.getByLabel).mockReset(); });

  it("blocks while opening and releases on save, close and unmount", async () => {
    const unlisten = vi.fn();
    let close!: () => void;
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue({ once: vi.fn((_event, handler) => {
      close = handler; return Promise.resolve(unlisten);
    }) } as unknown as WebviewWindow);
    const { result, unmount } = renderHook(useJsonEditorActivity);
    let end!: () => void;
    act(() => { end = result.current.begin(); });
    expect(result.current.isEditing()).toBe(true);
    await act(async () => { await result.current.watch("first", end); });
    expect(WebviewWindow.getByLabel).toHaveBeenCalledWith("json-viewer-first");
    act(() => result.current.release("first"));
    expect(result.current.count).toBe(0);
    expect(unlisten).toHaveBeenCalledOnce();
    act(() => { end = result.current.begin(); });
    await act(async () => { await result.current.watch("second", end); });
    act(() => close());
    expect(result.current.isEditing()).toBe(false);
    act(() => { end = result.current.begin(); });
    await act(async () => { await result.current.watch("third", end); });
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(3);
    expect(result.current.isEditing()).toBe(false);
  });

  it("unsubscribes a listener that resolves after unmount", async () => {
    let finish!: (unlisten: () => void) => void;
    const unlisten = vi.fn();
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue({ once: () => new Promise<() => void>((resolve) => {
      finish = resolve;
    }) } as unknown as WebviewWindow);
    const { result, unmount } = renderHook(useJsonEditorActivity);
    let end!: () => void;
    act(() => { end = result.current.begin(); });
    let watching!: Promise<void>;
    await act(async () => { watching = result.current.watch("late", end); });
    unmount();
    await act(async () => { finish(unlisten); await watching; });
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("releases a window that closed during opening", async () => {
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(null);
    const { result } = renderHook(useJsonEditorActivity);
    let end!: () => void;
    act(() => { end = result.current.begin(); });
    await act(async () => { await result.current.watch("closed", end); });
    expect(result.current.count).toBe(0);
  });

  it("releases a window that closes before its listener is registered", async () => {
    const unlisten = vi.fn();
    vi.mocked(WebviewWindow.getByLabel)
      .mockResolvedValueOnce({ once: vi.fn().mockResolvedValue(unlisten) } as unknown as WebviewWindow)
      .mockResolvedValueOnce(null);
    const { result } = renderHook(useJsonEditorActivity);
    let end!: () => void;
    act(() => { end = result.current.begin(); });
    await act(async () => { await result.current.watch("closing", end); });
    expect(result.current.isEditing()).toBe(false);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("cleans up a stale listener after the same window is reopened", async () => {
    let registerFirst!: (unlisten: () => void) => void;
    let staleClose!: () => void;
    const staleUnlisten = vi.fn();
    const currentUnlisten = vi.fn();
    const once = vi.fn()
      .mockImplementationOnce((_event, handler) => {
        staleClose = handler;
        return new Promise<() => void>((resolve) => { registerFirst = resolve; });
      })
      .mockResolvedValue(currentUnlisten);
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue({ once } as unknown as WebviewWindow);
    const { result, unmount } = renderHook(useJsonEditorActivity);
    let end!: () => void;
    act(() => { end = result.current.begin(); });
    let first!: Promise<void>;
    await act(async () => { first = result.current.watch("same", end); });
    act(() => { end = result.current.begin(); });
    await act(async () => { await result.current.watch("same", end); });
    act(() => staleClose());
    expect(result.current.count).toBe(1);
    await act(async () => { registerFirst(staleUnlisten); await first; });
    expect(staleUnlisten).toHaveBeenCalledOnce();
    expect(result.current.count).toBe(1);
    unmount();
    expect(currentUnlisten).toHaveBeenCalledOnce();
  });
});
