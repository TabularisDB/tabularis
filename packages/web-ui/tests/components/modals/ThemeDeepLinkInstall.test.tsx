import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PluginInstallConfirmModal } from "../../../src/components/modals/PluginInstallConfirmModal";

vi.mock("../../../src/hooks/useTabularisClient", () => import("../../support/tauriBackedHooks"));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => import("../../support/tauriBackedHooks"));
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), refreshCatalog: vi.fn() }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => ({ catalog: { themes: [] }, refreshCatalog: mocks.refreshCatalog }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
const plugin = { id: "fixture-theme", name: "Native validated fixture", description: "Test", author: "Author", latest_version: "1.0.0", releases: [{ version: "1.0.0", min_tabularis_version: "0.24.0", assets: { universal: "https://example.invalid/theme.zip" } }] };
const snapshot = { registryKey: "a".repeat(64), registryUrl: "https://example.invalid", plugins: [plugin] };
const request = { slug: plugin.id, version: "1.0.0", registry: snapshot.registryUrl };
beforeEach(() => {
  vi.clearAllMocks(); mocks.refreshCatalog.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "fetch_tabularium_plugin_preview") return { ...plugin, id: "untrusted-preview-alias", kind: "theme" };
    if (command === "fetch_theme_registry") return snapshot;
    if (command === "fetch_theme_package_detail") return plugin;
    if (command === "install_registry_theme") return { warnings: [] };
    throw new Error(`Unexpected ${command}`);
  });
});
describe("theme deep-link dispatch", () => {
  it("uses requested package identity, direct native metadata and the declarative installer only after confirmation", async () => {
    const driverInstall = vi.fn();
    render(<PluginInstallConfirmModal request={request} busy={false} error={null} onConfirm={driverInstall} onCancel={vi.fn()} />);
    // Three chained native lookups precede the enabled button; give the full suite headroom.
    await waitFor(() => expect(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ })).toBeEnabled(), { timeout: 4000 });
    expect(mocks.invoke).toHaveBeenCalledWith("fetch_theme_registry", { packageName: request.slug });
    expect(mocks.invoke).toHaveBeenCalledWith("fetch_theme_package_detail", expect.objectContaining({ packageName: request.slug, requestedRegistryUrl: request.registry }));
    expect(mocks.invoke.mock.calls.some(([command]) => command === "install_registry_theme")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ }));
    await screen.findByText("themePackages.installedHint");
    expect(mocks.invoke).toHaveBeenCalledWith("install_registry_theme", { packageName: request.slug, expectedRegistryKey: snapshot.registryKey, version: request.version });
    expect(driverInstall).not.toHaveBeenCalled();
  });
  it("does not offer installation when native lookup returns no matching package", async () => {
    mocks.invoke.mockImplementation(async (command) => command === "fetch_tabularium_plugin_preview" ? { ...plugin, kind: "theme" } : { ...snapshot, plugins: [{ ...plugin, id: "different-theme" }] });
    const driverInstall = vi.fn();
    render(<PluginInstallConfirmModal request={request} busy={false} error={null} onConfirm={driverInstall} onCancel={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("themePackages.noThemes");
    expect(screen.queryByRole("button", { name: /settings\.plugins\.(install|update)/ })).not.toBeInTheDocument();
    expect(driverInstall).not.toHaveBeenCalled(); expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});
