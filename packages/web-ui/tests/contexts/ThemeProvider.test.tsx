import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { ThemeProvider } from "../../src/contexts/ThemeProvider";
import { useTheme } from "../../src/hooks/useTheme";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import type { Theme } from "../../src/types/theme";

vi.mock("@tauri-apps/api/core");

vi.mock("../../src/themes/themeUtils", () => ({
  applyThemeToCSS: vi.fn(),
}));

// Create mock theme objects for themeRegistry mock
const createMockTheme = (id: string, name: string): Theme => ({
  id,
  name,
  isPreset: true,
  isReadOnly: true,
  colors: {
    bg: {
      base: "#1a1a1a",
      elevated: "#2a2a2a",
      overlay: "#3a3a3a",
      input: "#2a2a2a",
      tooltip: "#3a3a3a",
    },
    surface: {
      primary: "#1a1a1a",
      secondary: "#2a2a2a",
      tertiary: "#3a3a3a",
      hover: "#4a4a4a",
      active: "#5a5a5a",
      disabled: "#0a0a0a",
    },
    text: {
      primary: "#ffffff",
      secondary: "#cccccc",
      muted: "#999999",
      disabled: "#666666",
      accent: "#007acc",
      inverse: "#000000",
    },
    border: {
      subtle: "#404040",
      default: "#505050",
      strong: "#606060",
      focus: "#007acc",
    },
    accent: {
      primary: "#007acc",
      secondary: "#0098ff",
      success: "#00aa00",
      warning: "#ff9900",
      error: "#ff0000",
      info: "#0088ff",
    },
    semantic: {
      string: "#ce9178",
      number: "#b5cea8",
      boolean: "#569cd6",
      date: "#c586c0",
      null: "#808080",
      primaryKey: "#f0c653",
      foreignKey: "#4ec9b0",
      index: "#c586c0",
      connectionActive: "#00aa00",
      connectionInactive: "#808080",
      modified: "#ff9900",
      deleted: "#ff0000",
      new: "#00aa00",
    },
  },
  typography: {
    fontFamily: {
      base: "system-ui, sans-serif",
      mono: "monospace",
    },
    fontSize: {
      xs: "0.75rem",
      sm: "0.875rem",
      base: "1rem",
      lg: "1.125rem",
      xl: "1.25rem",
    },
  },
  layout: {
    spacing: {
      xs: "0.25rem",
      sm: "0.5rem",
      base: "1rem",
      lg: "1.5rem",
      xl: "2rem",
    },
    borderRadius: {
      sm: "0.25rem",
      base: "0.5rem",
      lg: "0.75rem",
      xl: "1rem",
    },
  },
  monacoTheme: {
    base: "vs-dark",
    inherit: true,
  },
});

const mockDarkTheme = createMockTheme("tabularis-dark", "Tabularis Dark");
const mockLightTheme = createMockTheme("tabularis-light", "Tabularis Light");

vi.mock("../../src/themes/themeRegistry", () => ({
  themeRegistry: {
    getDefault: () => mockDarkTheme,
    getAllPresets: () => [mockDarkTheme, mockLightTheme],
  },
}));

