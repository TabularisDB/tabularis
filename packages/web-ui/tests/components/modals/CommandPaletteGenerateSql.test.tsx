import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPaletteModal } from "../../../src/components/modals/CommandPaletteModal";
import {
  CommandPaletteDispatchContext,
  CommandPaletteStateContext,
} from "../../../src/contexts/CommandPaletteContext";
import type { CommandPaletteMode } from "../../../src/types/commands";

/**
 * The panel-scoped path end to end: a split panel owns its editor, so the
 * palette must reach it through the scope runtime. Everything between the
 * scope and the modal is real here — the sibling suites mock one half each.
 */

const openEditorMock = vi.fn();
const navigateMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The global mock in tests/setup.ts predates this tree and lacks its icons.
vi.mock("lucide-react", () => {
  const Icon = () => null;

  return {
    Check: Icon,
    Code2: Icon,
    Command: Icon,
    Copy: Icon,
    Eye: Icon,
    FileCode: Icon,
    FileText: Icon,
    Hash: Icon,
    Key: Icon,
    List: Icon,
    Loader2: Icon,
    PenLine: Icon,
    Play: Icon,
    Search: Icon,
    Table2: Icon,
    Trash2: Icon,
    X: Icon,
    Zap: Icon,
  };
});

vi.mock("../../../src/components/ui/SqlPreview", () => ({
  SqlPreview: ({ sql }: { sql: string }) => <pre>{sql}</pre>,
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: vi.fn() }),
}));

vi.mock("../../../src/hooks/useCommandPaletteScope", () => ({
  useActiveCommandPaletteScope: () => ({
    connectionId: "connection-panel",
    driver: "sqlite",
    table: {
      connectionId: "connection-panel",
      tableName: "invoices",
      schema: "billing",
    },
    runtime: { navigate: navigateMock, openEditor: openEditorMock },
  }),
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    activeConnectionId: "connection-root",
    connectionDataMap: {
      "connection-panel": { driver: "sqlite", capabilities: "sqlite" },
    },
    connections: [],
    loadDatabaseData: vi.fn(),
    loadSchemaData: vi.fn(),
    setActiveTable: vi.fn(),
  }),
}));

const LocationState = () => {
  const location = useLocation();

  return <pre data-testid="route-state">{JSON.stringify(location.state)}</pre>;
};

const Harness = () => {
  const [activePalette, setActivePalette] =
    useState<CommandPaletteMode | null>("actions");

  return (
    <MemoryRouter>
      <CommandPaletteStateContext.Provider value={{ activePalette }}>
        <CommandPaletteDispatchContext.Provider
          value={{
            openPalette: setActivePalette,
            closePalette: () => setActivePalette(null),
            togglePalette: setActivePalette,
          }}
        >
          <CommandPaletteModal />
        </CommandPaletteDispatchContext.Provider>
      </CommandPaletteStateContext.Provider>
      <LocationState />
    </MemoryRouter>
  );
};

describe("command palette generate SQL", () => {
  beforeEach(() => {
    openEditorMock.mockReset();
    navigateMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
  });

  it("should run generated SQL in the panel that owns the table", async () => {
    render(<Harness />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, {
      target: { value: "quickNavigator.actions.generateSql" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("get_columns", {
        connectionId: "connection-panel",
        tableName: "invoices",
        schema: "billing",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("generateSQL.loading"),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "generateSQL.runInConsole" }),
    );

    expect(openEditorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "console",
        preventAutoRun: true,
        schema: "billing",
        targetConnectionId: "connection-panel",
      }),
    );
    // The routed editor is unmounted behind a split, so reaching it through
    // the router would drop the query on the floor.
    expect(screen.getByTestId("route-state").textContent).toBe("null");
  });
});
