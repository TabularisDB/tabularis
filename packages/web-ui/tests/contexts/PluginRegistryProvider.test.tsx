import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PluginRegistryProvider } from "../../src/contexts/PluginRegistryProvider";
import { usePluginRegistry } from "../../src/hooks/usePluginRegistry";
import type { RegistryPluginWithStatus } from "../../src/types/plugins";

vi.mock("../../src/hooks/useTabularisClient", () => import("../support/tauriBackedHooks"));
vi.mock("../../src/hooks/usePlatformCapabilities", () => import("../support/tauriBackedHooks"));
const settings = vi.hoisted(() => ({
  settings: { tabulariumRegistryUrl: "https://registry.example" },
  isLoading: false,
}));
vi.mock("../../src/hooks/useSettings", () => ({ useSettings: () => settings }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const plugin: RegistryPluginWithStatus = {
  id: "test",
  name: "Test",
  description: "",
  author: "",
  homepage: "",
  installed_version: "1.0.0",
  latest_version: "2.0.0",
  update_available: true,
  platform_supported: true,
  releases: [
    { version: "2.0.0", platform_supported: true, min_tabularis_version: null },
  ],
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <PluginRegistryProvider>{children}</PluginRegistryProvider>
  </StrictMode>
);

describe("PluginRegistryProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    settings.isLoading = false;
    settings.settings.tabulariumRegistryUrl = "https://registry.example";
    vi.mocked(invoke).mockResolvedValue([plugin]);
    vi.mocked(listen).mockResolvedValue(vi.fn());
  });

  it("shares one startup request and refreshes all consumers after an update", async () => {
    const { result } = renderHook(
      () => ({ sidebar: usePluginRegistry(), tab: usePluginRegistry() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.sidebar.updates).toHaveLength(1));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.sidebar).toBe(result.current.tab);
    vi.mocked(invoke).mockResolvedValue([
      { ...plugin, installed_version: "2.0.0", update_available: false },
    ]);
    act(() => result.current.tab.refresh());
    await waitFor(() => expect(result.current.sidebar.updates).toHaveLength(0));
  });

  it("ignores stale responses when refreshes overlap", async () => {
    const { result } = renderHook(() => usePluginRegistry(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolveOld!: (plugins: RegistryPluginWithStatus[]) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await act(async () => result.current.refresh());
    vi.mocked(invoke).mockResolvedValue([]);
    await act(async () => result.current.refresh());
    await act(async () => resolveOld([plugin]));
    expect(result.current.updates).toEqual([]);
  });

  it("refreshes on installs from outside Settings and cleans up listeners", async () => {
    const cleanup = vi.fn();
    vi.mocked(listen).mockResolvedValue(cleanup);
    const { result, unmount } = renderHook(() => usePluginRegistry(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.updates).toHaveLength(1));
    vi.mocked(invoke).mockResolvedValue([]);
    const callback = vi
      .mocked(listen)
      .mock.calls.filter(([event]) => event === "tabularis://plugin-installed")
      .at(-1)![1];
    await act(async () =>
      callback({ event: "tabularis://plugin-installed", id: 1, payload: {} }),
    );
    expect(result.current.updates).toHaveLength(0);
    unmount();
    await waitFor(() =>
      expect(cleanup).toHaveBeenCalledTimes(
        vi.mocked(listen).mock.calls.length,
      ),
    );
  });

  it("waits for settings and recovers from a registry failure", async () => {
    settings.isLoading = true;
    const { result, rerender } = renderHook(() => usePluginRegistry(), {
      wrapper,
    });
    expect(invoke).not.toHaveBeenCalled();
    settings.isLoading = false;
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Offline"));
    rerender();
    await waitFor(() => expect(result.current.error).toBe("Offline"));
    expect(result.current.updates).toEqual([]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.updates).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });
});
