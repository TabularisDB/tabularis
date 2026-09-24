import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeManager } from "../../../src/components/settings/ThemeManager";
import { ThemePackageExportModal } from "../../../src/components/modals/ThemePackageExportModal";
import { builtinCatalog } from "../../../src/utils/themeCatalog";
import type { ThemeContextType } from "../../../src/contexts/ThemeContext";
import { DEFAULT_THEME_SETTINGS } from "../../../src/types/theme";

const mocks = vi.hoisted(() => ({ call: vi.fn(), downloadFile: vi.fn(), exportThemePackage: vi.fn() }));
let context: ThemeContextType;
vi.mock("../../../src/hooks/useTabularisClient", () => ({ useTabularisClient: () => ({ call: mocks.call }) }));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({ negotiation: { environment: "browser" }, downloadFile: mocks.downloadFile }),
}));
vi.mock("../../../src/utils/themePackageExport", () => ({ exportThemePackage: mocks.exportThemePackage }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => context }));
vi.mock("../../../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: {} }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("../../../src/components/ui/ThemeSqlSample", () => ({ ThemeSqlSample: () => <div>SQL sample</div> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.downloadFile.mockResolvedValue(true);
  const catalog = builtinCatalog();
  const theme = catalog.themes[0].resolved.theme;
  context = { catalog, currentTheme: theme, allThemes: catalog.themes.map((entry) => entry.resolved.theme), settings: DEFAULT_THEME_SETTINGS, selection: { theme, requestedId: theme.id, previewing: false }, isLoading: false,
    refreshCatalog: vi.fn().mockResolvedValue(catalog), previewTheme: vi.fn(), previewDefinition: vi.fn(), cancelPreview: vi.fn(), updatePersonalSource: vi.fn(), setTheme: vi.fn().mockResolvedValue(undefined), createCustomTheme: vi.fn(), updateCustomTheme: vi.fn(), deleteCustomTheme: vi.fn(), duplicateTheme: vi.fn(), importTheme: vi.fn(), exportTheme: vi.fn().mockResolvedValue('{"name":"exported"}'), updateSettings: vi.fn().mockResolvedValue(undefined) };
});

describe("theme exports in the browser", () => {
  it("downloads a theme's JSON source instead of writing a host path", async () => {
    render(<MemoryRouter><ThemeManager /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.manage — Tabularis Dark" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "themePackages.exportJSON" }));
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledOnce());
    const request = mocks.downloadFile.mock.calls[0][0];
    expect(request).toMatchObject({ fileName: "theme.json", mimeType: "application/json" });
    expect(new TextDecoder().decode(request.contents)).toBe('{"name":"exported"}');
    expect(context.exportTheme).toHaveBeenCalledWith(context.catalog.themes[0].entry.id);
  });

  it("downloads the packaged archive and closes once the download is handed off", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    mocks.exportThemePackage.mockReturnValue(bytes);
    const onClose = vi.fn();
    render(<ThemePackageExportModal isOpen onClose={onClose} theme={context.catalog.themes[0]} />);
    const [name, version, minimum] = screen.getAllByRole("textbox");
    fireEvent.change(name, { target: { value: "my-theme" } });
    fireEvent.change(version, { target: { value: "2.0.0" } });
    fireEvent.change(minimum, { target: { value: "0.25.0" } });
    fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: "MIT" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "themePackages.exportPackage" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.downloadFile).toHaveBeenCalledExactlyOnceWith({ fileName: "my-theme-2.0.0-universal.zip", contents: bytes, mimeType: "application/zip", filters: [{ name: "ZIP", extensions: ["zip"] }] });
  });

  it("keeps the export dialog open when the save is cancelled", async () => {
    mocks.exportThemePackage.mockReturnValue(new Uint8Array([1]));
    mocks.downloadFile.mockResolvedValueOnce(false);
    const onClose = vi.fn();
    render(<ThemePackageExportModal isOpen onClose={onClose} theme={context.catalog.themes[0]} />);
    const inputs = screen.getAllByRole("textbox");
    ["pkg", "1.0.0", "0.25.0", "MIT"].forEach((value, index) => fireEvent.change(inputs[index], { target: { value } }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "themePackages.exportPackage" }));
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});
