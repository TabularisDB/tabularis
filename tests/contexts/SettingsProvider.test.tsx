import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { SettingsProvider } from "../../src/contexts/SettingsProvider";
import { useSettings } from "../../src/hooks/useSettings";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import type { Settings } from "../../src/contexts/SettingsContext";

vi.mock("@tauri-apps/api/core");

// Mock react-i18next
const mockChangeLanguage = vi.fn();
const mockI18n = {
  changeLanguage: mockChangeLanguage,
  language: "en",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: mockI18n,
  }),
}));

describe("SettingsProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockI18n.language = "en";
    localStorage.clear();

    // Default mock for invoke
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({});
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      if (cmd === "check_ai_key") {
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should provide default settings when backend is empty", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.settings.resultPageSize).toBe(500);
    expect(result.current.settings.language).toBe("auto");
    expect(result.current.settings.fontFamily).toBe("System");
    expect(result.current.settings.fontSize).toBe(14);
    expect(result.current.settings.aiEnabled).toBe(false);
    expect(result.current.settings.aiProvider).toBeNull();
    expect(result.current.settings.aiModel).toBeNull();
  });

  it("should load settings from backend config", async () => {
    const mockConfig: Partial<Settings> = {
      resultPageSize: 1000,
      language: "it",
      fontFamily: "Roboto",
      fontSize: 16,
      aiEnabled: true,
      aiProvider: "openai",
      aiModel: "gpt-4",
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve(mockConfig);
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      if (cmd === "check_ai_key") {
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.settings.resultPageSize).toBe(1000);
    expect(result.current.settings.language).toBe("it");
    expect(result.current.settings.fontFamily).toBe("Roboto");
    expect(result.current.settings.fontSize).toBe(16);
    expect(result.current.settings.aiEnabled).toBe(true);
    expect(result.current.settings.aiProvider).toBe("openai");
    expect(result.current.settings.aiModel).toBe("gpt-4");
  });

  it("hydrates persisted settings even while language application is still pending", async () => {
    let resolveChangeLanguage: (() => void) | null = null;

    mockChangeLanguage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveChangeLanguage = resolve;
        }),
    );

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({ language: "it" });
      }
      if (cmd === "check_ai_key") {
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(mockChangeLanguage).toHaveBeenCalledWith("it");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isLanguageReady).toBe(false);
    expect(result.current.isLanguageSettled).toBe(false);
    expect(result.current.settings.language).toBe("it");

    resolveChangeLanguage?.();

    await waitFor(() => {
      expect(result.current.isLanguageReady).toBe(true);
      expect(result.current.isLanguageSettled).toBe(true);
    });
  });

  it("treats an already-active persisted language as settled immediately", async () => {
    mockI18n.language = "it";

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({ language: "it" });
      }
      if (cmd === "check_ai_key") {
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockChangeLanguage).not.toHaveBeenCalled();
    expect(result.current.settings.language).toBe("it");
    expect(result.current.isLanguageReady).toBe(true);
    expect(result.current.isLanguageSettled).toBe(true);
  });

  it("fails open when language application never resolves", async () => {
    vi.useFakeTimers();
    mockChangeLanguage.mockImplementation(() => new Promise<void>(() => {}));

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({ language: "it" });
      }
      if (cmd === "check_ai_key") {
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockChangeLanguage).toHaveBeenCalledWith("it");

    expect(result.current.isLanguageReady).toBe(false);
    expect(result.current.isLanguageSettled).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });

    expect(result.current.isLanguageReady).toBe(false);
    expect(result.current.isLanguageSettled).toBe(true);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to apply language:",
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("should migrate settings from localStorage to backend", async () => {
    const oldLocalSettings = {
      queryLimit: 100,
      language: "en",
    };

    localStorage.setItem("tabularis_settings", JSON.stringify(oldLocalSettings));

    vi.mocked(invoke).mockImplementation((cmd: string, args?: any) => {
      if (cmd === "get_config") {
        return Promise.resolve({});
      }
      if (cmd === "save_config") {
        // Verify migration data
        expect(args?.config).toHaveProperty("resultPageSize", 100);
        expect(args?.config).toHaveProperty("language", "en");
        return Promise.resolve(undefined);
      }
      if (cmd === "check_ai_key") {
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.settings.resultPageSize).toBe(100);
    expect(result.current.settings.language).toBe("en");
    expect(invoke).toHaveBeenCalledWith("save_config", expect.objectContaining({
      config: expect.objectContaining({
        resultPageSize: 100,
        language: "en",
      }),
    }));
  });

  it("should treat null/undefined aiEnabled as false", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({ aiEnabled: null });
      }
      if (cmd === "check_ai_key") {
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.settings.aiEnabled).toBe(false);
  });

  it("should auto-detect AI provider when aiEnabled but provider not set", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string, args?: any) => {
      if (cmd === "get_config") {
        return Promise.resolve({ aiEnabled: true });
      }
      if (cmd === "check_ai_key") {
        if (args?.provider === "openai") return Promise.resolve(true);
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({
          openai: ["gpt-4", "gpt-3.5-turbo"],
        });
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.settings.aiProvider).toBe("openai");
    expect(result.current.settings.aiModel).toBe("gpt-4");
  });

  it("should update settings and persist to backend", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateSetting("resultPageSize", 200);
    });

    await waitFor(() => {
      expect(result.current.settings.resultPageSize).toBe(200);
    });

    expect(invoke).toHaveBeenCalledWith("save_config", {
      config: expect.objectContaining({
        resultPageSize: 200,
      }),
    });
  });

  it("should change language when language setting is updated", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateSetting("language", "it");
    });

    await waitFor(() => {
      expect(result.current.settings.language).toBe("it");
    });

    expect(mockChangeLanguage).toHaveBeenCalledWith("it");
  });

  it("should apply font settings to document", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({
          fontFamily: "JetBrains Mono",
          fontSize: 18,
        });
      }
      if (cmd === "check_ai_key") {
        return Promise.resolve(false);
      }
      if (cmd === "get_ai_models") {
        return Promise.resolve({});
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      const fontFamily = document.documentElement.style.getPropertyValue("--font-base");
      const fontSize = document.documentElement.style.getPropertyValue("--font-size-base");

      expect(fontFamily).toContain("JetBrains Mono");
      expect(fontSize).toBe("18px");
    });
  });

  it("should cache font settings to localStorage", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateSetting("fontFamily", "Hack");
    });

    await waitFor(() => {
      const cached = localStorage.getItem("tabularis_font_cache");
      expect(cached).toBeTruthy();
      const parsedCache = JSON.parse(cached!);
      expect(parsedCache.fontFamily).toBe("Hack");
    });
  });

  it("should handle errors when loading settings", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.reject(new Error("Backend error"));
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SettingsProvider, null, children);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should still have default settings despite error
    expect(result.current.settings.resultPageSize).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
