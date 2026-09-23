import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";

const updateSettings = vi.fn(async () => undefined);
const setTheme = vi.fn(async () => undefined);
let loading = false;

const lightTheme = {
  id: "tabularis-light",
  name: "Tabularis Light",
  monacoTheme: { base: "vs" },
  colors: {
    accent: { primary: "#007acc", secondary: "#0098ff" },
    bg: { base: "#ffffff" },
    surface: { primary: "#f5f5f5" },
  },
};
const darkTheme = {
  id: "tabularis-dark",
  name: "Tabularis Dark",
  monacoTheme: { base: "vs-dark" },
  colors: {
    accent: { primary: "#007acc", secondary: "#0098ff" },
    bg: { base: "#1a1a1a" },
    surface: { primary: "#2a2a2a" },
  },
};

let themeSettings = {
  activeThemeId: "tabularis-dark",
  followSystemTheme: false,
  lightThemeId: "tabularis-light",
  darkThemeId: "tabularis-dark",
  customThemes: [],
};

// The unified theme toolbar uses the same icons as its management menus.
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { fontFamily: "System", fontSize: 14 },
    updateSetting: vi.fn(),
  }),
}));

vi.mock("../../../src/hooks/useTheme", () => ({
  useTheme: () => ({
    currentTheme: darkTheme,
    allThemes: [lightTheme, darkTheme],
    setTheme,
    settings: themeSettings,
    isLoading: loading,
    catalog: { themes: [], issues: [] },
    updateSettings,
  }),
}));

vi.mock("../../../src/components/settings/ResultColorsSection", () => ({
  ResultColorsSection: () => null,
}));

import { AppearanceTab } from "../../../src/components/settings/AppearanceTab";

describe("AppearanceTab theme mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    themeSettings = { ...themeSettings, followSystemTheme: false };
    loading = false;
  });

  it("disables theme choices while preferences are hydrating", () => {
    loading = true; render(<MemoryRouter><AppearanceTab /></MemoryRouter>);
    expect(screen.getByText("Tabularis Light").closest("button")).toBeDisabled();
  });

  it("surfaces preference save failures instead of an unhandled promise", async () => {
    updateSettings.mockRejectedValueOnce(new Error("settings unavailable"));
    render(<MemoryRouter><AppearanceTab /></MemoryRouter>);
    fireEvent.click(screen.getByText("settings.themeModeSystem"));
    expect(await screen.findByRole("alert")).toHaveTextContent("settings unavailable");
  });

  it("shows a single theme picker in static mode", () => {
    render(<MemoryRouter><AppearanceTab /></MemoryRouter>);
    expect(screen.getByText("Tabularis Dark")).toBeTruthy();
    expect(screen.getByText("Tabularis Light")).toBeTruthy();
    expect(screen.queryByText("settings.lightTheme")).toBeNull();
  });

  it("keeps theme management out of the independent SQL editor picker", () => {
    render(<MemoryRouter><AppearanceTab /></MemoryRouter>);
    fireEvent.click(screen.getByText("settings.appearance_sqlEditor"));
    expect(screen.getByRole("button", { name: "settings.appearance_sameAsApp" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "settings.themeSelection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "themePackages.import", exact: true })).not.toBeInTheDocument();
  });

  it("toggles follow-system via the mode button group", () => {
    render(<MemoryRouter><AppearanceTab /></MemoryRouter>);
    fireEvent.click(screen.getByText("settings.themeModeSystem"));
    expect(updateSettings).toHaveBeenCalledWith({ followSystemTheme: true });
  });

  it("shows filtered light/dark pickers in follow-system mode", () => {
    themeSettings = { ...themeSettings, followSystemTheme: true };
    render(<MemoryRouter><AppearanceTab /></MemoryRouter>);
    // Light picker: only light themes
    const lightSection = screen.getByText("settings.lightTheme").parentElement!;
    expect(lightSection.textContent).toContain("Tabularis Light");
    expect(lightSection.textContent).not.toContain("Tabularis Dark");
    // Dark picker: only dark themes
    const darkSection = screen.getByText("settings.darkTheme").parentElement!;
    expect(darkSection.textContent).toContain("Tabularis Dark");
    expect(darkSection.textContent).not.toContain("Tabularis Light");
  });

  it("updates lightThemeId when a light theme is picked", () => {
    themeSettings = { ...themeSettings, followSystemTheme: true };
    render(<MemoryRouter><AppearanceTab /></MemoryRouter>);
    const lightSection = screen.getByText("settings.lightTheme").parentElement!;
    fireEvent.click(
      Array.from(lightSection.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Tabularis Light"),
      )!,
    );
    expect(updateSettings).toHaveBeenCalledWith({
      lightThemeId: "tabularis-light",
    });
  });
});
