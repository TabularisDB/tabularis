import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import { PluginsTab } from "../../../src/components/settings/PluginsTab";
import { usePluginRegistry } from "../../../src/hooks/usePluginRegistry";
import { getPluginUpdates } from "../../../src/utils/pluginUpdates";
import { APP_VERSION } from "../../../src/version";
import en from "../../../src/i18n/locales/en.json";
import type { RegistryPluginWithStatus, PluginManifest } from "../../../src/types/plugins";
import type { ResolvedThemeCatalog } from "../../../src/types/themeCatalog";
import { resolveNativeCatalog } from "../../../src/utils/themeCatalog";

vi.mock("../../../src/hooks/useTabularisClient", () => import("../../support/tauriBackedHooks"));
vi.mock("../../../src/hooks/usePlatformCapabilities", () => import("../../support/tauriBackedHooks"));
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: i18n.t.bind(i18n) }) }));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../../src/hooks/usePluginRegistry", () => ({ usePluginRegistry: vi.fn() }));
const mocks = vi.hoisted(() => ({
  refreshDrivers: vi.fn(), refreshRegistry: vi.fn(), updateSetting: vi.fn().mockResolvedValue(undefined), refreshCatalog: vi.fn().mockResolvedValue(undefined),
  catalog: { themes: [], issues: [] } as ResolvedThemeCatalog,
}));
vi.mock("../../../src/hooks/useDrivers", () => ({ useDrivers: () => ({
  allDrivers: [builtin, driver],
  installedPlugins: [driver, { id: "redis", name: "Redis", version: "1.0.0", description: "Redis driver" }, { id: "local", name: "Local driver", version: "1.0.0", description: "Not in registry" }],
  refresh: mocks.refreshDrivers,
}) }));
vi.mock("../../../src/hooks/useSettings", () => ({ useSettings: () => ({
  settings: { activeExternalDrivers: ["postgresql"] }, updateSetting: mocks.updateSetting,
}) }));
vi.mock("../../../src/hooks/useDatabase", () => ({ useDatabase: () => ({
  openConnectionIds: [], connectionDataMap: {}, disconnect: vi.fn(), connections: [],
}) }));
vi.mock("../../../src/components/ui/SlotAnchor", () => ({ SlotAnchor: () => null }));
vi.mock("../../../src/components/modals/PluginInstallErrorModal", () => ({ PluginInstallErrorModal: () => null }));
vi.mock("../../../src/components/modals/PluginReadmeModal", () => ({ PluginReadmeModal: () => null }));
vi.mock("../../../src/components/modals/PluginStartErrorModal", () => ({ PluginStartErrorModal: () => null }));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => ({ refreshCatalog: mocks.refreshCatalog, catalog: mocks.catalog }) }));

const driver: PluginManifest = {
  id: "postgresql", name: "PostgreSQL", version: "2.0.0", description: "PostgreSQL driver", default_port: 5432,
  capabilities: { schemas: true, views: true, routines: true, file_based: false, folder_based: false, identifier_quote: '"', alter_primary_key: true },
};
const builtin: PluginManifest = { ...driver, id: "sqlite", name: "SQLite", is_builtin: true };
const plugin: RegistryPluginWithStatus = {
  id: "postgresql", name: "PostgreSQL", description: "PostgreSQL driver", author: "Tabularis", homepage: "",
  installed_version: "2.0.0", latest_version: "2.0.0", update_available: false, platform_supported: true,
  releases: ["2.0.0", "1.0.0", "0.5.0"].map((version) => ({ version, platform_supported: true, min_tabularis_version: null })),
};
const redis: RegistryPluginWithStatus = { ...plugin, id: "redis", name: "Redis", description: "Redis driver", installed_version: "1.0.0", update_available: true };
const mongo: RegistryPluginWithStatus = { ...plugin, id: "mongodb", name: "MongoDB", description: "MongoDB driver", installed_version: null };
const nord: RegistryPluginWithStatus = {
  ...plugin, id: "nord-theme", name: "Nord", description: "Nord theme", kind: "theme", installed_version: null, latest_version: "1.2.0", update_available: false,
  releases: ["1.2.0", "1.0.0"].map((version) => ({ version, platform_supported: true, min_tabularis_version: null })),
};
const dracula: RegistryPluginWithStatus = { ...nord, id: "dracula-theme", name: "Dracula", description: "Dracula theme", installed_version: "1.0.0", update_available: true };

