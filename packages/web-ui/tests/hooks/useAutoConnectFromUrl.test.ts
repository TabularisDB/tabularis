import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAutoConnectFromUrl } from "../../src/hooks/useAutoConnectFromUrl";

const navigateMock = vi.fn();
const handleConnectMock = vi.fn<(id: string) => Promise<void>>();
let searchParams = new URLSearchParams();

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [searchParams] as const,
}));

vi.mock("../../src/hooks/useConnectionManager", () => ({
  useConnectionManager: () => ({ handleConnect: handleConnectMock }),
}));

describe("useAutoConnectFromUrl", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    handleConnectMock.mockReset();
    handleConnectMock.mockResolvedValue(undefined);
    searchParams = new URLSearchParams();
  });

  it("does nothing when there is no connect param", () => {
    renderHook(() => useAutoConnectFromUrl());
    expect(handleConnectMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("connects and navigates to the editor when connect param is present", async () => {
    searchParams = new URLSearchParams("connect=conn-42");
    renderHook(() => useAutoConnectFromUrl());

    await waitFor(() => expect(handleConnectMock).toHaveBeenCalledWith("conn-42"));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/editor", { replace: true }),
    );
  });

  it("navigates home when the connection fails", async () => {
    searchParams = new URLSearchParams("connect=bad-id");
    handleConnectMock.mockRejectedValue(new Error("nope"));
    renderHook(() => useAutoConnectFromUrl());

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/", { replace: true }),
    );
  });

  it("only triggers once even if re-rendered", async () => {
    searchParams = new URLSearchParams("connect=conn-1");
    const { rerender } = renderHook(() => useAutoConnectFromUrl());

    await waitFor(() => expect(handleConnectMock).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    expect(handleConnectMock).toHaveBeenCalledTimes(1);
  });
});
