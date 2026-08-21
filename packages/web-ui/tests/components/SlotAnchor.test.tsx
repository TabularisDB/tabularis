import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PluginSlotProvider } from "../../src/contexts/PluginSlotProvider";
import { PluginSlotContext } from "../../src/contexts/PluginSlotContext";
import { SettingsContext, DEFAULT_SETTINGS } from "../../src/contexts/SettingsContext";
import { SlotAnchor } from "../../src/components/ui/SlotAnchor";
import type { SlotComponentProps } from "../../src/types/pluginSlots";

const settingsValue = {
  settings: DEFAULT_SETTINGS,
  updateSetting: () => {},
  isLoading: false,
};

const GoodPlugin = ({ pluginId }: SlotComponentProps) => (
  <span data-testid="good-plugin">{pluginId}</span>
);

const CrashingPlugin = () => {
  throw new Error("Plugin crash!");
};

describe("SlotAnchor", () => {
  it("should render nothing when no contributions exist", () => {
    const { container } = render(
      <SettingsContext.Provider value={settingsValue}>
        <PluginSlotProvider>
          <SlotAnchor name="sidebar.footer.actions" context={{}} />
        </PluginSlotProvider>
      </SettingsContext.Provider>,
    );

    expect(container.innerHTML).toBe("");
  });

  it("should render nothing when outside provider", () => {
    const { container } = render(
      <SlotAnchor name="sidebar.footer.actions" context={{}} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("should render contributions for the matching slot", () => {
    const mockRegistry = {
      contributions: [],
      register: () => () => {},
      registerAll: () => () => {},
      getSlotContributions: (slot: string) => {
        if (slot === "sidebar.footer.actions") {
          return [
            { pluginId: "test-plugin", slot: "sidebar.footer.actions" as const, component: GoodPlugin },
          ];
        }
        return [];
      },
    };

    render(
      <PluginSlotContext.Provider value={mockRegistry}>
        <SlotAnchor name="sidebar.footer.actions" context={{}} />
      </PluginSlotContext.Provider>,
    );

    expect(screen.getByTestId("good-plugin")).toHaveTextContent("test-plugin");
  });

  it("should isolate plugin crashes with ErrorBoundary", () => {
    const mockRegistry = {
      contributions: [],
      register: () => () => {},
      registerAll: () => () => {},
      getSlotContributions: () => [
        { pluginId: "crashing-plugin", slot: "sidebar.footer.actions" as const, component: CrashingPlugin },
        { pluginId: "good-plugin", slot: "sidebar.footer.actions" as const, component: GoodPlugin },
      ],
    };

    render(
      <PluginSlotContext.Provider value={mockRegistry}>
        <SlotAnchor name="sidebar.footer.actions" context={{}} />
      </PluginSlotContext.Provider>,
    );

    // The crashing plugin should show an error message
    expect(screen.getByText("Plugin error: crashing-plugin")).toBeInTheDocument();
    // The good plugin should still render
    expect(screen.getByTestId("good-plugin")).toBeInTheDocument();
  });

  it("should set data-slot attribute on wrapper", () => {
    const mockRegistry = {
      contributions: [],
      register: () => () => {},
      registerAll: () => () => {},
      getSlotContributions: () => [
        { pluginId: "p1", slot: "data-grid.toolbar.actions" as const, component: GoodPlugin },
      ],
    };

    render(
      <PluginSlotContext.Provider value={mockRegistry}>
        <SlotAnchor name="data-grid.toolbar.actions" context={{}} className="test-class" />
      </PluginSlotContext.Provider>,
    );

    const wrapper = screen.getByTestId("good-plugin").parentElement;
    expect(wrapper?.getAttribute("data-slot")).toBe("data-grid.toolbar.actions");
    expect(wrapper?.className).toContain("test-class");
  });
});
