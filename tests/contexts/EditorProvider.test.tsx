import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { EditorProvider } from "../../src/contexts/EditorProvider";
import { useEditor } from "../../src/hooks/useEditor";
import { DatabaseContext } from "../../src/contexts/DatabaseContext";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import type { TableSchema } from "../../src/types/editor";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("EditorProvider", () => {
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };

  const mockSchema: TableSchema[] = [
    {
      name: "users",
      columns: [
        { name: "id", data_type: "INT", is_pk: true, is_nullable: false },
        { name: "name", data_type: "VARCHAR", is_pk: false, is_nullable: true },
      ],
      foreign_keys: [],
    },
  ];

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      writable: true,
    });
    localStorageMock.getItem.mockReturnValue(null);

    // Mock invoke to return null for load_editor_preferences by default
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      (command: string) => {
        if (command === "load_editor_preferences") {
          return Promise.resolve(null);
        }
        if (command === "get_schema_snapshot") {
          return Promise.resolve(mockSchema);
        }
        return Promise.resolve(null);
      },
    );
  });

  const createWrapper = (activeConnectionId: string | null = "conn-1") => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        DatabaseContext.Provider,
        {
          value: {
            activeConnectionId,
            activeDriver: "mysql",
            activeTable: null,
            activeConnectionName: "Test Connection",
            activeDatabaseName: "testdb",
            tables: [],
            isLoadingTables: false,
            connect: vi.fn(),
            disconnect: vi.fn(),
            setActiveTable: vi.fn(),
            refreshTables: vi.fn(),
          },
        },
        React.createElement(EditorProvider, null, children),
      );
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_editor_preferences") return Promise.resolve(null);
      if (cmd === "get_schema_snapshot") return Promise.resolve(mockSchema);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should provide initial state with no tabs", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.activeTab).toBeNull();
  });

  it("should add a new console tab", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].title).toBe("Console");
    expect(result.current.tabs[0].type).toBe("console");
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });

  it("should add multiple console tabs with numbered titles", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });
    act(() => {
      result.current.addTab({ type: "console" });
    });
    act(() => {
      result.current.addTab({ type: "console" });
    });

    expect(result.current.tabs).toHaveLength(3);
    expect(result.current.tabs[0].title).toBe("Console");
    expect(result.current.tabs[1].title).toBe("Console 2");
    expect(result.current.tabs[2].title).toBe("Console 3");
  });

  it("should add a table tab with table name as title", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "table", activeTable: "users" });
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].title).toBe("users");
    expect(result.current.tabs[0].type).toBe("table");
    expect(result.current.tabs[0].activeTable).toBe("users");
    expect(result.current.tabs[0].isEditorOpen).toBe(false);
  });

  it("should focus existing table tab instead of creating duplicate", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "table", activeTable: "users" });
    });

    const firstTabId = result.current.tabs[0].id;

    // Add another tab first
    act(() => {
      result.current.addTab({ type: "console" });
    });

    // Try to add same table again
    act(() => {
      result.current.addTab({ type: "table", activeTable: "users" });
    });

    expect(result.current.tabs).toHaveLength(2); // Should not create third tab
    expect(result.current.activeTabId).toBe(firstTabId); // Should focus existing
  });

  it("should add a query builder tab", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "query_builder" });
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].title).toBe("Visual Query");
    expect(result.current.tabs[0].type).toBe("query_builder");
  });

  it("should close a tab", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });
    act(() => {
      result.current.addTab({ type: "console" });
    });

    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.closeTab(tabId);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).not.toBe(tabId);
  });

  it("should create new console tab when closing last tab", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });

    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.closeTab(tabId);
    });

    expect(result.current.tabs).toHaveLength(1); // New tab created
    expect(result.current.tabs[0].title).toBe("Console");
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });

  it("should close all tabs for connection", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });
    act(() => {
      result.current.addTab({ type: "table", activeTable: "users" });
    });
    act(() => {
      result.current.addTab({ type: "query_builder" });
    });

    expect(result.current.tabs).toHaveLength(3);

    act(() => {
      result.current.closeAllTabs();
    });

    expect(result.current.tabs).toHaveLength(1); // Fresh console tab
    expect(result.current.tabs[0].title).toBe("Console");
    expect(result.current.tabs[0].type).toBe("console");
  });

  it("should close other tabs", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });
    act(() => {
      result.current.addTab({ type: "table", activeTable: "users" });
    });
    act(() => {
      result.current.addTab({ type: "query_builder" });
    });

    const keepTabId = result.current.tabs[1].id;

    act(() => {
      result.current.closeOtherTabs(keepTabId);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe(keepTabId);
    expect(result.current.activeTabId).toBe(keepTabId);
  });

  it("should close tabs to the left", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });
    act(() => {
      result.current.addTab({ type: "table", activeTable: "users" });
    });
    act(() => {
      result.current.addTab({ type: "query_builder" });
    });

    const targetId = result.current.tabs[1].id;

    act(() => {
      result.current.setActiveTabId(targetId);
    });

    act(() => {
      result.current.closeTabsToLeft(targetId);
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.tabs[0].id).toBe(targetId);
  });

  it("should close tabs to the right", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });
    act(() => {
      result.current.addTab({ type: "table", activeTable: "users" });
    });
    act(() => {
      result.current.addTab({ type: "query_builder" });
    });

    const targetId = result.current.tabs[1].id;

    act(() => {
      result.current.setActiveTabId(targetId);
    });

    act(() => {
      result.current.closeTabsToRight(targetId);
    });

    expect(result.current.tabs).toHaveLength(2);
    // After closing tabs to the right of the table tab, we should have console and table
    expect(result.current.tabs[0].type).toBe("console");
    expect(result.current.tabs[1].type).toBe("table");
  });

  it("should update tab properties", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });

    const tabId = result.current.tabs[0].id;

    act(() => {
      result.current.updateTab(tabId, {
        title: "Updated Title",
        query: "SELECT * FROM users",
      });
    });

    expect(result.current.tabs[0].title).toBe("Updated Title");
    expect(result.current.tabs[0].query).toBe("SELECT * FROM users");
  });

  it("should set active tab", () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    act(() => {
      result.current.addTab({ type: "console" });
    });
    act(() => {
      result.current.addTab({ type: "table", activeTable: "users" });
    });

    const firstTabId = result.current.tabs[0].id;

    act(() => {
      result.current.setActiveTabId(firstTabId);
    });

    expect(result.current.activeTabId).toBe(firstTabId);
    expect(result.current.activeTab?.id).toBe(firstTabId);
  });

  it("should get schema from backend on cache miss", async () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    let schema: TableSchema[] = [];
    await act(async () => {
      schema = await result.current.getSchema("conn-1");
    });

    expect(schema).toEqual(mockSchema);
    expect(invoke).toHaveBeenCalledWith("get_schema_snapshot", {
      connectionId: "conn-1",
    });
  });

  it("should use cached schema on subsequent calls", async () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    // First call - should hit backend
    await act(async () => {
      await result.current.getSchema("conn-1", 1);
    });

    const schemaCallsAfterFirst = (
      invoke as ReturnType<typeof vi.fn>
    ).mock.calls.filter((call) => call[0] === "get_schema_snapshot").length;
    expect(schemaCallsAfterFirst).toBe(1);

    // Second call - should use cache
    let schema: TableSchema[] = [];
    await act(async () => {
      schema = await result.current.getSchema("conn-1", 1);
    });

    const schemaCallsAfterSecond = (
      invoke as ReturnType<typeof vi.fn>
    ).mock.calls.filter((call) => call[0] === "get_schema_snapshot").length;
    expect(schemaCallsAfterSecond).toBe(1); // No additional backend call
    expect(schema).toEqual(mockSchema);
  });

  it("should refetch schema when version changes", async () => {
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    // First call
    await act(async () => {
      await result.current.getSchema("conn-1", 1);
    });

    const schemaCallsAfterFirst = (
      invoke as ReturnType<typeof vi.fn>
    ).mock.calls.filter((call) => call[0] === "get_schema_snapshot").length;
    expect(schemaCallsAfterFirst).toBe(1);

    // Second call with different version
    await act(async () => {
      await result.current.getSchema("conn-1", 2);
    });

    const schemaCallsAfterSecond = (
      invoke as ReturnType<typeof vi.fn>
    ).mock.calls.filter((call) => call[0] === "get_schema_snapshot").length;
    expect(schemaCallsAfterSecond).toBe(2);
  });

  it("should refetch schema when cache is stale", async () => {
    vi.useFakeTimers();
    const wrapper = createWrapper("conn-1");
    const { result } = renderHook(() => useEditor(), { wrapper });

    // First call
    await act(async () => {
      await result.current.getSchema("conn-1");
    });

    const schemaCallsAfterFirst = (
      invoke as ReturnType<typeof vi.fn>
    ).mock.calls.filter((call) => call[0] === "get_schema_snapshot").length;
    expect(schemaCallsAfterFirst).toBe(1);

    // Advance time by 6 minutes (cache expires at 5 minutes)
    vi.advanceTimersByTime(6 * 60 * 1000);

    // Second call - cache should be stale
    await act(async () => {
      await result.current.getSchema("conn-1");
    });

    const schemaCallsAfterSecond = (
      invoke as ReturnType<typeof vi.fn>
    ).mock.calls.filter((call) => call[0] === "get_schema_snapshot").length;
    expect(schemaCallsAfterSecond).toBe(2);

    vi.useRealTimers();
  });

  it("should not add tabs when not connected", () => {
    const wrapper = createWrapper(null);
    const { result } = renderHook(() => useEditor(), { wrapper });

    let tabId = "";
    act(() => {
      tabId = result.current.addTab({ type: "console" });
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(tabId).toBe("");
  });

  it("should only show tabs for active connection", () => {
    // Create wrapper with conn-1 as active
    const wrapperConn1 = createWrapper("conn-1");
    const { result: resultConn1 } = renderHook(() => useEditor(), {
      wrapper: wrapperConn1,
    });

    // Add tabs for conn-1
    act(() => {
      resultConn1.current.addTab({ type: "console" });
    });
    act(() => {
      resultConn1.current.addTab({ type: "table", activeTable: "users" });
    });

    expect(resultConn1.current.tabs).toHaveLength(2);

    // Now switch to different connection
    const wrapperConn2 = createWrapper("conn-2");
    const { result: resultConn2 } = renderHook(() => useEditor(), {
      wrapper: wrapperConn2,
    });

    // Should show no tabs for conn-2
    expect(resultConn2.current.tabs).toHaveLength(0);
  });
});
