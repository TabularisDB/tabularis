import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import en from "../../src/i18n/locales/en.json";
import itLocale from "../../src/i18n/locales/it.json";
import { Settings } from "../../src/pages/Settings";
import { PluginUpdateToast } from "../../src/components/plugins/PluginUpdateToast";
import { ToastProvider } from "../../src/contexts/ToastProvider";
import { useAvailableUpdates } from "../../src/hooks/useAvailableUpdates";
import { NavItem } from "../../src/components/layout/sidebar/NavItem";
import { UpdateBadge } from "../../src/components/ui/UpdateBadge";
import { usePluginRegistry } from "../../src/hooks/usePluginRegistry";
import { useUpdate } from "../../src/hooks/useUpdate";
import type { RegistryPluginWithStatus } from "../../src/types/plugins";

const i18n = createInstance();
await i18n.init({
  lng: "it",
  fallbackLng: "en",
  resources: { en: { translation: en }, it: { translation: itLocale } },
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: i18n.t.bind(i18n) }),
}));
vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("../../src/hooks/usePluginRegistry", () => ({
  usePluginRegistry: vi.fn(),
}));
vi.mock("../../src/hooks/useUpdate", () => ({ useUpdate: vi.fn() }));
vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {}, isLoading: false, updateSetting: vi.fn() }),
}));
vi.mock("../../src/hooks/useDrivers", () => ({
  useDrivers: () => ({
    allDrivers: [
      {
        id: "mysql",
        name: "MySQL",
        is_builtin: true,
        settings: [{ key: "pool" }],
      },
    ],
    installedPlugins: [],
    refresh: vi.fn(),
  }),
}));
vi.mock("../../src/components/modals/ConfigJsonModal", () => ({
  ConfigJsonModal: () => null,
}));
vi.mock("../../src/components/settings/PluginsTab", () => ({
  PluginsTab: () => {
    const [params] = useSearchParams();
    return (
      <div data-testid="plugins-content">{params.get("filter") ?? "all"}</div>
    );
  },
}));
vi.mock("../../src/components/settings/GeneralTab", () => ({
  GeneralTab: () => <div>GeneralTab</div>,
}));
vi.mock("../../src/components/settings/PrivacyTab", () => ({
  PrivacyTab: () => <div>PrivacyTab</div>,
}));
vi.mock("../../src/components/settings/AppearanceTab", () => ({
  AppearanceTab: () => <div>AppearanceTab</div>,
}));
vi.mock("../../src/components/settings/LocalizationTab", () => ({
  LocalizationTab: () => <div>LocalizationTab</div>,
}));
vi.mock("../../src/components/settings/AiTab", () => ({
  AiTab: () => <div>AiTab</div>,
}));
vi.mock("../../src/components/settings/LogsTab", () => ({
  LogsTab: () => <div>LogsTab</div>,
}));
vi.mock("../../src/components/settings/ShortcutsTab", () => ({
  ShortcutsTab: () => <div>ShortcutsTab</div>,
}));
vi.mock("../../src/components/settings/SshTab", () => ({
  SshTab: () => <div>SshTab</div>,
}));
vi.mock("../../src/components/settings/BackupTab", () => ({
  BackupTab: () => <div>BackupTab</div>,
}));
vi.mock("../../src/components/settings/StorageTab", () => ({
  StorageTab: () => <div>StorageTab</div>,
}));
vi.mock("../../src/components/settings/NetworkTab", () => ({
  NetworkTab: () => <div>NetworkTab</div>,
}));
vi.mock("../../src/components/settings/AiActivityPanel", () => ({
  AiActivityPanel: () => <div>AiActivityPanel</div>,
}));
vi.mock("../../src/components/settings/InfoTab", () => ({
  InfoTab: () => <div>InfoTab</div>,
}));
vi.mock("../../src/components/settings/PluginSettingsPage", () => ({
  PluginSettingsPage: () => <div>PluginSettingsPage</div>,
}));

const plugin: RegistryPluginWithStatus = {
  id: "postgresql",
  name: "PostgreSQL",
  description: "",
  author: "",
  homepage: "",
  installed_version: "1.0.0",
  latest_version: "2.0.0",
  update_available: true,
  platform_supported: true,
  releases: [],
};

function SettingsLink() {
  const updates = useAvailableUpdates();
  return (
    <NavItem
      to="/settings"
      icon={() => null}
      label="Impostazioni"
      tooltip={updates.summary}
      badge={<UpdateBadge count={updates.totalCount} tooltip={updates.summary} />}
    />
  );
}

function renderApp(path = "/settings") {
  return render(
    <StrictMode>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <PluginUpdateToast />
          <SettingsLink />
          <Routes>
            <Route path="/connections" element={<div>Connections</div>} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </StrictMode>,
  );
}

