import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { UpdateProvider } from "../../src/contexts/UpdateProvider";
import { useUpdate } from "../../src/hooks/useUpdate";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React from "react";
import type { UpdateCheckResult } from "../../src/contexts/UpdateContext";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/event");

describe("UpdateProvider", () => {
  let unlistenProgressMock: () => void;
  let unlistenInstallingMock: () => void;

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock unlisten functions
    unlistenProgressMock = vi.fn();
    unlistenInstallingMock = vi.fn();

    // Mock listen to return unlisten functions
    vi.mocked(listen).mockImplementation((event) => {
      if (event === "update-progress") {
        return Promise.resolve(unlistenProgressMock);
      }
      if (event === "update-installing") {
        return Promise.resolve(unlistenInstallingMock);
      }
      return Promise.resolve(vi.fn());
    });

    // Default mock for invoke
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") {
        return Promise.resolve(null); // Not a managed package by default
      }
      if (cmd === "get_config") {
        return Promise.resolve({ autoCheckUpdatesOnStartup: false });
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should provide initial state", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    expect(result.current.updateInfo).toBeNull();
    expect(result.current.isChecking).toBe(false);
    expect(result.current.isDownloading).toBe(false);
    expect(result.current.downloadProgress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.isUpToDate).toBe(false);
  });

  it("should check for updates when available", async () => {
    const mockUpdateResult: UpdateCheckResult = {
      hasUpdate: true,
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      releaseNotes: "New features",
      releaseUrl: "https://github.com/user/repo/releases/tag/v1.1.0",
      publishedAt: "2024-01-01T00:00:00Z",
      downloadUrls: [],
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "check_for_updates") {
        return Promise.resolve(mockUpdateResult);
      }
      if (cmd === "get_config") {
        return Promise.resolve({ lastDismissedVersion: "", autoCheckUpdatesOnStartup: false });
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await result.current.checkForUpdates();
    });

    await waitFor(() => {
      expect(result.current.updateInfo).not.toBeNull();
      expect(result.current.updateInfo?.hasUpdate).toBe(true);
      expect(result.current.updateInfo?.latestVersion).toBe("1.1.0");
      expect(result.current.isChecking).toBe(false);
      expect(result.current.isUpToDate).toBe(false);
    });
  });

  it("should not show update if version was dismissed", async () => {
    const mockUpdateResult: UpdateCheckResult = {
      hasUpdate: true,
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      releaseNotes: "New features",
      releaseUrl: "https://github.com/user/repo/releases/tag/v1.1.0",
      publishedAt: "2024-01-01T00:00:00Z",
      downloadUrls: [],
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "check_for_updates") {
        return Promise.resolve(mockUpdateResult);
      }
      if (cmd === "get_config") {
        return Promise.resolve({ lastDismissedVersion: "1.1.0", autoCheckUpdatesOnStartup: false });
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await result.current.checkForUpdates();
    });

    await waitFor(() => {
      expect(result.current.updateInfo).toBeNull();
      expect(result.current.isUpToDate).toBe(true);
    });
  });

  it("should surface a dismissed version on a manual (forced) check", async () => {
    const mockUpdateResult: UpdateCheckResult = {
      hasUpdate: true,
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      releaseNotes: "New features",
      releaseUrl: "https://github.com/user/repo/releases/tag/v1.1.0",
      publishedAt: "2024-01-01T00:00:00Z",
      downloadUrls: [],
    };

    const getConfig = vi.fn(() =>
      Promise.resolve({
        lastDismissedVersion: "1.1.0",
        autoCheckUpdatesOnStartup: false,
      }),
    );

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "check_for_updates") return Promise.resolve(mockUpdateResult);
      if (cmd === "get_config") return getConfig();
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await result.current.checkForUpdates(true);
    });

    await waitFor(() => {
      expect(result.current.updateInfo).not.toBeNull();
      expect(result.current.updateInfo?.latestVersion).toBe("1.1.0");
      expect(result.current.isUpToDate).toBe(false);
    });

    // A forced check must not consult the dismissed-version config at all.
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("should show up to date when no update available", async () => {
    const mockUpdateResult: UpdateCheckResult = {
      hasUpdate: false,
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      releaseNotes: "",
      releaseUrl: "",
      publishedAt: "",
      downloadUrls: [],
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "check_for_updates") {
        return Promise.resolve(mockUpdateResult);
      }
      if (cmd === "get_config") {
        return Promise.resolve({ autoCheckUpdatesOnStartup: false });
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await result.current.checkForUpdates();
    });

    await waitFor(() => {
      expect(result.current.updateInfo).toBeNull();
      expect(result.current.isUpToDate).toBe(true);
      expect(result.current.isChecking).toBe(false);
    });
  });

  it("should handle check for updates error", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "check_for_updates") {
        return Promise.reject("Network error");
      }
      if (cmd === "get_config") {
        return Promise.resolve({ autoCheckUpdatesOnStartup: false });
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await result.current.checkForUpdates();
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Network error");
      expect(result.current.isChecking).toBe(false);
      expect(result.current.isUpToDate).toBe(false);
    });
  });

  it("should download and install update", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "download_and_install_update") {
        return Promise.resolve(undefined);
      }
      if (cmd === "get_config") {
        return Promise.resolve({ autoCheckUpdatesOnStartup: false });
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(invoke).toHaveBeenCalledWith("download_and_install_update");
  });

  it("should handle download error", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "download_and_install_update") {
        return Promise.reject("Download failed");
      }
      if (cmd === "get_config") {
        return Promise.resolve({ autoCheckUpdatesOnStartup: false });
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Download failed");
      expect(result.current.isDownloading).toBe(false);
    });
  });

  it("should dismiss update", async () => {
    const mockUpdateResult: UpdateCheckResult = {
      hasUpdate: true,
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      releaseNotes: "New features",
      releaseUrl: "https://github.com/user/repo/releases/tag/v1.1.0",
      publishedAt: "2024-01-01T00:00:00Z",
      downloadUrls: [],
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "check_for_updates") {
        return Promise.resolve(mockUpdateResult);
      }
      if (cmd === "get_config") {
        return Promise.resolve({ lastDismissedVersion: "", autoCheckUpdatesOnStartup: false });
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    // First check for updates
    await act(async () => {
      await result.current.checkForUpdates();
    });

    await waitFor(() => {
      expect(result.current.updateInfo).not.toBeNull();
    });

    // Then dismiss the update
    await act(async () => {
      await result.current.dismissUpdate();
    });

    expect(invoke).toHaveBeenCalledWith("save_config", {
      config: { lastDismissedVersion: "1.1.0" },
    });
    expect(result.current.updateInfo).toBeNull();
  });

  it("should not check for updates on startup if disabled in config", async () => {
    vi.useFakeTimers();

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "get_config") {
        return Promise.resolve({ autoCheckUpdatesOnStartup: false });
      }
      if (cmd === "check_for_updates") {
        return Promise.reject("Should not be called");
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(invoke).toHaveBeenCalledWith("get_config");
    expect(invoke).not.toHaveBeenCalledWith("check_for_updates", expect.anything());
  });

  it("should skip update check on startup for managed packages (AUR/Snap)", async () => {
    vi.useFakeTimers();

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve("aur");
      if (cmd === "check_for_updates") return Promise.reject("Should not be called");
      if (cmd === "get_config") return Promise.reject("Should not be called");
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.installationSource).toBe("aur");
    expect(invoke).not.toHaveBeenCalledWith("check_for_updates", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("get_config");
  });

  it("should expose installationSource as null for direct installs", async () => {
    vi.useFakeTimers();

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_installation_source") return Promise.resolve(null);
      if (cmd === "get_config") return Promise.resolve({ autoCheckUpdatesOnStartup: false });
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { result } = renderHook(() => useUpdate(), { wrapper });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.installationSource).toBeNull();
  });

  it("should setup and cleanup event listeners", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UpdateProvider, null, children);

    const { unmount } = renderHook(() => useUpdate(), { wrapper });

    // Wait for the listeners to be set up
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith("update-progress", expect.any(Function));
      expect(listen).toHaveBeenCalledWith("update-installing", expect.any(Function));
    });

    // Unmount to trigger cleanup
    await act(async () => {
      unmount();
    });

    // Wait a tick for cleanup to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unlistenProgressMock).toHaveBeenCalled();
    expect(unlistenInstallingMock).toHaveBeenCalled();
  });
});
