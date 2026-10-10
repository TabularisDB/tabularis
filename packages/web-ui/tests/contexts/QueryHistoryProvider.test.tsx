import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryHistoryProvider } from "../../src/contexts/QueryHistoryProvider";
import { useDatabase } from "../../src/hooks/useDatabase";
import { useQueryHistory } from "../../src/hooks/useQueryHistory";
import type { QueryHistoryEntry } from "../../src/types/queryHistory";

const mockClient = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => mockClient,
}));
vi.mock("../../src/hooks/useDatabase", () => ({ useDatabase: vi.fn() }));

const historyEntry: QueryHistoryEntry = {
  id: "history-1",
  sql: "SELECT 1",
  executedAt: "2026-08-22T00:00:00Z",
  executionTimeMs: 2.5,
  status: "success",
  rowsAffected: 1,
  error: null,
  database: "app",
};

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryHistoryProvider, null, children);

describe("QueryHistoryProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDatabase).mockReturnValue({
      activeConnectionId: "connection-a",
    } as ReturnType<typeof useDatabase>);
  });

  it("uses the typed client for connection-scoped history CRUD", async () => {
    mockClient.call.mockImplementation(async (command: string) => {
      if (command === "get_query_history") {
        return { entries: [historyEntry], recoveredBackupPath: null };
      }
      if (command === "add_query_history_entry") return historyEntry;
      if (
        command === "delete_query_history_entry" ||
        command === "clear_query_history"
      ) {
        return null;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { result } = renderHook(() => useQueryHistory(), { wrapper });
    await waitFor(() => expect(result.current.entries).toEqual([historyEntry]));

    await act(() =>
      result.current.addEntry("SELECT 1", 2.5, "success", 1, null, "app"),
    );
    expect(mockClient.call).toHaveBeenCalledWith(
      "add_query_history_entry",
      expect.objectContaining({
        connectionId: "connection-a",
        sql: "SELECT 1",
        executionTimeMs: 2.5,
        status: "success",
        rowsAffected: 1,
        error: null,
        database: "app",
      }),
    );

    await act(() => result.current.deleteEntry("history-1"));
    expect(mockClient.call).toHaveBeenCalledWith(
      "delete_query_history_entry",
      { connectionId: "connection-a", id: "history-1" },
    );
    expect(result.current.entries).toEqual([]);

    await act(() => result.current.clearHistory());
    expect(mockClient.call).toHaveBeenCalledWith("clear_query_history", {
      connectionId: "connection-a",
    });
  });

  it("does not apply a late response from another connection", async () => {
    let resolveConnectionA: ((value: unknown) => void) | undefined;
    const connectionA = new Promise((resolve) => {
      resolveConnectionA = resolve;
    });
    mockClient.call.mockImplementation(
      async (_command: string, request: { connectionId: string }) => {
        if (request.connectionId === "connection-a") return connectionA;
        return {
          entries: [{ ...historyEntry, id: "history-b", database: "other" }],
          recoveredBackupPath: null,
        };
      },
    );

    const rendered = renderHook(() => useQueryHistory(), { wrapper });
    vi.mocked(useDatabase).mockReturnValue({
      activeConnectionId: "connection-b",
    } as ReturnType<typeof useDatabase>);
    rendered.rerender();

    await waitFor(() =>
      expect(rendered.result.current.entries[0]?.id).toBe("history-b"),
    );
    resolveConnectionA?.({ entries: [historyEntry], recoveredBackupPath: null });
    await act(async () => {
      await connectionA;
    });
    expect(rendered.result.current.entries[0]?.id).toBe("history-b");
  });
});