function setRegistry(plugins: RegistryPluginWithStatus[]) {
  vi.mocked(usePluginRegistry).mockReturnValue({ plugins, updates: getPluginUpdates(plugins, APP_VERSION), loading: false, error: null, refresh: mocks.refreshRegistry });
}
function renderTab(filter = "all", kind?: "driver" | "theme") {
  const query = `tab=plugins&filter=${filter}${kind ? `&kind=${kind}` : ""}`;
  return render(<MemoryRouter initialEntries={[`/settings?${query}`]}><PluginsTab /></MemoryRouter>);
}
function card(name: string) {
  const element = screen.getByText(name).closest("div.group");
  if (!(element instanceof HTMLElement)) throw new Error(`Missing card: ${name}`);
  return within(element);
}

describe("PluginsTab filters and version controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog = { themes: [], issues: [] };
    setRegistry([plugin, redis, mongo]);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      if (command === "install_plugin" || command === "cancel_plugin_install") return;
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it.each(["installed", "all"])("shows manually copied themes offline in %s and refreshes disk discovery", (filter) => {
    mocks.catalog = resolveNativeCatalog({ themes: [{
      id: `theme:${"a".repeat(64)}:ember-theme:dark`, name: "Ember Dark", revision: "fixture",
      origin: { kind: "installed", identity: { registryKey: "a".repeat(64), packageName: "ember-theme", variantId: "dark" }, packageVersion: "1.0.0" },
      readOnly: true, mode: "dark", format: "v1", source: '{"schemaVersion":1,"mode":"dark"}', available: true,
    }], issues: [] });
    vi.mocked(usePluginRegistry).mockReturnValue({ plugins: [], updates: [], loading: false, error: "Offline", refresh: mocks.refreshRegistry });
    renderTab(filter, "theme");
    expect(screen.getByText("ember-theme")).toBeInTheDocument();
    expect(card("ember-theme").getByRole("button", { name: "Manage in Appearance" })).toBeInTheDocument();
    expect(card("ember-theme").queryByRole("button", { name: /Install|Update|Downgrade/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mocks.refreshCatalog).toHaveBeenCalled();
    expect(mocks.refreshDrivers).toHaveBeenCalled();
    expect(mocks.refreshRegistry).toHaveBeenCalled();
  });

  it("shows both installed and uninstalled catalogue plugins in All and counts them all", () => {
    renderTab();
    expect(screen.getByRole("button", { name: /^All\s*\d*$/ })).toHaveTextContent("3");
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("MongoDB")).toBeInTheDocument();
    expect(card("PostgreSQL").getByText("Installed v2.0.0")).toBeInTheDocument();
    expect(card("MongoDB").getByRole("button", { name: "Install v2.0.0" })).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "PostgreSQL" } });
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.queryByText("MongoDB")).not.toBeInTheDocument();
  });

  it("keeps Installed limited to installed/built-in plugins, including offline/local entries", () => {
    renderTab("installed");
    expect(screen.getByRole("button", { name: /^Installed/ })).toHaveTextContent("4");
    expect(screen.queryByText("MongoDB")).not.toBeInTheDocument();
    expect(card("SQLite").queryByRole("button", { name: /versions|Update|Downgrade/ })).not.toBeInTheDocument();
    expect(card("Local driver").getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(card("PostgreSQL").getByRole("button", { name: "Older versions" })).toBeInTheDocument();
    expect(card("Redis").getByRole("button", { name: "Update v2.0.0" })).toBeInTheDocument();
  });

  it.each(["all", "installed"])("allows downgrading an up-to-date plugin from %s", async (filter) => {
    renderTab(filter);
    fireEvent.click(card("PostgreSQL").getByRole("button", { name: "Older versions" }));
    fireEvent.click(screen.getByRole("option", { name: /^v1.0.0/ }));
    fireEvent.click(card("PostgreSQL").getByRole("button", { name: "Downgrade to v1.0.0" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_plugin", { pluginId: "postgresql", version: "1.0.0" }));
    await waitFor(() => expect(mocks.refreshRegistry).toHaveBeenCalled());
    expect(mocks.refreshDrivers).toHaveBeenCalled();
    expect(card("PostgreSQL").getByRole("button", { name: "Older versions" })).toBeInTheDocument();
  });

  it("lets disabled plugins choose a version while retaining enable/settings/remove controls", async () => {
    renderTab("installed");
    expect(card("Redis").getByRole("button", { name: "Enable plugin" })).toBeInTheDocument();
    expect(card("Redis").getByRole("button", { name: "Remove" })).toBeInTheDocument();
    fireEvent.click(card("Redis").getByRole("button", { name: "Older versions" }));
    fireEvent.click(screen.getByRole("option", { name: /^v0.5.0/ }));
    expect(card("Redis").getByRole("button", { name: "v0.5.0" })).toBeInTheDocument();
    fireEvent.click(card("Redis").getByRole("button", { name: "Downgrade to v0.5.0" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_plugin", { pluginId: "redis", version: "0.5.0" }));
  });

  it("does not offer reinstall when selecting the installed version of an outdated plugin", () => {
    renderTab("installed");
    fireEvent.click(card("Redis").getByRole("button", { name: "Older versions" }));
    fireEvent.click(screen.getByRole("option", { name: /v1\.0\.0.*installed/i }));
    expect(card("Redis").queryByRole("button", { name: /Update|Downgrade|Install / })).not.toBeInTheDocument();
    expect(card("Redis").getByText("Installed v1.0.0")).toBeInTheDocument();
  });

  it.each(["all", "installed", "updates"])("uses the same compact update presentation in %s", (filter) => {
    renderTab(filter);
    expect(card("Redis").getByRole("img", { name: "Driver update available" }).textContent).toBe("v2.0.0");
    const root = screen.getByText("Redis").closest("div.group");
    expect(root).toHaveClass("rounded-2xl", "border-strong");
    expect(root?.querySelector(".w-11.h-11")).not.toBeNull();
    expect(root?.querySelector("[class*='animate-']")).toBeNull();
  });

  it("keeps Updates restricted to compatible updates and provides the same version controls", () => {
    renderTab("updates");
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.queryByText("PostgreSQL")).not.toBeInTheDocument();
    expect(screen.queryByText("MongoDB")).not.toBeInTheDocument();
    expect(card("Redis").getByRole("button", { name: "Older versions" })).toBeInTheDocument();
  });

  it("preserves the chosen version when switching from All to Installed", () => {
    renderTab();
    fireEvent.click(card("PostgreSQL").getByRole("button", { name: "Older versions" }));
    fireEvent.click(screen.getByRole("option", { name: /^v1.0.0/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Installed/ }));
    expect(card("PostgreSQL").getByRole("button", { name: "Downgrade to v1.0.0" })).toBeEnabled();
  });

  it("blocks incompatible versions but still lets the user choose a supported release", () => {
    setRegistry([{ ...redis, releases: redis.releases.map((release) => release.version === "2.0.0" ? { ...release, min_tabularis_version: "99.0.0" } : release) }]);
    renderTab("installed");
    expect(card("Redis").getByRole("button", { name: "Update v2.0.0" })).toBeDisabled();
    expect(card("Redis").queryByLabelText("Driver update available")).not.toBeInTheDocument();
    fireEvent.click(card("Redis").getByRole("button", { name: "Older versions" }));
    fireEvent.click(screen.getByRole("option", { name: /^v0.5.0/ }));
    expect(card("Redis").getByRole("button", { name: "Downgrade to v0.5.0" })).toBeEnabled();
  });

  it("retains cancellation and prevents a second installation from Installed", async () => {
    let finishInstall: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      if (command === "install_plugin") return new Promise<void>((resolve) => { finishInstall = resolve; });
      if (command === "cancel_plugin_install") return true;
    });
    renderTab("installed");
    fireEvent.click(card("Redis").getByRole("button", { name: "Update v2.0.0" }));
    expect(card("Redis").getByRole("button", { name: "Cancel" })).toBeEnabled();
    fireEvent.click(card("PostgreSQL").getByRole("button", { name: "Older versions" }));
    fireEvent.click(screen.getByRole("option", { name: /^v1.0.0/ }));
    expect(card("PostgreSQL").getByRole("button", { name: "Downgrade to v1.0.0" })).toBeDisabled();
    fireEvent.click(card("Redis").getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("cancel_plugin_install", { pluginId: "redis" }));
    await act(async () => finishInstall?.());
  });

});

describe("PluginsTab kind filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog = { themes: [], issues: [] };
    setRegistry([plugin, redis, mongo, nord, dracula]);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("shows every kind by default and narrows the list and counts through the kind selector", () => {
    renderTab();
    const kinds = within(screen.getByRole("group", { name: "Filter by type" }));
    expect(kinds.getByRole("button", { name: /^All types/ })).toHaveAttribute("aria-pressed", "true");
    expect(kinds.getByRole("button", { name: /^Drivers/ })).toHaveTextContent("3");
    expect(kinds.getByRole("button", { name: /^Themes/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /^All\s*\d*$/ })).toHaveTextContent("5");
    expect(screen.getByText("Nord")).toBeInTheDocument();
    expect(card("Nord").getByText("Theme")).toBeInTheDocument();

    fireEvent.click(kinds.getByRole("button", { name: /^Themes/ }));
    expect(kinds.getByRole("button", { name: /^Themes/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^All\s*\d*$/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /^Updates/ })).toHaveTextContent("1");
    expect(screen.queryByText("PostgreSQL")).not.toBeInTheDocument();
    expect(screen.getByText("Dracula")).toBeInTheDocument();

    fireEvent.click(kinds.getByRole("button", { name: /^Drivers/ }));
    expect(screen.queryByText("Nord")).not.toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
  });

  it("installs and updates themes in place through the theme installer, never install_plugin", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      if (command === "fetch_theme_registry") return { registryKey: "k".repeat(64), registryUrl: "http://127.0.0.1:49191", plugins: [] };
      if (command === "install_registry_theme") return { warnings: [] };
      throw new Error(`Unexpected command: ${command}`);
    });
    renderTab("all", "theme");
    expect(card("Dracula").getByText("Installed v1.0.0")).toBeInTheDocument();
    fireEvent.click(card("Nord").getByRole("button", { name: "Install v1.2.0" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_registry_theme", { packageName: "nord-theme", expectedRegistryKey: "k".repeat(64), version: "1.2.0" }));
    await waitFor(() => expect(mocks.refreshCatalog).toHaveBeenCalled());
    expect(mocks.refreshRegistry).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("install_plugin", expect.anything());
    expect(mocks.updateSetting).not.toHaveBeenCalled();
    fireEvent.click(card("Dracula").getByRole("button", { name: "Older versions" }));
    fireEvent.click(screen.getByRole("option", { name: /^v1.2.0/ }));
    fireEvent.click(card("Dracula").getByRole("button", { name: "Update v1.2.0" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_registry_theme", expect.objectContaining({ packageName: "dracula-theme", version: "1.2.0" })));
  });

  it("lists installed themes under Installed with a shortcut to Appearance", () => {
    renderTab("installed", "theme");
    expect(screen.getByRole("button", { name: /^Installed/ })).toHaveTextContent("1");
    expect(screen.queryByText("PostgreSQL")).not.toBeInTheDocument();
    expect(screen.queryByText("SQLite")).not.toBeInTheDocument();
    expect(screen.queryByText("Nord")).not.toBeInTheDocument();
    expect(card("Dracula").getByRole("button", { name: "Manage in Appearance" })).toBeInTheDocument();
    expect(card("Dracula").getByRole("button", { name: "Update v1.2.0" })).toBeInTheDocument();
  });

  it("keeps installed drivers and themes together when no kind is selected", () => {
    renderTab("installed");
    expect(screen.getByRole("button", { name: /^Installed/ })).toHaveTextContent("5");
    expect(screen.getByText("SQLite")).toBeInTheDocument();
    expect(screen.getByText("Dracula")).toBeInTheDocument();
    expect(screen.queryByText("Nord")).not.toBeInTheDocument();
  });
});

function setThemePackage(available: boolean) {
  mocks.catalog = resolveNativeCatalog({ themes: ["dark", "light"].map((variantId) => ({
    id: `theme:${"a".repeat(64)}:ember-theme:${variantId}`, name: `Ember ${variantId}`, revision: "fixture",
    origin: { kind: "installed" as const, identity: { registryKey: "a".repeat(64), packageName: "ember-theme", variantId }, packageVersion: "1.0.0" },
    readOnly: true, mode: "dark" as const, format: "v1" as const, source: '{"schemaVersion":1,"mode":"dark"}', available,
  })), issues: [] });
  return mocks.catalog;
}

describe("PluginsTab theme package toggles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshCatalog.mockReset().mockResolvedValue(undefined);
    setThemePackage(true);
    setRegistry([]);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      if (command === "set_theme_package_enabled") return;
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it.each([
    ["installed", false], ["all", false], ["installed", true], ["all", true], ["updates", true],
  ])("disables all variants from %s (registry: %s) without changing driver or theme preferences", async (filter, remote) => {
    if (remote) setRegistry([{ ...dracula, id: "ember-theme", name: "Ember" }]);
    mocks.refreshCatalog.mockImplementationOnce(async () => setThemePackage(false));
    renderTab(String(filter), "theme");
    const name = remote ? "Ember" : "ember-theme";
    const toggle = card(name).getByRole("button", { name: "Disable package" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(card(name).getAllByRole("button", { name: "Disable package" })).toHaveLength(1);
    fireEvent.click(toggle);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_theme_package_enabled", {
      packageName: "ember-theme", registryKey: "a".repeat(64), enabled: false,
    }));
    await waitFor(() => expect(card(name).getByRole("button", { name: "Enable package" })).toHaveAttribute("aria-pressed", "false"));
    expect(card(name).getByText("Disabled")).toBeInTheDocument();
    expect(mocks.refreshCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.updateSetting).not.toHaveBeenCalled();
    expect(mocks.refreshDrivers).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("disable_plugin", expect.anything());
  });

  it("reenables a disabled local theme using its native package identity", async () => {
    setThemePackage(false);
    mocks.refreshCatalog.mockImplementationOnce(async () => setThemePackage(true));
    renderTab("installed", "theme");
    fireEvent.click(card("ember-theme").getByRole("button", { name: "Enable package" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_theme_package_enabled", {
      packageName: "ember-theme", registryKey: "a".repeat(64), enabled: true,
    }));
    await waitFor(() => expect(card("ember-theme").getByRole("button", { name: "Disable package" })).toHaveAttribute("aria-pressed", "true"));
    expect(card("ember-theme").queryByText("Disabled")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("enable_plugin", expect.anything());
    expect(mocks.updateSetting).not.toHaveBeenCalled();
  });

  it("blocks duplicate clicks until the mutation and catalog refresh finish", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    mocks.refreshCatalog.mockReturnValueOnce(pending);
    renderTab("installed", "theme");
    const toggle = card("ember-theme").getByRole("button", { name: "Disable package" });
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.refreshCatalog).toHaveBeenCalled());
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_theme_package_enabled")).toHaveLength(1);
    await act(async () => { finish(); });
    expect(toggle).toBeEnabled();
  });

  it("surfaces native errors without faking disabled state", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      throw new Error("Theme storage is locked");
    });
    renderTab("installed", "theme");
    fireEvent.click(card("ember-theme").getByRole("button", { name: "Disable package" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Theme storage is locked"));
    expect(card("ember-theme").getByRole("button", { name: "Disable package" })).toBeEnabled();
    expect(card("ember-theme").queryByText("Disabled")).not.toBeInTheDocument();
    expect(mocks.refreshCatalog).not.toHaveBeenCalled();
  });

  it("distinguishes a committed toggle from a failed catalog refresh", async () => {
    mocks.refreshCatalog.mockRejectedValueOnce(new Error("Catalog unavailable"));
    renderTab("installed", "theme");
    fireEvent.click(card("ember-theme").getByRole("button", { name: "Disable package" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(en.themePackages.committedRefreshFailed));
    expect(screen.getByRole("alert")).toHaveTextContent("Catalog unavailable");
    expect(mocks.updateSetting).not.toHaveBeenCalled();
  });

  it("does not invent an enabled state from registry version metadata alone", () => {
    mocks.catalog = { themes: [], issues: [] };
    setRegistry([nord, dracula]);
    renderTab("all", "theme");
    expect(screen.queryByRole("button", { name: /^(Enable|Disable) package$/ })).not.toBeInTheDocument();
  });
});

describe("PluginsTab theme package removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshCatalog.mockReset().mockResolvedValue(undefined);
    mocks.refreshRegistry.mockReset().mockResolvedValue(undefined);
    setThemePackage(true);
    setRegistry([]);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      if (command === "uninstall_theme_package") return { warnings: [] };
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it.each([
    ["installed", false, true], ["all", false, false],
    ["installed", true, false], ["all", true, true], ["updates", true, true],
  ])("removes an enabled or disabled package from %s (registry: %s, enabled: %s) after confirmation", async (filter, remote, available) => {
    setThemePackage(Boolean(available));
    if (remote) setRegistry([{ ...dracula, id: "ember-theme", name: "Ember" }]);
    mocks.refreshCatalog.mockImplementationOnce(async () => {
      mocks.catalog = { themes: [], issues: [] };
    });
    mocks.refreshRegistry.mockImplementationOnce(async () => {
      setRegistry(remote ? [{ ...nord, id: "ember-theme", name: "Ember" }] : []);
    });
    renderTab(String(filter), "theme");
    const name = remote ? "Ember" : "ember-theme";
    expect(card(name).getAllByRole("button", { name: "Uninstall package" })).toHaveLength(1);
    fireEvent.click(card(name).getByRole("button", { name: "Uninstall package" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Plugin" });
    expect(dialog).toHaveAccessibleDescription(i18n.t("settings.plugins.confirmRemove", { name }));
    expect(within(dialog).getByText(en.themePackages.packageWarning)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("uninstall_theme_package", expect.anything());
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("uninstall_theme_package", {
      registryKey: "a".repeat(64), packageName: "ember-theme",
    });
    expect(mocks.refreshCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.refreshRegistry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Uninstall package" })).not.toBeInTheDocument();
    expect(mocks.updateSetting).not.toHaveBeenCalled();
    expect(mocks.refreshDrivers).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("uninstall_plugin", expect.anything());
  });

  it("cancels without uninstalling the package", () => {
    renderTab("installed", "theme");
    fireEvent.click(card("ember-theme").getByRole("button", { name: "Uninstall package" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("uninstall_theme_package", expect.anything());
    expect(mocks.refreshCatalog).not.toHaveBeenCalled();
  });

  it("uses the same confirmation for drivers without the theme warning", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      if (command === "uninstall_plugin") return;
      throw new Error(`Unexpected command: ${command}`);
    });
    renderTab("installed");
    fireEvent.click(card("PostgreSQL").getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Plugin" });
    expect(dialog).toHaveAccessibleDescription(i18n.t("settings.plugins.confirmRemove", { name: "PostgreSQL" }));
    expect(within(dialog).queryByText(en.themePackages.packageWarning)).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("uninstall_plugin", expect.anything());
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("uninstall_plugin", { pluginId: "postgresql" }));
    await waitFor(() => expect(mocks.refreshDrivers).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("uninstall_theme_package", expect.anything());
  });

  it("blocks duplicate removal and closing until catalog refresh finishes", async () => {
    let finish!: () => void;
    mocks.refreshCatalog.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    renderTab("installed", "theme");
    fireEvent.click(card("ember-theme").getByRole("button", { name: "Uninstall package" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Remove" });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.refreshCatalog).toHaveBeenCalled());
    expect(confirm).toBeDisabled();
    expect(within(dialog).getAllByRole("button", { name: "Close" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    fireEvent.click(confirm);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "uninstall_theme_package")).toHaveLength(1);
    await act(async () => { finish(); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps native failures visible and allows retrying", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_plugin_startup_errors") return [];
      throw new Error("Theme storage is locked");
    });
    renderTab("installed", "theme");
    fireEvent.click(card("ember-theme").getByRole("button", { name: "Uninstall package" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Theme storage is locked"));
    expect(confirm).toBeEnabled();
    expect(mocks.refreshCatalog).not.toHaveBeenCalled();
    expect(mocks.refreshRegistry).not.toHaveBeenCalled();
  });

  it.each(["catalog", "registry"])("does not repeat a committed removal when %s refresh fails", async (source) => {
    (source === "catalog" ? mocks.refreshCatalog : mocks.refreshRegistry).mockRejectedValueOnce(new Error("Refresh unavailable"));
    renderTab("installed", "theme");
    fireEvent.click(card("ember-theme").getByRole("button", { name: "Uninstall package" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(en.themePackages.committedRefreshFailed));
    expect(confirm).toBeDisabled();
    expect(mocks.refreshCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.refreshRegistry).toHaveBeenCalledTimes(1);
  });

  it("shows cleanup warnings after successful removal without allowing a second uninstall", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => command === "get_plugin_startup_errors"
      ? [] : { warnings: ["Theme removed; deferred cleanup"] });
    renderTab("installed", "theme");
    fireEvent.click(card("ember-theme").getByRole("button", { name: "Uninstall package" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Theme removed; deferred cleanup"));
    expect(confirm).toBeDisabled();
    expect(mocks.refreshCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.refreshRegistry).toHaveBeenCalledTimes(1);
  });
});
