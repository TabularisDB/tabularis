import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useSshAskpass } from "../../src/hooks/useSshAskpass";
import type { SshAskpassRequest } from "../../src/types/askpass";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const listenMock = vi.mocked(listen);
const invokeMock = vi.mocked(invoke);

describe("useSshAskpass", () => {
  let handlers: Record<string, EventCallback<unknown>>;

  beforeEach(() => {
    handlers = {};
    listenMock.mockReset();
    invokeMock.mockReset();
    listenMock.mockImplementation((event, handler) => {
      handlers[event as string] = handler as EventCallback<unknown>;
      return Promise.resolve(() => {});
    });
    invokeMock.mockResolvedValue(undefined);
  });

  const emitRequest = (payload: SshAskpassRequest) => {
    act(() => {
      handlers["ssh-askpass://request"]({
        event: "ssh-askpass://request",
        id: 1,
        payload,
      });
    });
  };

  const request = (overrides: Partial<SshAskpassRequest> = {}): SshAskpassRequest => ({
    id: 1,
    kind: "secret",
    prompt: "Enter PIN for key:",
    ...overrides,
  });

  it("starts with no pending prompt", () => {
    const { result } = renderHook(() => useSshAskpass());
    expect(result.current.current).toBeNull();
  });

  it("exposes a prompt received via the request event", () => {
    const { result } = renderHook(() => useSshAskpass());
    emitRequest(request());

    expect(result.current.current).toEqual(request());
  });

  it("shows prompts one at a time, oldest first", () => {
    const { result } = renderHook(() => useSshAskpass());
    emitRequest(request({ id: 1, prompt: "first" }));
    emitRequest(request({ id: 2, prompt: "second" }));

    expect(result.current.current?.id).toBe(1);
  });

  it("respond sends the answer to the backend and pops the prompt", async () => {
    const { result } = renderHook(() => useSshAskpass());
    emitRequest(request({ id: 7 }));

    await act(async () => {
      await result.current.respond(7, "1234");
    });

    expect(invokeMock).toHaveBeenCalledWith("respond_ssh_askpass", {
      id: 7,
      response: "1234",
    });
    expect(result.current.current).toBeNull();
  });

  it("respond with null forwards the cancellation", async () => {
    const { result } = renderHook(() => useSshAskpass());
    emitRequest(request({ id: 3 }));

    await act(async () => {
      await result.current.respond(3, null);
    });

    expect(invokeMock).toHaveBeenCalledWith("respond_ssh_askpass", {
      id: 3,
      response: null,
    });
  });

  it("removes a prompt when the backend dismisses it", () => {
    const { result } = renderHook(() => useSshAskpass());
    emitRequest(request({ id: 5, kind: "notify" }));
    expect(result.current.current?.id).toBe(5);

    act(() => {
      handlers["ssh-askpass://dismiss"]({
        event: "ssh-askpass://dismiss",
        id: 1,
        payload: 5,
      });
    });

    expect(result.current.current).toBeNull();
  });

  it("dismiss removes a prompt locally without calling the backend", () => {
    const { result } = renderHook(() => useSshAskpass());
    emitRequest(request({ id: 9, kind: "notify" }));

    act(() => {
      result.current.dismiss(9);
    });

    expect(result.current.current).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
