import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionCard } from "../../../src/components/connections/ConnectionCard";
import { ConnectionListItem, type ConnectionListItemProps } from "../../../src/components/connections/ConnectionListItem";
import { usePluginRegistry } from "../../../src/hooks/usePluginRegistry";
import type { PluginManifest, RegistryPluginWithStatus } from "../../../src/types/plugins";

vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
vi.mock("../../../src/hooks/usePluginRegistry", () => ({ usePluginRegistry: vi.fn() }));
vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ activeConnectionId: "one", isConnectionOpenAnywhere: (id: string) => id === "one" }),
}));
vi.mock("../../../src/components/connections/ActionButtons", () => ({ ActionButtons: () => null }));

const plugin: RegistryPluginWithStatus = {
  id: "postgresql", name: "PostgreSQL", description: "", author: "", homepage: "",
  installed_version: "1.0.0", latest_version: "2.0.0", update_available: true,
  platform_supported: true, releases: [],
};
const driver: PluginManifest = {
  id: "postgresql", name: "PostgreSQL", version: "1.0.0", description: "", default_port: 5432,
  deprecated: { replacement_id: "postgres-plugin" },
  capabilities: { schemas: true, views: true, routines: true, file_based: false, folder_based: false, identifier_quote: '"', alter_primary_key: true },
};
const props: ConnectionListItemProps = {
  conn: {
    id: "one", name: "Production", environment: "production", tag_ids: ["t1"],
    params: { driver: "postgresql", database: "db", ssh_enabled: true, k8s_enabled: true },
  },
  tags: [{ id: "t1", name: "billing", color: "#ff00ff" }],
  connectingId: null, allDrivers: [driver], enabledDrivers: [],
  onConnect: vi.fn(), onDisconnect: vi.fn(), onEdit: vi.fn(), onDuplicate: vi.fn(),
  onDelete: vi.fn(), onContextMenu: vi.fn(), onMouseDown: vi.fn(),
};

/** Every chip goes through the shared primitive: a bordered, semibold span. */
const chipTexts = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("span.border.font-semibold")).map((element) => element.textContent);

describe("ConnectionListItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePluginRegistry).mockReturnValue({
      plugins: [plugin], updates: [plugin], loading: false, error: null, refresh: vi.fn(),
    });
  });

  it("shows the same chips, in the same order, as the grid card", () => {
    render(
      <MemoryRouter>
        <div data-testid="grid"><ConnectionCard {...props} /></div>
        <div data-testid="list"><ConnectionListItem {...props} /></div>
      </MemoryRouter>,
    );
    const grid = chipTexts(screen.getByTestId("grid"));
    const list = chipTexts(screen.getByTestId("list"));
    expect(list).toEqual(grid);
    expect(list).toEqual([
      "connections.active", "postgresql", "connections.deprecated", "v2.0.0",
      "environment.short.production", "billing", "SSH", "K8s", "connections.pluginDisabled",
    ]);
    const links = screen.getAllByRole("link", { name: "update.badges.driverUpdate" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/settings?tab=plugins&filter=updates");
  });

  it("uses the shared state classes for the active row", () => {
    render(<MemoryRouter><ConnectionListItem {...props} selected onToggleSelect={vi.fn()} /></MemoryRouter>);
    const row = screen.getByText("Production").closest(".group");
    expect(row).toHaveClass("border-accent-primary/40", "ring-accent-primary/70");
    expect(screen.getByRole("button", { pressed: true })).toHaveClass("bg-accent-primary");
  });
});
