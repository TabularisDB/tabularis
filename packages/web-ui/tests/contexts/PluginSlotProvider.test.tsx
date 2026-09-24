import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { PluginSlotProvider } from "../../src/contexts/PluginSlotProvider";
import { PluginSlotContext } from "../../src/contexts/PluginSlotContext";
import { SettingsContext, DEFAULT_SETTINGS } from "../../src/contexts/SettingsContext";
import type { PluginSlotRegistryType } from "../../src/contexts/PluginSlotContext";
import type { SlotContribution, SlotComponentProps } from "../../src/types/pluginSlots";

const clientMock = vi.hoisted(() => ({
  call: vi.fn(),
  readPluginAsset: vi.fn(),
}));

vi.mock("../../src/hooks/useTabularisClient", () => ({
  useTabularisClient: () => clientMock,
}));

vi.mock("i18next", () => ({
  default: {
    language: "en",
    hasResourceBundle: vi.fn().mockReturnValue(false),
    addResourceBundle: vi.fn(),
  },
}));

const TestComponent = ({ context: _ctx, pluginId }: SlotComponentProps) => (
  <span data-testid="slot-component">{pluginId}</span>
);

function RegistryConsumer({ onRegistry }: { onRegistry: (r: PluginSlotRegistryType) => void }) {
  const registry = useContext(PluginSlotContext);
  if (registry) onRegistry(registry);
  return null;
}

const settingsValue = {
  settings: DEFAULT_SETTINGS,
  updateSetting: () => {},
  isLoading: false,
};

const renderWithSettings = (
  ui: React.ReactNode,
  value = settingsValue,
) =>
  render(
    <SettingsContext.Provider value={value}>
      {ui}
    </SettingsContext.Provider>,
  );

