import { describe, it, expect, vi } from "vitest";
import { useUpdate } from "../../src/hooks/useUpdate";
import { UpdateContext } from "../../src/contexts/UpdateContext";
import { renderHook } from "@testing-library/react";
import React, { type ReactNode } from "react";
import type { UpdateCheckResult } from "../../src/contexts/UpdateContext";

describe("useUpdate", () => {
  it("should throw error when used outside UpdateProvider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useUpdate());
    }).toThrow("useUpdate must be used within UpdateProvider");

    consoleSpy.mockRestore();
  });

  it("should return context value when used within UpdateProvider", () => {
    const mockUpdateInfo: UpdateCheckResult = {
      hasUpdate: true,
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      releaseNotes: "New features",
      releaseUrl: "https://github.com/user/repo/releases/tag/v1.1.0",
      publishedAt: "2024-01-01T00:00:00Z",
      downloadUrls: [],
    };

    const mockContextValue = {
      updateInfo: mockUpdateInfo,
      isChecking: false,
      isDownloading: false,
      downloadProgress: 0,
      checkForUpdates: vi.fn(),
      downloadAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      error: null,
      isUpToDate: false,
    };

    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(
        UpdateContext.Provider,
        { value: mockContextValue },
        children,
      );

    const { result } = renderHook(() => useUpdate(), { wrapper });

    expect(result.current.updateInfo?.hasUpdate).toBe(true);
    expect(result.current.updateInfo?.latestVersion).toBe("1.1.0");
    expect(result.current.isChecking).toBe(false);
    expect(result.current.isDownloading).toBe(false);
    expect(result.current.downloadProgress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.isUpToDate).toBe(false);
    expect(typeof result.current.checkForUpdates).toBe("function");
    expect(typeof result.current.downloadAndInstall).toBe("function");
    expect(typeof result.current.dismissUpdate).toBe("function");
  });

  it("should handle null updateInfo", () => {
    const mockContextValue = {
      updateInfo: null,
      isChecking: false,
      isDownloading: false,
      downloadProgress: 0,
      checkForUpdates: vi.fn(),
      downloadAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      error: null,
      isUpToDate: true,
    };

    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(
        UpdateContext.Provider,
        { value: mockContextValue },
        children,
      );

    const { result } = renderHook(() => useUpdate(), { wrapper });

    expect(result.current.updateInfo).toBeNull();
    expect(result.current.isUpToDate).toBe(true);
  });

  it("should handle error state", () => {
    const mockContextValue = {
      updateInfo: null,
      isChecking: false,
      isDownloading: false,
      downloadProgress: 0,
      checkForUpdates: vi.fn(),
      downloadAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      error: "Network error",
      isUpToDate: false,
    };

    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(
        UpdateContext.Provider,
        { value: mockContextValue },
        children,
      );

    const { result } = renderHook(() => useUpdate(), { wrapper });

    expect(result.current.error).toBe("Network error");
  });
});
