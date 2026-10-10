import { createElement, type ReactNode } from "react";
import { act, renderHook as renderHookBase, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { TabularisClient } from "../../src/api/client";
import { TauriTransport } from "../../src/api/transports/tauriTransport";
import { TabularisClientProvider } from "../../src/contexts/TabularisClientProvider";
import {
  clearAiActivity,
  useAiActivityEvents,
  usePendingApprovals,
} from "../../src/hooks/useAiActivity";
import type { PendingApproval } from "../../src/types/ai";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const client = new TabularisClient(new TauriTransport());
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(TabularisClientProvider, { client }, children);
const renderHook = <Result,>(callback: () => Result) =>
  renderHookBase(callback, { wrapper });

const pending: PendingApproval = {
  id: "approval-1",
  createdAt: "2026-08-22T00:00:00Z",
  sessionId: "mcp-session",
  connectionId: "connection-1",
  connectionName: "Fixture",
  query: "DELETE FROM values",
  queryKind: "write",
  clientHint: null,
  explainPlan: null,
  explainError: null,
};

describe("useAiActivity", () => {
  let eventHandler: EventCallback<PendingApproval> | undefined;

  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    eventHandler = undefined;
    listenMock.mockImplementation((event, handler) => {
      if (event === "ai://pending_approval") {
        eventHandler = handler as EventCallback<PendingApproval>;
      }
      return Promise.resolve(() => {});
    });
  });

  it("loads filtered activity through the typed client", async () => {
    invokeMock.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useAiActivityEvents({ status: "success" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invokeMock).toHaveBeenCalledWith("get_ai_activity", {
      filter: { status: "success" },
    });
  });

  it("refreshes and decides approvals through the shared event and RPC contract", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "list_pending_approvals") return Promise.resolve([pending]);
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => usePendingApprovals());

    await waitFor(() => expect(result.current.pending).toEqual([pending]));
    expect(listenMock).toHaveBeenCalledWith(
      "ai://pending_approval",
      expect.any(Function),
    );

    await act(async () => {
      eventHandler?.({
        event: "ai://pending_approval",
        id: 1,
        payload: pending,
      });
    });
    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(
          ([command]) => command === "list_pending_approvals",
        ),
      ).toHaveLength(2);
    });

    await act(async () => {
      await result.current.decide({
        approvalId: pending.id,
        decision: "deny",
        reason: "fixture",
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("decide_pending_approval", {
      approvalId: pending.id,
      decision: "deny",
      reason: "fixture",
      editedQuery: undefined,
    });
  });

  it("clears activity through the typed client", async () => {
    invokeMock.mockResolvedValue(undefined);
    await clearAiActivity(client);
    expect(invokeMock).toHaveBeenCalledWith("clear_ai_activity", undefined);
  });
});
