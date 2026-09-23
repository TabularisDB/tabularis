import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeRegistryInstall } from "../../../src/components/modals/ThemeRegistryInstall";

vi.mock("../../../src/hooks/useTabularisClient", () => import("../../support/tauriBackedHooks"));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => import("../../support/tauriBackedHooks"));
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), refreshCatalog: vi.fn() }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, args?: { count?: string }) => args?.count ? `${key}: ${args.count}` : key, i18n: { language: "en" } }) }));

const plugin = { id: "fixture-theme", name: "Fixture theme", description: "Test", author: "Author", latest_version: "1.0.0", downloads: 1200, releases: [{ version: "1.0.0", min_tabularis_version: "0.24.0", assets: { universal: "https://example.invalid/theme.zip" } }] };
const snapshot = { registryKey: "a".repeat(64), registryUrl: "https://example.invalid", plugins: [plugin] };

beforeEach(() => {
  vi.clearAllMocks(); mocks.refreshCatalog.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "fetch_theme_package_detail") return plugin;
    if (command === "install_registry_theme") return { warnings: [] };
    throw new Error(`Unexpected ${command}`);
  });
});

describe("explicit theme registry install", () => {
  it("displays locale-aware counts and only installs after confirmation", async () => {
    render(<ThemeRegistryInstall isOpen onClose={vi.fn()} snapshot={snapshot} plugin={plugin} onCommitted={mocks.refreshCatalog} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ })).toBeEnabled());
    expect(screen.getByLabelText("themePackages.downloads: 1,200")).toHaveTextContent("1.2K");
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["fetch_theme_package_detail"]);
    fireEvent.click(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ }));
    await screen.findByText("themePackages.installedHint");
    expect(mocks.invoke).toHaveBeenCalledWith("install_registry_theme", { packageName: plugin.id, expectedRegistryKey: snapshot.registryKey, version: null });
    expect(mocks.refreshCatalog).toHaveBeenCalledOnce();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "save_config" || command === "install_plugin")).toBe(false);
  });

  it("pins explicit releases and binds the deep-link registry before confirmation", async () => {
    render(<ThemeRegistryInstall isOpen onClose={vi.fn()} snapshot={snapshot} plugin={plugin} initialVersion="1.0.0" requestedRegistry="https://example.invalid" onCommitted={mocks.refreshCatalog} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ })).toBeEnabled());
    expect(mocks.invoke).toHaveBeenCalledWith("fetch_theme_package_detail", expect.objectContaining({ requestedRegistryUrl: "https://example.invalid" }));
    fireEvent.click(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ }));
    await screen.findByText("themePackages.installedHint");
    expect(mocks.invoke).toHaveBeenCalledWith("install_registry_theme", expect.objectContaining({ version: "1.0.0" }));
  });

  it("keeps committed success distinct from failed refresh and prevents duplicate downloads", async () => {
    mocks.refreshCatalog.mockRejectedValueOnce(new Error("refresh failed"));
    render(<ThemeRegistryInstall isOpen onClose={vi.fn()} snapshot={snapshot} plugin={plugin} onCommitted={mocks.refreshCatalog} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ }));
    await screen.findByText(/themePackages.committedRefreshFailed/);
    expect(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ })).toBeDisabled();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "install_registry_theme")).toHaveLength(1);
  });

  it("blocks incompatible versions without downloads", async () => {
    mocks.invoke.mockResolvedValueOnce({ ...plugin, releases: [{ ...plugin.releases[0], min_tabularis_version: "99.0.0" }] });
    render(<ThemeRegistryInstall isOpen onClose={vi.fn()} snapshot={snapshot} plugin={plugin} onCommitted={mocks.refreshCatalog} />);
    await screen.findByText("themePackages.incompatible");
    expect(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ })).toBeDisabled();
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("closes with Escape without installing", async () => {
    const close = vi.fn();
    render(<ThemeRegistryInstall isOpen onClose={close} snapshot={snapshot} plugin={plugin} onCommitted={mocks.refreshCatalog} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /settings\.plugins\.(install|update)/ })).toBeEnabled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("discards metadata responses after its dialog is disposed", async () => {
    let finish!: (value: typeof plugin) => void;
    mocks.invoke.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = render(<ThemeRegistryInstall isOpen onClose={vi.fn()} snapshot={snapshot} plugin={plugin} onCommitted={mocks.refreshCatalog} />);
    view.unmount(); finish(plugin); await Promise.resolve();
    expect(screen.queryByText("Fixture theme")).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });
});