describe("ThemeProvider", () => {
  const mockDefaultTheme = mockDarkTheme;
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();

    // Mock matchMedia globally
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    // Default mock for invoke
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({});
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      if (cmd === "get_all_themes") {
        return Promise.resolve([]);
      }
      if (cmd === "save_custom_theme") {
        return Promise.resolve(undefined);
      }
      if (cmd === "delete_custom_theme") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should provide default theme when backend is empty", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.currentTheme.id).toMatch(/tabularis-(dark|light)/);
    expect(result.current.currentTheme.isPreset).toBe(true);
  });

  it("should load theme from backend config", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({ theme: "tabularis-dark" });
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      if (cmd === "get_all_themes") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.currentTheme.id).toBe("tabularis-dark");
  });

  it("should migrate theme from localStorage to backend", async () => {
    const oldLocalSettings = {
      activeThemeId: "tabularis-dark",
    };

    localStorage.setItem(
      "tabularis_theme_settings",
      JSON.stringify(oldLocalSettings),
    );

    vi.mocked(invoke).mockImplementation((cmd: string, args?: any) => {
      if (cmd === "get_config") {
        return Promise.resolve({});
      }
      if (cmd === "save_config") {
        // Accept any theme value during migration
        return Promise.resolve(undefined);
      }
      if (cmd === "get_all_themes") {
        return Promise.resolve([]);
      }
      if (cmd === "save_custom_theme") {
        return Promise.resolve(undefined);
      }
      if (cmd === "delete_custom_theme") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "save_config",
        expect.objectContaining({
          config: expect.objectContaining({ theme: "tabularis-dark" }),
        }),
      );
    });

    // Check that old localStorage was removed
    expect(localStorage.getItem("tabularis_theme_settings")).toBeNull();
  });

  it("should detect theme from system preferences if not set", async () => {
    // Mock matchMedia to return dark mode
    const matchMediaMock = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock,
    });

    vi.mocked(invoke).mockImplementation((cmd: string, args?: any) => {
      if (cmd === "get_config") {
        return Promise.resolve({});
      }
      if (cmd === "save_config") {
        expect(args?.config).toHaveProperty("theme", "tabularis-dark");
        return Promise.resolve(undefined);
      }
      if (cmd === "get_all_themes") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.currentTheme.id).toBe("tabularis-dark");
  });

  it("should load custom themes from backend", async () => {
    const customTheme: Theme = {
      ...mockDefaultTheme,
      id: "custom-123",
      name: "My Custom Theme",
      isPreset: false,
      isReadOnly: false,
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({});
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      if (cmd === "get_all_themes") {
        return Promise.resolve([customTheme]);
      }
      if (cmd === "save_custom_theme") {
        return Promise.resolve(undefined);
      }
      if (cmd === "delete_custom_theme") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.allThemes.length).toBeGreaterThanOrEqual(1);
    expect(result.current.allThemes.some((t) => t.id === "custom-123")).toBe(
      true,
    );
  });

  it("should set theme", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.setTheme("tabularis-dark");
    });

    expect(result.current.currentTheme.id).toBe("tabularis-dark");
    expect(result.current.settings.activeThemeId).toBe("tabularis-dark");
  });

  it("should create custom theme", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let createdTheme: Theme | undefined;

    await act(async () => {
      createdTheme = await result.current.createCustomTheme(
        "tabularis-dark",
        "My New Theme",
      );
    });

    expect(createdTheme).toBeTruthy();
    expect(createdTheme!.name).toBe("My New Theme");
    expect(createdTheme!.isPreset).toBe(false);
    expect(invoke).toHaveBeenCalledWith(
      "save_custom_theme",
      expect.objectContaining({
        theme: expect.objectContaining({
          name: "My New Theme",
          isPreset: false,
        }),
      }),
    );
  });

  it("should update custom theme", async () => {
    const customTheme: Theme = {
      ...mockDefaultTheme,
      id: "custom-123",
      name: "Custom Theme",
      isPreset: false,
      isReadOnly: false,
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({ theme: "custom-123" });
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      if (cmd === "get_all_themes") {
        return Promise.resolve([customTheme]);
      }
      if (cmd === "save_custom_theme") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const updatedTheme = {
      ...customTheme,
      name: "Updated Theme Name",
    };

    await act(async () => {
      await result.current.updateCustomTheme(updatedTheme);
    });

    expect(invoke).toHaveBeenCalledWith(
      "save_custom_theme",
      expect.objectContaining({
        theme: expect.objectContaining({
          name: "Updated Theme Name",
        }),
      }),
    );
  });

  it("should not update preset themes", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const presetTheme = result.current.currentTheme;

    await expect(
      result.current.updateCustomTheme(presetTheme),
    ).rejects.toThrow("Cannot modify preset themes");
  });

  it("should delete custom theme", async () => {
    const customTheme: Theme = {
      ...mockDefaultTheme,
      id: "custom-123",
      name: "Custom Theme",
      isPreset: false,
      isReadOnly: false,
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({});
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      if (cmd === "get_all_themes") {
        return Promise.resolve([customTheme]);
      }
      if (cmd === "delete_custom_theme") {
        return Promise.resolve(undefined);
      }
      if (cmd === "save_custom_theme") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.deleteCustomTheme("custom-123");
    });

    expect(invoke).toHaveBeenCalledWith("delete_custom_theme", {
      themeId: "custom-123",
    });
  });

  it("should not delete preset themes", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await expect(
      result.current.deleteCustomTheme("tabularis-dark"),
    ).rejects.toThrow("Cannot delete preset themes");
  });

  it("should duplicate theme", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let duplicatedTheme: Theme | undefined;

    await act(async () => {
      duplicatedTheme = await result.current.duplicateTheme(
        "tabularis-dark",
        "Duplicated Theme",
      );
    });

    expect(duplicatedTheme).toBeTruthy();
    expect(duplicatedTheme!.name).toBe("Duplicated Theme");
    expect(duplicatedTheme!.isPreset).toBe(false);
    expect(invoke).toHaveBeenCalledWith(
      "save_custom_theme",
      expect.objectContaining({
        theme: expect.objectContaining({
          name: "Duplicated Theme",
          isPreset: false,
        }),
      }),
    );
  });

  it("should import theme", async () => {
    const importedThemeJson = JSON.stringify({
      ...mockDefaultTheme,
      id: "imported-123",
      name: "Imported Theme",
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let importedTheme: Theme | undefined;

    await act(async () => {
      importedTheme = await result.current.importTheme(importedThemeJson);
    });

    expect(importedTheme).toBeTruthy();
    expect(importedTheme!.name).toBe("Imported Theme");
    expect(importedTheme!.isPreset).toBe(false);
  });

  it("should export theme", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let exportedJson = "";

    await act(async () => {
      exportedJson = await result.current.exportTheme("tabularis-dark");
    });

    expect(exportedJson).toBeTruthy();
    const parsed = JSON.parse(exportedJson);
    expect(parsed.id).toBe("tabularis-dark");
    expect(parsed.name).toBe("Tabularis Dark");
  });

  it("should save theme to config when changed", async () => {
    // Start with a specific theme
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_config") {
        return Promise.resolve({ theme: "tabularis-light" });
      }
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      if (cmd === "get_all_themes") {
        return Promise.resolve([]);
      }
      if (cmd === "save_custom_theme") {
        return Promise.resolve(undefined);
      }
      if (cmd === "delete_custom_theme") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeProvider, null, children);

    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Reset mock calls
    vi.mocked(invoke).mockClear();
    // Reinstate the implementation after clear
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "save_config") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    await act(async () => {
      await result.current.setTheme("tabularis-dark");
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "save_config",
        expect.objectContaining({
          config: { theme: "tabularis-dark" },
        }),
      );
    });
  });
});
