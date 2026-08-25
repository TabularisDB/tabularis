import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useOpenConnectionInNewWindow } from "../../src/hooks/useOpenConnectionInNewWindow";

const detachConnectionMock = vi.fn();
const isConnectionOpenMock = vi.fn<(id: string) => boolean>();
const isConnectionOpenAnywhereMock = vi.fn<(id: string) => boolean>();
const openConnectionRouteMock = vi.fn();

vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    detachConnection: detachConnectionMock,
    isConnectionOpen: isConnectionOpenMock,
    isConnectionOpenAnywhere: isConnectionOpenAnywhereMock,
  }),
}));

vi.mock("../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({
    openConnectionRoute: openConnectionRouteMock,
  }),
}));

vi.mock("../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => ({
    call: (command: string, request: unknown) => invoke(command, request),
  }),
}));

const invokeMock = vi.mocked(invoke);

const conn = { id: "conn-1", name: "My DB", params: { driver: "mysql" } };

describe("useOpenConnectionInNewWindow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    detachConnectionMock.mockReset();
    isConnectionOpenMock.mockReset();
    isConnectionOpenAnywhereMock.mockReset();
    openConnectionRouteMock.mockReset();
    openConnectionRouteMock.mockResolvedValue(undefined);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_connections") return Promise.resolve([conn]);
      return Promise.resolve(undefined);
    });
  });

  it("validates connectivity before opening the window when not open anywhere", async () => {
    isConnectionOpenAnywhereMock.mockReturnValue(false);
    isConnectionOpenMock.mockReturnValue(false);
    const { result } = renderHook(() => useOpenConnectionInNewWindow());

    await result.current("conn-1", "My DB");

    expect(invokeMock).toHaveBeenCalledWith("test_connection", {
      request: { params: conn.params, connection_id: "conn-1" },
    });
    expect(openConnectionRouteMock).toHaveBeenCalledWith({
      connectionId: "conn-1",
      title: "My DB",
    });
    expect(invokeMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      openConnectionRouteMock.mock.invocationCallOrder[0],
    );
  });

  it("does NOT open the window when validation fails", async () => {
    isConnectionOpenAnywhereMock.mockReturnValue(false);
    isConnectionOpenMock.mockReturnValue(false);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_connections") return Promise.resolve([conn]);
      if (cmd === "test_connection") return Promise.reject(new Error("bad creds"));
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useOpenConnectionInNewWindow());

    await expect(result.current("conn-1", "My DB")).rejects.toThrow("bad creds");
    expect(openConnectionRouteMock).not.toHaveBeenCalled();
  });

  it("skips validation when the connection is already open somewhere", async () => {
    isConnectionOpenAnywhereMock.mockReturnValue(true);
    isConnectionOpenMock.mockReturnValue(false);
    const { result } = renderHook(() => useOpenConnectionInNewWindow());

    await result.current("conn-1", "My DB");

    expect(invokeMock).not.toHaveBeenCalledWith("test_connection", expect.anything());
    expect(openConnectionRouteMock).toHaveBeenCalledWith({
      connectionId: "conn-1",
      title: "My DB",
    });
  });

  it("detaches from the current window when it is open here", async () => {
    isConnectionOpenAnywhereMock.mockReturnValue(true);
    isConnectionOpenMock.mockReturnValue(true);
    const { result } = renderHook(() => useOpenConnectionInNewWindow());

    await result.current("conn-1", "My DB");

    expect(detachConnectionMock).toHaveBeenCalledWith("conn-1");
  });

  it("passes a null title when no name is given", async () => {
    isConnectionOpenAnywhereMock.mockReturnValue(true);
    isConnectionOpenMock.mockReturnValue(false);
    const { result } = renderHook(() => useOpenConnectionInNewWindow());

    await result.current("conn-1");

    expect(openConnectionRouteMock).toHaveBeenCalledWith({
      connectionId: "conn-1",
      title: null,
    });
  });
});
