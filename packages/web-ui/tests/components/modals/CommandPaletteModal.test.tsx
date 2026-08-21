import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommandPaletteDispatchContext,
  CommandPaletteStateContext,
} from "../../../src/contexts/CommandPaletteContext";
import type {
  CommandPaletteDispatchContextType,
  CommandPaletteStateContextType,
} from "../../../src/contexts/CommandPaletteContext";
import { CommandPaletteModal } from "../../../src/components/modals/CommandPaletteModal";

const navigateMock = vi.fn();
const openEditorMock = vi.fn();
const invokeMock = vi.fn();
const showAlertMock = vi.fn();
const setActiveTableMock = vi.fn();
const databaseState = { activeConnectionId: "connection-1" };
const connectionData = {
  driver: "postgres",
  capabilities: {},
  tables: [{ name: "users" }],
  views: [] as Array<{ name: string }>,
  routines: [] as Array<{ name: string; routine_type: string }>,
  triggers: [] as Array<{
    name: string;
    table_name: string;
    event: string;
    timing: string;
  }>,
  schemas: [] as string[],
  schemaDataMap: {},
  databaseDataMap: {},
  activeSchema: "public",
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: showAlertMock }),
}));

vi.mock("../../../src/hooks/useCommandPaletteScope", () => ({
  useActiveCommandPaletteScope: () => ({
    connectionId: "connection-1",
    driver: "postgres",
    table: {
      connectionId: "connection-1",
      tableName: "users",
      schema: "public",
    },
    runtime: {
      navigate: navigateMock,
      openEditor: openEditorMock,
    },
  }),
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    activeConnectionId: databaseState.activeConnectionId,
    connectionDataMap: {
      "connection-1": connectionData,
    },
    connections: [
      {
        id: "connection-1",
        params: { database: "app", driver: "postgres" },
      },
    ],
    loadDatabaseData: vi.fn(),
    loadSchemaData: vi.fn(),
    setActiveTable: setActiveTableMock,
  }),
}));

vi.mock("../../../src/components/modals/GenerateSQLModal", () => ({
  GenerateSQLModal: ({
    target,
    openEditor,
  }: {
    target: {
      connectionId: string;
      tableName: string;
      schema?: string;
    };
    openEditor?: (request: unknown) => void;
  }) => (
    <div>
      Generate SQL for {target.connectionId}/{target.schema}/
      {target.tableName}
      <button
        type="button"
        onClick={() =>
          openEditor?.({
            kind: "console",
            initialQuery: "SELECT 1",
            targetConnectionId: target.connectionId,
          })
        }
      >
        run in console
      </button>
    </div>
  ),
}));

vi.mock("../../../src/components/modals/SchemaModal", () => ({
  SchemaModal: ({
    target,
  }: {
    target: {
      connectionId: string;
      tableName: string;
      schema?: string;
    };
  }) => (
    <div>
      Inspect {target.connectionId}/{target.schema}/{target.tableName}
    </div>
  ),
}));

function renderPalette(
  overrides: {
    dispatch?: Partial<CommandPaletteDispatchContextType>;
    state?: Partial<CommandPaletteStateContextType>;
  } = {},
) {
  const closePalette = vi.fn();
  const stateValue: CommandPaletteStateContextType = {
    activePalette: "actions",
    ...overrides.state,
  };
  const dispatchValue: CommandPaletteDispatchContextType = {
    openPalette: vi.fn(),
    closePalette,
    ...overrides.dispatch,
  };

  render(
    <MemoryRouter>
      <CommandPaletteDispatchContext.Provider value={dispatchValue}>
        <CommandPaletteStateContext.Provider value={stateValue}>
          <CommandPaletteModal />
        </CommandPaletteStateContext.Provider>
      </CommandPaletteDispatchContext.Provider>
    </MemoryRouter>,
  );

  return { closePalette };
}

