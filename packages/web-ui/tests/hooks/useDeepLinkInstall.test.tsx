import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { describe, expect, it, vi } from "vitest";
import { useDeepLinkInstall } from "../../src/hooks/useDeepLinkInstall";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(), emit: vi.fn() }));

const mocks = vi.hoisted(() => ({ client: { call: vi.fn() } }));
vi.mock("../../src/hooks/useTabularisClient", () => ({ useTabularisClient: () => mocks.client }));
vi.mock("../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({ negotiation: { environment: "browser" } }),
}));

describe("useDeepLinkInstall browser startup", () => {
  it("does not register OS handoffs or consume desktop startup requests", async () => {
    vi.mocked(invoke).mockClear();
    vi.mocked(listen).mockClear();
    const { result } = renderHook(useDeepLinkInstall);
    await act(async () => {});
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });
});