describe("update navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePluginRegistry).mockReturnValue({
      plugins: [],
      updates: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    vi.mocked(useUpdate).mockReturnValue({
      updateInfo: null,
      availableUpdate: null,
      isChecking: false,
      isDownloading: false,
      downloadProgress: 0,
      checkForUpdates: vi.fn(),
      downloadAndInstall: vi.fn(),
      dismissUpdate: vi.fn(),
      error: null,
      isUpToDate: true,
      installationSource: null,
    });
  });

  it("hides update badges even when built-in driver settings exist", () => {
    renderApp();
    expect(screen.getByRole("button", { name: "MySQL" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("link", { name: "Impostazioni" })
        .querySelector("[title]"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Plugin" }).querySelector("[title]"),
    ).toBeNull();
  });

  it("aggregates the rail counter and splits core/plugin counts in the settings navigation", () => {
    vi.mocked(useUpdate).mockReturnValue({
      ...useUpdate(),
      availableUpdate: {
        hasUpdate: true,
        currentVersion: "0.24.0",
        latestVersion: "0.25.0",
        releaseNotes: "",
        releaseUrl: "",
        publishedAt: "",
        downloadUrls: [],
      },
    });
    vi.mocked(usePluginRegistry).mockReturnValue({
      ...usePluginRegistry(),
      updates: [plugin, { ...plugin, id: "redis", name: "Redis" }],
    });
    renderApp();
    const link = screen.getByRole("link", { name: /^Impostazioni:/ });
    expect(link).not.toHaveAttribute("title");
    expect(link.querySelector("[title]")).toBeNull();
    const railBadge = within(link).getByLabelText("1 aggiornamento core disponibile, 2 aggiornamenti plugins disponibili");
    expect(railBadge).toHaveTextContent("3");
    expect(railBadge.style.backgroundColor).toContain("--accent-primary");
    const pluginsButton = screen.getByRole("button", { name: /^Plugin/ });
    const pluginBadge = within(pluginsButton).getByLabelText("2 aggiornamenti plugins disponibili");
    fireEvent.mouseEnter(pluginBadge);
    expect(screen.getByRole("tooltip")).toHaveTextContent("PostgreSQL 1.0.0 → 2.0.0");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Redis 1.0.0 → 2.0.0");
    expect(within(screen.getByRole("tooltip")).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.mouseLeave(pluginBadge);
    const infoButton = screen.getByRole("button", { name: /^Info/ });
    const coreBadge = within(infoButton).getByText("1");
    fireEvent.focus(infoButton);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Tabularis 0.25.0 è disponibile");
    // Same pill everywhere: the rail, Info and Plugins counters share tone and shape.
    for (const badge of [railBadge, coreBadge, pluginBadge]) {
      expect(badge).toHaveClass("rounded-full");
      expect(badge.style.backgroundColor).toBe(railBadge.style.backgroundColor);
    }
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("bounds a long plugin list and closes the tooltip with Escape", () => {
    vi.mocked(usePluginRegistry).mockReturnValue({
      ...usePluginRegistry(),
      updates: Array.from({ length: 12 }, (_, index) => ({ ...plugin, id: `plugin-${index}`, name: `Plugin ${index}` })),
    });
    renderApp();
    const button = screen.getByRole("button", { name: /^Plugin/ });
    fireEvent.focus(button);
    const tooltip = screen.getByRole("tooltip");
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
    expect(within(tooltip).getAllByRole("listitem")).toHaveLength(6);
    expect(tooltip).toHaveTextContent("Plugin 4 1.0.0 → 2.0.0");
    expect(tooltip).not.toHaveTextContent("Plugin 5");
    expect(tooltip).toHaveTextContent("Altri 7");
    expect(tooltip.parentElement).toBe(document.body);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("opens the updates filter by clicking the startup toast and does not repeat on navigation", async () => {
    vi.mocked(usePluginRegistry).mockReturnValue({
      ...usePluginRegistry(),
      updates: [plugin],
    });
    renderApp("/connections");
    const toast = screen.getByRole("status");
    expect(toast.parentElement).toHaveClass("bottom-4", "right-4");
    fireEvent.click(
      within(toast).getByRole("button", {
        name: /Aggiornamenti dei plugin disponibili/,
      }),
    );
    expect(await screen.findByTestId("plugins-content")).toHaveTextContent(
      "updates",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    fireEvent.click(screen.getByRole("button", { name: /^Plugin/ }));
    expect(screen.getByTestId("plugins-content")).toHaveTextContent("all");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("navigates to Plugins from the toast even when Settings is already open", async () => {
    vi.mocked(usePluginRegistry).mockReturnValue({
      ...usePluginRegistry(),
      updates: [plugin],
    });
    renderApp("/settings?tab=info");
    expect(screen.getByText("InfoTab")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apri Plugins" }));
    expect(await screen.findByTestId("plugins-content")).toHaveTextContent(
      "updates",
    );
  });

  it("waits for the registry and can notify after recovery from a failed startup check", async () => {
    vi.mocked(usePluginRegistry).mockReturnValue({
      ...usePluginRegistry(),
      loading: true,
    });
    const app = renderApp();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.mocked(usePluginRegistry).mockReturnValue({
      ...usePluginRegistry(),
      loading: false,
      error: "Offline",
    });
    app.rerender(
      <ToastProvider>
        <MemoryRouter>
          <PluginUpdateToast />
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.mocked(usePluginRegistry).mockReturnValue({
      ...usePluginRegistry(),
      error: null,
      updates: [plugin],
    });
    await act(async () =>
      app.rerender(
        <ToastProvider>
          <MemoryRouter>
            <PluginUpdateToast />
          </MemoryRouter>
        </ToastProvider>,
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "1 aggiornamento plugin disponibile",
      ),
    );
  });
});
