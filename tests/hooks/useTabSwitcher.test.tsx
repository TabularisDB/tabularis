import { StrictMode, type ReactNode } from "react";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "../../src/contexts/EditorProvider";
import { useEditor } from "../../src/hooks/useEditor";
import { useTabSwitcher } from "../../src/hooks/useTabSwitcher";
import { createInitialTabState } from "../../src/utils/editor";

const state = vi.hoisted(() => ({ connectionId: "one", enabled: true }));
vi.mock("../../src/hooks/useDatabase", () => ({ useDatabase: () => ({ activeConnectionId: state.connectionId }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: { connectionId?: string }) => {
  if (command === "load_editor_preferences") {
    const connectionId = args.connectionId!;
    return { tabs: ["a", "b", "c"].map((id) => createInitialTabState(connectionId, { id: `${connectionId}-${id}`, title: id })),
      active_tab_id: `${connectionId}-a` };
  }
  return null;
}) }));

const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><EditorProvider>{children}</EditorProvider></StrictMode>;
function setup() {
  return renderHook(() => {
    const editor = useEditor();
    const switcher = useTabSwitcher({ ...editor, connectionId: state.connectionId, enabled: state.enabled });
    return { editor, switcher };
  }, { wrapper });
}
const step = (backwards = false) => fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: backwards });
const release = () => fireEvent.keyUp(window, { key: "Control" });

describe("useTabSwitcher with EditorProvider", () => {
  beforeEach(() => { state.connectionId = "one"; state.enabled = true; });

  it("goes from C to previously visited A, freezes the list, and commits on release", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.editor.tabs).toHaveLength(3));
    act(() => result.current.editor.setActiveTabId("one-c"));
    expect(result.current.editor.getRecentTabIds()).toEqual(["one-c", "one-a", "one-b"]);
    act(() => step());
    expect(result.current.editor.activeTabId).toBe("one-a");
    expect(result.current.switcher.tabs.map((tab) => tab.id)).toEqual(["one-c", "one-a", "one-b"]);
    act(() => step());
    expect(result.current.editor.activeTabId).toBe("one-b");
    expect(result.current.editor.getRecentTabIds()).toEqual(["one-c", "one-a", "one-b"]);
    act(() => release());
    expect(result.current.switcher.isOpen).toBe(false);
    expect(result.current.editor.getRecentTabIds()).toEqual(["one-b", "one-c", "one-a"]);
    act(() => { step(); release(); });
    expect(result.current.editor.activeTabId).toBe("one-c");
  });

  it("handles rapid presses and reverses direction within the same snapshot", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.editor.tabs).toHaveLength(3));
    act(() => { step(); step(); });
    expect(result.current.editor.activeTabId).toBe("one-c");
    act(() => step(true));
    expect(result.current.editor.activeTabId).toBe("one-b");
    act(() => step(true));
    expect(result.current.editor.activeTabId).toBe("one-a");
    act(() => release());
  });

  it("removes closed tabs from history and an in-progress switcher", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.editor.tabs).toHaveLength(3));
    act(() => step());
    act(() => result.current.editor.closeTab("one-b"));
    expect(result.current.editor.getRecentTabIds()).not.toContain("one-b");
    expect(result.current.switcher.tabs.map((tab) => tab.id)).not.toContain("one-b");
    act(() => step());
    expect(result.current.editor.activeTabId).toBe("one-c");
    act(() => release());
    act(() => result.current.editor.closeOtherTabs("one-c"));
    expect(result.current.editor.getRecentTabIds()).toEqual(["one-c"]);
    act(() => { step(); release(); });
    expect(result.current.editor.activeTabId).toBe("one-c");
  });

  it("commits a click or dismissal and closes when the window loses focus", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.editor.tabs).toHaveLength(3));
    act(() => step());
    act(() => result.current.switcher.select("one-c"));
    expect(result.current.editor.getRecentTabIds()[0]).toBe("one-c");
    expect(result.current.switcher.isOpen).toBe(false);
    act(() => step());
    act(() => result.current.switcher.dismiss());
    expect(result.current.editor.getRecentTabIds()[0]).toBe("one-a");
    act(() => step());
    act(() => fireEvent.blur(window));
    expect(result.current.switcher.isOpen).toBe(false);
    expect(result.current.editor.getRecentTabIds()[0]).toBe("one-c");
  });

  it("keeps independent history across connections and ends the old session", async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.editor.tabs).toHaveLength(3));
    act(() => result.current.editor.setActiveTabId("one-c"));
    act(() => step());
    state.connectionId = "two";
    rerender();
    await waitFor(() => expect(result.current.editor.tabs[0]?.id).toBe("two-a"));
    expect(result.current.switcher.isOpen).toBe(false);
    expect(result.current.editor.getRecentTabIds()).toEqual(["two-a", "two-b", "two-c"]);
    act(() => result.current.editor.setActiveTabId("two-b"));
    state.connectionId = "one";
    rerender();
    expect(result.current.editor.getRecentTabIds()).toEqual(["one-a", "one-c", "one-b"]);
    act(() => { step(); release(); });
    expect(result.current.editor.activeTabId).toBe("one-c");
  });

  it("only the focused pane handles Ctrl+Tab and cleans up its listeners", async () => {
    const { result, rerender, unmount } = setup();
    await waitFor(() => expect(result.current.editor.tabs).toHaveLength(3));
    state.enabled = false;
    rerender();
    act(() => step());
    expect(result.current.editor.activeTabId).toBe("one-a");
    state.enabled = true;
    rerender();
    act(() => step(true));
    expect(result.current.editor.activeTabId).toBe("one-c");
    state.enabled = false;
    rerender();
    expect(result.current.switcher.isOpen).toBe(false);
    state.enabled = true;
    rerender();
    expect(result.current.switcher.isOpen).toBe(false);
    unmount();
    const event = new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