describe("CommandPaletteModal", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    openEditorMock.mockReset();
    invokeMock.mockReset();
    showAlertMock.mockReset();
    setActiveTableMock.mockReset();
    databaseState.activeConnectionId = "connection-1";
    connectionData.capabilities = {};
    connectionData.tables = [{ name: "users" }];
    connectionData.views = [];
    connectionData.routines = [];
    connectionData.triggers = [];
    connectionData.schemas = [];
    connectionData.schemaDataMap = {};
  });

  it("should use the shared palette to filter action items", () => {
    renderPalette();

    const input = screen.getByRole("combobox", {
      name: "commandPalette.searchLabel",
    });
    expect(input).toHaveFocus();
    expect(
      screen.getByText("commandPalette.commands.openSettings"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("commandPalette.commands.openTableInConsole"),
    ).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "settings" } });

    expect(
      screen.getByText("commandPalette.commands.openSettings"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "commandPalette.commands.openTableInConsole",
      ),
    ).not.toBeInTheDocument();
  });

  it("should execute action items through the shared pipeline", async () => {
    renderPalette();
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "openSettings" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/settings"),
    );
  });

  it("should close with Escape", () => {
    const { closePalette } = renderPalette();

    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "Escape",
    });

    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("should keep Escape working after focus leaves the input", () => {
    const { closePalette } = renderPalette();
    const closeButton = screen.getByRole("button", {
      name: "common.close",
    });
    closeButton.focus();

    fireEvent.keyDown(closeButton, { key: "Escape" });

    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("should keep arrow navigation working after focus leaves the input", () => {
    renderPalette();
    const closeButton = screen.getByRole("button", {
      name: "common.close",
    });
    closeButton.focus();

    fireEvent.keyDown(closeButton, { key: "ArrowDown" });

    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("should not hand the selection to whatever the cursor rests on", () => {
    renderPalette();
    const options = screen.getAllByRole("option");

    // Opening the palette under a resting cursor fires enter on its own.
    fireEvent.mouseEnter(options[1]);

    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.mouseMove(options[1]);

    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("should keep keyboard focus inside the dialog", () => {
    renderPalette();
    const input = screen.getByRole("combobox");
    const closeButton = screen.getByRole("button", {
      name: "common.close",
    });
    closeButton.focus();

    fireEvent.keyDown(closeButton, { key: "Tab" });

    expect(input).toHaveFocus();
  });

  it("should keep grouped quick actions out of the listbox accessibility tree", () => {
    connectionData.capabilities = { schemas: true };
    connectionData.tables = [];
    connectionData.schemas = ["public"];
    connectionData.schemaDataMap = {
      public: {
        tables: [{ name: "users" }],
        views: [],
        routines: [],
        triggers: [],
        isLoading: false,
        isLoaded: true,
      },
    };
    renderPalette({ state: { activePalette: "objects" } });

    expect(screen.getByText("public")).toHaveAttribute(
      "role",
      "presentation",
    );
    // Rows carry no buttons of their own; the actions live in one group below
    // the list, reachable by Tab.
    expect(
      screen.getByRole("option", { name: /users/i }).querySelector("button"),
    ).toBeNull();
    expect(
      within(screen.getByRole("listbox")).queryAllByRole("button"),
    ).toHaveLength(0);

    const actionGroup = screen.getByRole("group", { name: "users" });
    expect(actionGroup).not.toBe(screen.getByRole("listbox"));
    expect(
      within(actionGroup).getByRole("button", {
        name: "editor.quickNavigator.actions.generateSql",
      }),
    ).not.toHaveAttribute("tabindex", "-1");
  });

  it("should render the empty status outside the listbox", () => {
    connectionData.tables = [];
    renderPalette({ state: { activePalette: "objects" } });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("editor.quickNavigator.noResults");
    expect(status.closest('[role="listbox"]')).toBeNull();
  });

  it("should keep the palette open and show execution errors", async () => {
    navigateMock.mockRejectedValueOnce(
      new Error("Connection failed"),
    );
    renderPalette();
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "openSettings" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      await screen.findByText(
        "commandPalette.executionError: Connection failed",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("should clear its busy state after successful execution", async () => {
    const { closePalette } = renderPalette();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    await waitFor(() => expect(closePalette).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  it("should open the inspect modal for the table in scope", async () => {
    renderPalette();
    const input = screen.getByRole("combobox");

    fireEvent.change(input, {
      target: { value: "quickNavigator.actions.inspect" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      await screen.findByText("Inspect connection-1/public/users"),
    ).toBeInTheDocument();
  });

  it("should run generated SQL through the active scope runtime", async () => {
    renderPalette();
    const input = screen.getByRole("combobox");

    fireEvent.change(input, {
      target: { value: "quickNavigator.actions.generateSql" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(
      await screen.findByRole("button", { name: "run in console" }),
    );

    expect(openEditorMock).toHaveBeenCalledWith({
      kind: "console",
      initialQuery: "SELECT 1",
      targetConnectionId: "connection-1",
    });
  });

  it("should render database objects through the same palette", () => {
    renderPalette({ state: { activePalette: "objects" } });

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(
      screen.queryByText("commandPalette.commands.openSettings"),
    ).not.toBeInTheDocument();
  });

  it("should execute object navigation through the active scope runtime", async () => {
    const { closePalette } = renderPalette({
      state: { activePalette: "objects" },
    });

    fireEvent.click(
      screen.getByRole("option", { name: /users/i }),
    );

    await waitFor(() =>
      expect(openEditorMock).toHaveBeenCalledWith({
        kind: "table",
        initialQuery: 'SELECT * FROM "public"."users"',
        tableName: "users",
        schema: "public",
        targetConnectionId: "connection-1",
      }),
    );
    expect(navigateMock).not.toHaveBeenCalled();
    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("should select the opened table in the explorer", async () => {
    renderPalette({ state: { activePalette: "objects" } });

    fireEvent.click(screen.getByRole("option", { name: /users/i }));

    await waitFor(() =>
      expect(setActiveTableMock).toHaveBeenCalledWith(
        "users",
        "public",
      ),
    );
  });

  it("should not touch the explorer selection when the palette targets another connection", async () => {
    databaseState.activeConnectionId = "connection-2";
    renderPalette({ state: { activePalette: "objects" } });

    fireEvent.click(screen.getByRole("option", { name: /users/i }));

    await waitFor(() => expect(openEditorMock).toHaveBeenCalled());
    expect(setActiveTableMock).not.toHaveBeenCalled();
  });

  it("should execute object quick actions through the shared pipeline", async () => {
    const { closePalette } = renderPalette({
      state: { activePalette: "objects" },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "editor.quickNavigator.actions.generateSql",
      }),
    );

    expect(
      await screen.findByText(
        "Generate SQL for connection-1/public/users",
      ),
    ).toBeInTheDocument();
    expect(closePalette).toHaveBeenCalledTimes(1);
  });

  it("should preserve the full table target for inspect actions", async () => {
    renderPalette({ state: { activePalette: "objects" } });

    fireEvent.click(
      screen.getByRole("button", {
        name: "editor.quickNavigator.actions.inspect",
      }),
    );

    expect(
      await screen.findByText(
        "Inspect connection-1/public/users",
      ),
    ).toBeInTheDocument();
  });

  it("should preserve the routine-specific error with its original reason", async () => {
    connectionData.tables = [];
    connectionData.routines = [
      { name: "refresh_users", routine_type: "FUNCTION" },
    ];
    invokeMock.mockRejectedValueOnce(new Error("permission denied"));
    const { closePalette } = renderPalette({
      state: { activePalette: "objects" },
    });

    fireEvent.click(
      screen.getByRole("option", { name: /refresh_users/i }),
    );

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith(
        "sidebar.failGetRoutineDefinitionError: permission denied",
        { kind: "error" },
      ),
    );
    expect(closePalette).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("commandPalette.executionError"),
    ).not.toBeInTheDocument();
  });

  it("should preserve the trigger-specific error with its original reason", async () => {
    connectionData.tables = [];
    connectionData.triggers = [
      {
        name: "audit_users",
        table_name: "users",
        event: "UPDATE",
        timing: "AFTER",
      },
    ];
    invokeMock.mockRejectedValueOnce(new Error("unsupported trigger"));
    const { closePalette } = renderPalette({
      state: { activePalette: "objects" },
    });

    fireEvent.click(
      screen.getByRole("option", { name: /audit_users/i }),
    );

    await waitFor(() =>
      expect(showAlertMock).toHaveBeenCalledWith(
        "sidebar.failGetTriggerDefinitionError: unsupported trigger",
        { kind: "error" },
      ),
    );
    expect(closePalette).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("commandPalette.executionError"),
    ).not.toBeInTheDocument();
  });
});
