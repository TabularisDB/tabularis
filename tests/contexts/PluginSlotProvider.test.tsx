import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import { useContext } from "react";
import { PluginSlotProvider } from "../../src/contexts/PluginSlotProvider";
import { PluginSlotContext } from "../../src/contexts/PluginSlotContext";
import { SettingsContext, DEFAULT_SETTINGS } from "../../src/contexts/SettingsContext";
import type { PluginSlotRegistryType } from "../../src/contexts/PluginSlotContext";
import type { SlotContribution, SlotComponentProps } from "../../src/types/pluginSlots";

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

const renderWithSettings = (ui: React.ReactNode) =>
  render(
    <SettingsContext.Provider value={settingsValue}>
      {ui}
    </SettingsContext.Provider>,
  );

describe("PluginSlotProvider", () => {
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
