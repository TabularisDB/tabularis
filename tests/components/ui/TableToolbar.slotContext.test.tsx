import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SlotComponentProps } from "../../../src/types/pluginSlots";

const slotRenders: Array<{ context: SlotComponentProps["context"]; pluginId: string }> = [];

const SpyPlugin = ({ context, pluginId }: SlotComponentProps) => {
  slotRenders.push({ context, pluginId });
  return (
    <span data-testid="toolbar-slot">
      {String(context.driver)}|{String(context.tableName)}|{String(context.connectionId)}|{String(context.schema)}
    </span>
  );
};

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: vi.fn(),
}));

import { useDatabase } from "../../../src/hooks/useDatabase";
import { TableToolbar } from "../../../src/components/ui/TableToolbar";
import { PluginSlotContext } from "../../../src/contexts/PluginSlotContext";

describe("TableToolbar slot context (#892)", () => {
  beforeEach(() => {
    slotRenders.length = 0;
    vi.mocked(useDatabase).mockReturnValue({
      activeDriver: "postgres",
      activeCapabilities: null,
      activeConnectionId: "conn-1",
      activeSchema: "public",
    } as ReturnType<typeof useDatabase>);
  });

  it("supplies connectionId/tableName/schema/driver so driver-filtered plugins render", () => {
    const registry = {
      contributions: [],
      register: () => () => {},
      registerAll: () => () => {},
      getSlotContributions: (slot: string, context: SlotComponentProps["context"]) => {
        if (slot !== "data-grid.toolbar.actions") return [];
        // Mimic PluginSlotProvider driver filter
        if (context.driver !== "postgres") return [];
        return [
          {
            pluginId: "pg-toolbar",
            slot: "data-grid.toolbar.actions" as const,
            component: SpyPlugin,
            when: (ctx: SlotComponentProps["context"]) => ctx.driver === "postgres",
          },
        ].filter((c) => !c.when || c.when(context));
      },
    };

    render(
      <PluginSlotContext.Provider value={registry}>
        <TableToolbar
          placeholderColumn="id"
          placeholderSort="created_at"
          defaultLimit={100}
          onUpdate={() => {}}
          tableName="users"
        />
      </PluginSlotContext.Provider>,
    );

    expect(screen.getByTestId("toolbar-slot")).toHaveTextContent(
      "postgres|users|conn-1|public",
    );
    expect(slotRenders[0].context).toMatchObject({
      connectionId: "conn-1",
      tableName: "users",
      schema: "public",
      driver: "postgres",
    });
  });

  it("hides driver-filtered plugins when driver is missing from context (regression guard)", () => {
    // Empty context (pre-fix behaviour) must not satisfy driver === "postgres"
    const registry = {
      contributions: [],
      register: () => () => {},
      registerAll: () => () => {},
      getSlotContributions: (
        slot: string,
        context: SlotComponentProps["context"],
      ) => {
        if (slot !== "data-grid.toolbar.actions") return [];
        return context.driver === "postgres"
          ? [
              {
                pluginId: "pg-toolbar",
                slot: "data-grid.toolbar.actions" as const,
                component: SpyPlugin,
              },
            ]
          : [];
      },
    };

    // Force empty context path by clearing driver/connection from the hook
    // and omitting tableName — after the fix, driver still comes from the hook.
    vi.mocked(useDatabase).mockReturnValue({
      activeDriver: null,
      activeCapabilities: null,
      activeConnectionId: null,
      activeSchema: null,
    } as ReturnType<typeof useDatabase>);

    render(
      <PluginSlotContext.Provider value={registry}>
        <TableToolbar
          placeholderColumn="id"
          placeholderSort="created_at"
          defaultLimit={100}
          onUpdate={() => {}}
        />
      </PluginSlotContext.Provider>,
    );

    expect(screen.queryByTestId("toolbar-slot")).not.toBeInTheDocument();
  });
});