describe("PluginSlotProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("should provide a registry with no contributions initially", () => {
    let registry: PluginSlotRegistryType | undefined;

    renderWithSettings(
      <PluginSlotProvider>
        <RegistryConsumer onRegistry={(r) => { registry = r; }} />
      </PluginSlotProvider>,
    );

    expect(registry).toBeDefined();
    expect(registry!.contributions).toHaveLength(0);
  });

  it("should load compatible bundles through the active transport", async () => {
    let registry: PluginSlotRegistryType | undefined;
    clientMock.call.mockResolvedValue({
      id: "example-plugin",
      name: "Example Plugin",
      version: "1.0.0",
      description: "Fixture",
      default_port: null,
      capabilities: {},
      ui_extensions: [
        {
          slot: "sidebar.footer.actions",
          module: "ui/index.js",
          api_version: "0.1.1",
        },
      ],
    });
    clientMock.readPluginAsset.mockImplementation(
      (_pluginId: string, assetPath: string) =>
        assetPath.startsWith("locales/")
          ? Promise.reject(new Error("missing locale"))
          : Promise.resolve(
              "var __tabularis_plugin__ = function PluginSlot() { return null; };",
            ),
    );
    const activeSettings = {
      ...settingsValue,
      settings: {
        ...DEFAULT_SETTINGS,
        activeExternalDrivers: ["example-plugin"],
      },
    };

    renderWithSettings(
      <PluginSlotProvider>
        <RegistryConsumer onRegistry={(value) => { registry = value; }} />
      </PluginSlotProvider>,
      activeSettings,
    );

    await waitFor(() => expect(registry?.contributions).toHaveLength(1));
    expect(clientMock.readPluginAsset).toHaveBeenCalledWith(
      "example-plugin",
      "ui/index.js",
    );
  });

  it("should skip bundles that require an incompatible plugin API", async () => {
    let registry: PluginSlotRegistryType | undefined;
    clientMock.call.mockResolvedValue({
      id: "future-plugin",
      name: "Future Plugin",
      version: "1.0.0",
      description: "Fixture",
      default_port: null,
      capabilities: {},
      ui_extensions: [
        {
          slot: "sidebar.footer.actions",
          module: "ui/index.js",
          api_version: "0.2.0",
        },
      ],
    });
    clientMock.readPluginAsset.mockRejectedValue(new Error("missing locale"));
    const activeSettings = {
      ...settingsValue,
      settings: {
        ...DEFAULT_SETTINGS,
        activeExternalDrivers: ["future-plugin"],
      },
    };

    renderWithSettings(
      <PluginSlotProvider>
        <RegistryConsumer onRegistry={(value) => { registry = value; }} />
      </PluginSlotProvider>,
      activeSettings,
    );

    await waitFor(() => expect(clientMock.call).toHaveBeenCalledOnce());
    expect(registry?.contributions).toHaveLength(0);
    expect(clientMock.readPluginAsset).not.toHaveBeenCalledWith(
      "future-plugin",
      "ui/index.js",
    );
  });

  it("should register and unregister a contribution", () => {
    let registry: PluginSlotRegistryType | undefined;

    const { rerender } = renderWithSettings(
      <PluginSlotProvider>
        <RegistryConsumer onRegistry={(r) => { registry = r; }} />
      </PluginSlotProvider>,
    );

    const contribution: SlotContribution = {
      pluginId: "test-plugin",
      slot: "sidebar.footer.actions",
      component: TestComponent,
      order: 50,
    };

    let unregister: (() => void) | undefined;
    act(() => {
      unregister = registry!.register(contribution);
    });

    rerender(
      <SettingsContext.Provider value={settingsValue}>
        <PluginSlotProvider>
          <RegistryConsumer onRegistry={(r) => { registry = r; }} />
        </PluginSlotProvider>
      </SettingsContext.Provider>,
    );

    expect(registry!.contributions).toHaveLength(1);

    act(() => {
      unregister!();
    });

    rerender(
      <SettingsContext.Provider value={settingsValue}>
        <PluginSlotProvider>
          <RegistryConsumer onRegistry={(r) => { registry = r; }} />
        </PluginSlotProvider>
      </SettingsContext.Provider>,
    );

    expect(registry!.contributions).toHaveLength(0);
  });

  it("should getSlotContributions filtered by slot name and sorted by order", () => {
    let registry: PluginSlotRegistryType | undefined;

    const { rerender } = renderWithSettings(
      <PluginSlotProvider>
        <RegistryConsumer onRegistry={(r) => { registry = r; }} />
      </PluginSlotProvider>,
    );

    act(() => {
      registry!.registerAll([
        { pluginId: "b", slot: "sidebar.footer.actions", component: TestComponent, order: 200 },
        { pluginId: "a", slot: "sidebar.footer.actions", component: TestComponent, order: 10 },
        { pluginId: "c", slot: "data-grid.toolbar.actions", component: TestComponent, order: 100 },
      ]);
    });

    rerender(
      <SettingsContext.Provider value={settingsValue}>
        <PluginSlotProvider>
          <RegistryConsumer onRegistry={(r) => { registry = r; }} />
        </PluginSlotProvider>
      </SettingsContext.Provider>,
    );

    const sidebarSlots = registry!.getSlotContributions("sidebar.footer.actions", {});
    expect(sidebarSlots).toHaveLength(2);
    expect(sidebarSlots[0].pluginId).toBe("a"); // order 10 first
    expect(sidebarSlots[1].pluginId).toBe("b"); // order 200 second

    const toolbarSlots = registry!.getSlotContributions("data-grid.toolbar.actions", {});
    expect(toolbarSlots).toHaveLength(1);
    expect(toolbarSlots[0].pluginId).toBe("c");
  });

  it("should filter contributions by when predicate", () => {
    let registry: PluginSlotRegistryType | undefined;

    const { rerender } = renderWithSettings(
      <PluginSlotProvider>
        <RegistryConsumer onRegistry={(r) => { registry = r; }} />
      </PluginSlotProvider>,
    );

    act(() => {
      registry!.registerAll([
        {
          pluginId: "postgres-only",
          slot: "sidebar.footer.actions",
          component: TestComponent,
          when: (ctx) => ctx.driver === "postgres",
        },
        {
          pluginId: "always",
          slot: "sidebar.footer.actions",
          component: TestComponent,
        },
      ]);
    });

    rerender(
      <SettingsContext.Provider value={settingsValue}>
        <PluginSlotProvider>
          <RegistryConsumer onRegistry={(r) => { registry = r; }} />
        </PluginSlotProvider>
      </SettingsContext.Provider>,
    );

    const withPostgres = registry!.getSlotContributions("sidebar.footer.actions", { driver: "postgres" });
    expect(withPostgres).toHaveLength(2);

    const withMysql = registry!.getSlotContributions("sidebar.footer.actions", { driver: "mysql" });
    expect(withMysql).toHaveLength(1);
    expect(withMysql[0].pluginId).toBe("always");
  });

  it("should registerAll and unregister all at once", () => {
    let registry: PluginSlotRegistryType | undefined;

    const { rerender } = renderWithSettings(
      <PluginSlotProvider>
        <RegistryConsumer onRegistry={(r) => { registry = r; }} />
      </PluginSlotProvider>,
    );

    let unregisterAll: (() => void) | undefined;
    act(() => {
      unregisterAll = registry!.registerAll([
        { pluginId: "a", slot: "sidebar.footer.actions", component: TestComponent },
        { pluginId: "b", slot: "sidebar.footer.actions", component: TestComponent },
      ]);
    });

    rerender(
      <SettingsContext.Provider value={settingsValue}>
        <PluginSlotProvider>
          <RegistryConsumer onRegistry={(r) => { registry = r; }} />
        </PluginSlotProvider>
      </SettingsContext.Provider>,
    );

    expect(registry!.contributions).toHaveLength(2);

    act(() => {
      unregisterAll!();
    });

    rerender(
      <SettingsContext.Provider value={settingsValue}>
        <PluginSlotProvider>
          <RegistryConsumer onRegistry={(r) => { registry = r; }} />
        </PluginSlotProvider>
      </SettingsContext.Provider>,
    );

    expect(registry!.contributions).toHaveLength(0);
  });
});
