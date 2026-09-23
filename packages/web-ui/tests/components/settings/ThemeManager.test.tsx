import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeManager } from "../../../src/components/settings/ThemeManager";
import { builtinCatalog, resolveCatalogEntry } from "../../../src/utils/themeCatalog";
import type { ThemeContextType } from "../../../src/contexts/ThemeContext";
import { DEFAULT_THEME_SETTINGS } from "../../../src/types/theme";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
let context: ThemeContextType;
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => context }));
vi.mock("../../../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: { editorTheme: "missing-editor" } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, args?: { id?: string }) => args?.id ? `${key}: ${args.id}` : key, i18n: { language: "en" } }) }));
vi.mock("../../../src/components/ui/ThemeSqlSample", () => ({ ThemeSqlSample: () => <div>SQL sample</div> }));

beforeEach(() => {
  vi.clearAllMocks(); mocks.invoke.mockResolvedValue({ warnings: [] });
  const catalog = builtinCatalog();
  for (const variantId of ["dark", "light"] as const) catalog.themes.push(resolveCatalogEntry({ id: `theme:${"a".repeat(64)}:fixture-theme:${variantId}`, name: `Fixture ${variantId}`, mode: variantId, format: "v1", source: JSON.stringify({ schemaVersion: 1, mode: variantId }), revision: "1", readOnly: true, available: true, origin: { kind: "installed", identity: { registryKey: "a".repeat(64), packageName: "fixture-theme", variantId }, packageVersion: "1.0.0" } }));
  const theme = catalog.themes[0].resolved.theme;
  context = { catalog, currentTheme: theme, allThemes: catalog.themes.map((entry) => entry.resolved.theme), settings: DEFAULT_THEME_SETTINGS, selection: { theme, requestedId: theme.id, previewing: false }, isLoading: false,
    refreshCatalog: vi.fn().mockResolvedValue(catalog), previewTheme: vi.fn(), previewDefinition: vi.fn(), cancelPreview: vi.fn(), updatePersonalSource: vi.fn(), setTheme: vi.fn().mockResolvedValue(undefined), createCustomTheme: vi.fn(), updateCustomTheme: vi.fn(), deleteCustomTheme: vi.fn(), duplicateTheme: vi.fn().mockResolvedValue(theme), importTheme: vi.fn(), exportTheme: vi.fn().mockResolvedValue("{}"), updateSettings: vi.fn().mockResolvedValue(undefined) };
});

function openActions(name = "Tabularis Dark") {
  fireEvent.click(screen.getByRole("button", { name: `themePackages.manage — ${name}` }));
}
function chooseAction(action: string, name = "Tabularis Dark") {
  openActions(name);
  fireEvent.click(screen.getByRole("menuitem", { name: `themePackages.${action}` }));
}

describe("ThemeManager unified selection and management", () => {
  it("renders one card per theme, with metadata and actions instead of a second list", () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    expect(screen.getByRole("region", { name: "settings.themeSelection" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "themePackages.manage" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Tabularis Dark", exact: true })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Fixture dark", exact: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Tabularis Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("themePackages.groups.installed")).toHaveLength(2);
    expect(screen.getByText("themePackages.missing: missing-editor")).toBeInTheDocument();
    expect(document.querySelector("button button")).toBeNull();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    openActions("Fixture dark");
    expect(screen.getByRole("menuitem", { name: "themePackages.disable" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "themePackages.update" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "themePackages.removePackage" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "themePackages.edit" })).not.toBeInTheDocument();
    expect(context.setTheme).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("still selects a theme directly from its card", async () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Tabularis Light", exact: true }));
    await waitFor(() => expect(context.setTheme).toHaveBeenCalledExactlyOnceWith("tabularis-light"));
    expect(context.previewTheme).not.toHaveBeenCalled();
  });

  it("previews from the card menu without saving and restores on cancel", async () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    chooseAction("preview");
    expect(context.previewTheme).toHaveBeenCalledWith("tabularis-dark");
    expect(context.setTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(context.cancelPreview).toHaveBeenCalled();
    expect(context.updateSettings).not.toHaveBeenCalled();
  });

  it("applies a preview once only after explicit confirmation", async () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    chooseAction("preview");
    fireEvent.click(screen.getByRole("button", { name: "themePackages.apply" }));
    await waitFor(() => expect(context.setTheme).toHaveBeenCalledExactlyOnceWith("tabularis-dark"));
  });

  it("applies a light preview to the light slot without changing follow-system mode", async () => {
    context.settings = { ...DEFAULT_THEME_SETTINGS, followSystemTheme: true };
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    chooseAction("preview", "Fixture light");
    fireEvent.click(screen.getByRole("button", { name: "themePackages.apply" }));
    await waitFor(() => expect(context.updateSettings).toHaveBeenCalledExactlyOnceWith({ lightThemeId: `theme:${"a".repeat(64)}:fixture-theme:light` }));
    expect(context.setTheme).not.toHaveBeenCalled();
  });

  it("disables the entire native package while retaining selection preferences", async () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    chooseAction("disable", "Fixture dark");
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "themePackages.disable" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("set_theme_package_enabled", { registryKey: "a".repeat(64), packageName: "fixture-theme", enabled: false }));
    expect(context.deleteCustomTheme).not.toHaveBeenCalled();
    expect(context.setTheme).not.toHaveBeenCalled();
    expect(context.updateSettings).not.toHaveBeenCalled();
  });

  it("keeps disabled themes visible and manageable but not selectable", async () => {
    for (const theme of context.catalog.themes) if (theme.entry.origin.kind === "installed") theme.entry.available = false;
    context.allThemes = context.catalog.themes.filter((theme) => theme.entry.available).map((theme) => theme.resolved.theme);
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Fixture dark", exact: true })).toBeDisabled();
    openActions("Fixture dark");
    expect(screen.getByRole("menuitem", { name: "themePackages.preview" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "themePackages.enable" }));
    fireEvent.click(screen.getByRole("button", { name: "themePackages.enable" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("set_theme_package_enabled", expect.objectContaining({ enabled: true, packageName: "fixture-theme" })));
  });

  it("creates a native personal duplicate without selecting it", async () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    chooseAction("duplicate");
    fireEvent.change(screen.getByLabelText("themePackages.name"), { target: { value: "My theme" } });
    fireEvent.click(screen.getByRole("button", { name: "themePackages.duplicate" }));
    await waitFor(() => expect(context.duplicateTheme).toHaveBeenCalledWith("tabularis-dark", "My theme"));
    expect(context.setTheme).not.toHaveBeenCalled();
  });

  it("clearly identifies destructive package actions and keeps confirmation outside the scrolling body", async () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    chooseAction("removePackage", "Fixture dark");
    expect(screen.getByRole("dialog", { name: "themePackages.removePackage" })).toHaveAccessibleDescription("Fixture dark");
    expect(screen.getByText("fixture-theme")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "themePackages.removePackage" });
    expect(confirm).toHaveClass("bg-accent-error");
    expect(confirm.closest(".overflow-y-auto")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("uninstall_theme_package", { registryKey: "a".repeat(64), packageName: "fixture-theme" }));
  });

  it("focuses the duplicate name and returns to the card menu trigger on cancellation", () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    chooseAction("duplicate");
    expect(screen.getByLabelText("themePackages.name")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.getByRole("button", { name: "themePackages.manage — Tabularis Dark" })).toHaveFocus();
  });

  it("consolidates import choices in the selection toolbar", () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.import", exact: true }));
    for (const key of ["importJSON", "importVSCode", "localPackage"]) {
      expect(screen.getByRole("menuitem", { name: `themePackages.${key}` })).toBeInTheDocument();
    }
    expect(context.setTheme).not.toHaveBeenCalled();
  });
});
