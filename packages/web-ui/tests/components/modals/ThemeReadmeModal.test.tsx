import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeReadmeModal } from "../../../src/components/modals/ThemeReadmeModal";
import { ThemeRegistryInstall } from "../../../src/components/modals/ThemeRegistryInstall";

vi.mock("../../../src/hooks/useTabularisClient", () => import("../../support/tauriBackedHooks"));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => import("../../support/tauriBackedHooks"));
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.open }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en", resolvedLanguage: "en" } }) }));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => ({}) }));
const plugin = { id: "fixture-theme", name: "Fixture", author: "Author", description: "Description", latest_version: "1.0.0", downloads: 0, releases: [{ version: "1.0.0", min_tabularis_version: "0.24.0", assets: { universal: "https://example.invalid/theme.zip" } }], screenshots: [{ url: "https://example.invalid/dark.png", caption: "Dark preview" }, { url: "https://registry.invalid/api/plugins/theme/latest", caption: "Forbidden counter" }] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.open.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command) => command === "fetch_theme_package_detail" ? plugin : { html: '<h1>Readable README</h1><img src="https://example.invalid/image.png"><a href="https://example.invalid/docs">Guide</a>', locale: "en", available_locales: ["en"], documentation_url: null, repo_url: "https://github.com/example/theme" });
});

describe("theme README and screenshot metadata", () => {
  it("fetches read-only metadata, not images or downloads, and opens screenshots only on request", async () => {
    render(<ThemeReadmeModal plugin={plugin} registryUrl="https://registry.invalid" onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Readable README" });
    expect(screen.getByRole("dialog").querySelector("img,iframe")).toBeNull(); expect(mocks.open).not.toHaveBeenCalled();
    expect(screen.queryByText("Forbidden counter")).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("fetch_plugin_readme", { slug: "fixture-theme", locale: "en", registryUrl: "https://registry.invalid" });
    fireEvent.click(screen.getByRole("button", { name: "Dark preview" }));
    expect(mocks.open).toHaveBeenCalledWith("https://example.invalid/dark.png");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("uses one dialog at a time and restores the README button on Escape", async () => {
    render(<ThemeRegistryInstall isOpen onClose={vi.fn()} snapshot={{ registryKey: "a".repeat(64), registryUrl: "https://registry.invalid", plugins: [plugin] }} plugin={plugin} onCommitted={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ })).not.toBeDisabled());
    const button = screen.getByRole("button", { name: "themePackages.readme" }); button.focus(); fireEvent.click(button);
    await screen.findByRole("heading", { name: "Readable README" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "themePackages.readme" })).toHaveFocus());
    expect(mocks.invoke.mock.calls.some(([command]) => command === "install_registry_theme")).toBe(false);
  });
});
