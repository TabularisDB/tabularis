import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  lighten,
  darken,
  generateColorScale,
} from "../../src/themes/colorUtils";
import { generateMonacoTheme, applyThemeToCSS } from "../../src/themes/themeUtils";
import type { Theme } from "../../src/types/theme";

describe("themeUtils", () => {
  const mockTheme: Theme = {
    id: "test-theme",
    name: "Test Theme",
    isPreset: true,
    isReadOnly: true,
    colors: {
      bg: {
        base: "#1a1a1a",
        elevated: "#252525",
        overlay: "#000000",
        input: "#2d2d2d",
        tooltip: "#333333",
      },
      surface: {
        primary: "#2d2d2d",
        secondary: "#3d3d3d",
        tertiary: "#4d4d4d",
        hover: "#404040",
        active: "#505050",
        disabled: "#1f1f1f",
      },
      text: {
        primary: "#ffffff",
        secondary: "#b0b0b0",
        muted: "#808080",
        disabled: "#606060",
        accent: "#ffffff",
        inverse: "#000000",
      },
      accent: {
        primary: "#3b82f6",
        secondary: "#60a5fa",
        success: "#22c55e",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#3b82f6",
      },
      border: {
        subtle: "#2d2d2d",
        default: "#404040",
        strong: "#606060",
        focus: "#3b82f6",
      },
      semantic: {
        string: "#22c55e",
        number: "#f59e0b",
        boolean: "#3b82f6",
        date: "#f59e0b",
        null: "#808080",
        primaryKey: "#ef4444",
        foreignKey: "#f59e0b",
        index: "#3b82f6",
        connectionActive: "#22c55e",
        connectionInactive: "#ef4444",
        modified: "#f59e0b",
        deleted: "#ef4444",
        new: "#22c55e",
      },
    },
    typography: {
      fontFamily: {
        base: "Inter, system-ui, sans-serif",
        mono: "JetBrains Mono, monospace",
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
      borderRadius: {
        sm: "0.25rem",
        base: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
      },
      spacing: {
        xs: "0.25rem",
        sm: "0.5rem",
        base: "1rem",
        lg: "1.5rem",
        xl: "2rem",
      },
    },
    monacoTheme: {
      base: "vs-dark",
      inherit: true,
      rules: [],
      themeName: "Monokai",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset document.documentElement.style
    document.documentElement.style.cssText = "";
  });

  describe("generateMonacoTheme", () => {
    it("should generate Monaco theme with correct base", () => {
      const result = generateMonacoTheme(mockTheme);
      expect(result.base).toBe("vs-dark");
      expect(result.inherit).toBe(true);
    });

    it("should map editor colors correctly", () => {
      const result = generateMonacoTheme(mockTheme);
      expect(result.colors?.["editor.background"]).toBe("#1a1a1a");
      expect(result.colors?.["editor.foreground"]).toBe("#ffffff");
      expect(result.colors?.["editorCursor.foreground"]).toBe("#3b82f6");
    });

    it("should map semantic colors correctly", () => {
      const result = generateMonacoTheme(mockTheme);
      expect(result.colors?.["editorGutter.modifiedBackground"]).toBe(
        "#f59e0b",
      );
      expect(result.colors?.["editorGutter.addedBackground"]).toBe("#22c55e");
      expect(result.colors?.["editorGutter.deletedBackground"]).toBe("#ef4444");
    });

    it("should include custom base colors from theme", () => {
      const themeWithCustomColors: Theme = {
        ...mockTheme,
        monacoTheme: {
          ...mockTheme.monacoTheme,
          colors: {
            "custom.color": "#ff0000",
          },
        },
      };
      const result = generateMonacoTheme(themeWithCustomColors);
      expect(result.colors?.["custom.color"]).toBe("#ff0000");
    });

    it("should apply button hover color as lightened primary", () => {
      const result = generateMonacoTheme(mockTheme);
      expect(result.colors?.["button.hoverBackground"]).toBeDefined();
      // Should be slightly lighter than primary color #3b82f6
      expect(result.colors?.["button.hoverBackground"]).not.toBe("#3b82f6");
    });
  });

  describe("applyThemeToCSS", () => {
    it("should set all CSS variables", () => {
      applyThemeToCSS(mockTheme);

      const root = document.documentElement;
      expect(root.style.getPropertyValue("--bg-base")).toBe("#1a1a1a");
      expect(root.style.getPropertyValue("--text-primary")).toBe("#ffffff");
      expect(root.style.getPropertyValue("--accent-primary")).toBe("#3b82f6");
      expect(root.style.getPropertyValue("--font-base")).toBe(
        "Inter, system-ui, sans-serif",
      );
      expect(root.style.getPropertyValue("--radius-base")).toBe("0.375rem");
    });

    it("should set color-scheme based on theme base", () => {
      applyThemeToCSS(mockTheme);
      expect(
        document.documentElement.style.getPropertyValue("color-scheme"),
      ).toBe("dark");

      const lightTheme: Theme = {
        ...mockTheme,
        monacoTheme: { ...mockTheme.monacoTheme, base: "vs" },
      };
      applyThemeToCSS(lightTheme);
      expect(
        document.documentElement.style.getPropertyValue("color-scheme"),
      ).toBe("light");
    });

    it("should handle high contrast themes", () => {
      const hcTheme: Theme = {
        ...mockTheme,
        monacoTheme: { ...mockTheme.monacoTheme, base: "hc-black" },
      };
      applyThemeToCSS(hcTheme);
      expect(
        document.documentElement.style.getPropertyValue("color-scheme"),
      ).toBe("dark");
    });
  });

  describe("Re-exported color utilities (from colorUtils.ts)", () => {
    it("should re-export hexToRgb correctly", () => {
      expect(hexToRgb).toBeDefined();
      expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    });

    it("should re-export rgbToHex correctly", () => {
      expect(rgbToHex).toBeDefined();
      expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
    });

    it("should re-export lighten correctly", () => {
      expect(lighten).toBeDefined();
      expect(lighten("#000000", 0.5)).toBe("#808080");
    });

    it("should re-export darken correctly", () => {
      expect(darken).toBeDefined();
      expect(darken("#ffffff", 0.5)).toBe("#808080");
    });

    it("should re-export generateColorScale correctly", () => {
      expect(generateColorScale).toBeDefined();
      const scale = generateColorScale("#ff0000");
      expect(scale[500]).toBe("#ff0000");
      expect(scale).toHaveProperty("50");
      expect(scale).toHaveProperty("900");
    });
  });
});
