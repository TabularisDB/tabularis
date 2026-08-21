import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { CommandPaletteScopeBridge } from "../../src/components/layout/CommandPaletteScopeBridge";
import { CommandPaletteProvider } from "../../src/contexts/CommandPaletteProvider";
import { DatabaseContext } from "../../src/contexts/DatabaseContext";
import type { DatabaseContextType } from "../../src/contexts/DatabaseContext";
import { EditorProvider } from "../../src/contexts/EditorProvider";
import {
  useCommandPaletteDispatch,
  useCommandPaletteState,
} from "../../src/hooks/useCommandPalette";
import { useActiveCommandPaletteScope } from "../../src/hooks/useCommandPaletteScope";
import { useCommandPaletteActionItems } from "../../src/hooks/useCommandPaletteActionItems";
import { useEditor } from "../../src/hooks/useEditor";
import type { CommandRuntime } from "../../src/types/commands";
import type { Tab } from "../../src/types/editor";
import { ROOT_COMMAND_SCOPE_ID } from "../../src/utils/commandScopeStore";
import { createEditorNavigationIntent } from "../../src/utils/editorNavigation";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: { connectionId?: string }) =>
    invokeMock(command, args),
}));

const layoutState = {
  splitView: {
    connectionIds: ["connection-a", "connection-b"],
    mode: "vertical" as const,
  },
  isSplitVisible: true,
  explorerConnectionId: "connection-b",
};

vi.mock("../../src/hooks/useConnectionLayoutContext", () => ({
  useConnectionLayoutContext: () => layoutState,
}));

function createTableTab(
  connectionId: string,
  tableName: string,
  schema: string,
): Tab {
  return {
    id: `${connectionId}-table`,
    title: tableName,
    type: "table",
    query: "",
    result: null,
    error: "",
    executionTime: null,
    page: 1,
    activeTable: tableName,
    pkColumns: null,
    connectionId,
    schema,
  };
}

function createDatabaseValue(
  connectionId: string,
  driver: string,
  schema: string,
): DatabaseContextType {
  return {
    activeConnectionId: connectionId,
    activeDriver: driver,
    activeSchema: schema,
  } as DatabaseContextType;
}

function Panel({
  connectionId,
  driver,
  openEditor,
  schema,
  scopeId = connectionId,
}: {
  connectionId: string;
  driver: string;
  openEditor?: CommandRuntime["openEditor"];
  schema: string;
  scopeId?: string;
}) {
  return (
    <DatabaseContext.Provider
      value={createDatabaseValue(connectionId, driver, schema)}
    >
      <EditorProvider>
        <PanelScopeBridge scopeId={scopeId} openEditor={openEditor} />
        <PanelTabs connectionId={connectionId} />
      </EditorProvider>
    </DatabaseContext.Provider>
  );
}

/** Mirrors how Editor claims its scope: opening happens in this panel's tabs. */
function PanelScopeBridge({
  scopeId,
  openEditor,
}: {
  scopeId: string;
  openEditor?: CommandRuntime["openEditor"];
}) {
  const { addTab } = useEditor();

  return (
    <CommandPaletteScopeBridge
      scopeId={scopeId}
      openEditor={
        openEditor ??
        ((request) => {
          addTab(
            createEditorNavigationIntent(request, "New console")
              .addTabInput,
          );
        })
      }
    />
  );
}

function PanelTabs({ connectionId }: { connectionId: string }) {
  const { tabs } = useEditor();
  return (
    <output data-testid={`${connectionId}-tabs`}>
      {JSON.stringify(
        tabs.map((tab) => ({
          query: tab.query,
          title: tab.title,
          type: tab.type,
        })),
      )}
    </output>
  );
}

function PaletteHarness() {
  const { openPalette } = useCommandPaletteDispatch();
  const { activePalette } = useCommandPaletteState();
  return (
    <>
      <button type="button" onClick={() => openPalette("actions")}>
        Open actions
      </button>
      {activePalette === "actions" && (
        <ActiveTableCommand />
      )}
    </>
  );
}

function ActiveTableCommand() {
  const items = useCommandPaletteActionItems();
  const command = items.find(
    (item) => item.id === "table.open-in-console",
  );

  if (!command) return <div>No table command</div>;

  return (
    <>
      <output data-testid="active-table">{command.description}</output>
      <button
        type="button"
        onClick={() => void command.primaryAction.execute()}
      >
        Execute table command
      </button>
    </>
  );
}

function ObjectPaletteHarness() {
  const { openPalette } = useCommandPaletteDispatch();
  const { activePalette } = useCommandPaletteState();

  return (
    <>
      <button type="button" onClick={() => openPalette("objects")}>
        Open objects
      </button>
      <output data-testid="active-palette">{activePalette}</output>
    </>
  );
}

function ActiveScopeEditorHarness() {
  const scope = useActiveCommandPaletteScope();

  return (
    <button
      type="button"
      onClick={() =>
        scope?.runtime.openEditor({
          kind: "console",
          initialQuery: "SELECT 1",
          targetConnectionId: scope.connectionId ?? "",
        })
      }
    >
      Open in active editor
    </button>
  );
}

describe("CommandPaletteProvider split-view scope", () => {
  it("should resolve and execute commands through the active panel EditorProvider", async () => {
    invokeMock.mockImplementation(
      (command: string, args?: { connectionId?: string }) => {
        if (command === "load_editor_preferences") {
          const connectionId = args?.connectionId;
          const isConnectionA = connectionId === "connection-a";
          const tab = createTableTab(
            connectionId ?? "",
            isConnectionA ? "table_a" : "table_b",
            isConnectionA ? "schema_a" : "schema_b",
          );
          return Promise.resolve({
            tabs: [tab],
            active_tab_id: tab.id,
          });
        }
        return Promise.resolve(null);
      },
    );

    render(
      <MemoryRouter initialEntries={["/editor"]}>
        <CommandPaletteProvider>
          <Panel
            connectionId="connection-a"
            driver="mysql"
            schema="schema_a"
          />
          <Panel
            connectionId="connection-b"
            driver="postgres"
            schema="schema_b"
          />
          <PaletteHarness />
        </CommandPaletteProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("connection-b-tabs")).toHaveTextContent(
        "table_b",
      ),
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Open actions" }));
    });

    expect(await screen.findByTestId("active-table")).toHaveTextContent(
      "table_b",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Execute table command" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("connection-b-tabs")).toHaveTextContent(
        'SELECT * FROM \\"schema_b\\".\\"table_b\\"',
      ),
    );
    expect(screen.getByTestId("connection-a-tabs")).not.toHaveTextContent(
      "SELECT * FROM",
    );
  });

  it("should use the root scope when the current route hides split panes", async () => {
    invokeMock.mockImplementation(
      (command: string, args?: { connectionId?: string }) => {
        if (command !== "load_editor_preferences") {
          return Promise.resolve(null);
        }
        const connectionId = args?.connectionId ?? "";
        const tab = createTableTab(
          connectionId,
          connectionId === "connection-root"
            ? "root_table"
            : "panel_table",
          "public",
        );
        return Promise.resolve({
          tabs: [tab],
          active_tab_id: tab.id,
        });
      },
    );

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <CommandPaletteProvider>
          <Panel
            connectionId="connection-root"
            driver="postgres"
            schema="public"
            scopeId={ROOT_COMMAND_SCOPE_ID}
          />
          <ObjectPaletteHarness />
        </CommandPaletteProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("connection-root-tabs")).toHaveTextContent(
        "root_table",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open objects" }));

    expect(screen.getByTestId("active-palette")).toHaveTextContent(
      "objects",
    );
  });

  it("should not fall back to the root scope when the active split scope is missing", async () => {
    invokeMock.mockImplementation(
      (command: string, args?: { connectionId?: string }) => {
        if (command !== "load_editor_preferences") {
          return Promise.resolve(null);
        }
        const connectionId = args?.connectionId ?? "";
        const tab = createTableTab(
          connectionId,
          "root_table",
          "public",
        );
        return Promise.resolve({
          tabs: [tab],
          active_tab_id: tab.id,
        });
      },
    );

    render(
      <MemoryRouter initialEntries={["/editor"]}>
        <CommandPaletteProvider>
          <Panel
            connectionId="connection-root"
            driver="postgres"
            schema="public"
            scopeId={ROOT_COMMAND_SCOPE_ID}
          />
          <ObjectPaletteHarness />
        </CommandPaletteProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("connection-root-tabs")).toHaveTextContent(
        "root_table",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open objects" }));

    expect(screen.getByTestId("active-palette")).toBeEmptyDOMElement();
  });

  it("should execute editor navigation through the active split panel runtime", () => {
    const openInPanelA = vi.fn();
    const openInPanelB = vi.fn();

    render(
      <MemoryRouter initialEntries={["/editor"]}>
        <CommandPaletteProvider>
          <Panel
            connectionId="connection-a"
            driver="mysql"
            openEditor={openInPanelA}
            schema="schema_a"
          />
          <Panel
            connectionId="connection-b"
            driver="postgres"
            openEditor={openInPanelB}
            schema="schema_b"
          />
          <ActiveScopeEditorHarness />
        </CommandPaletteProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open in active editor" }),
    );

    expect(openInPanelB).toHaveBeenCalledWith({
      kind: "console",
      initialQuery: "SELECT 1",
      targetConnectionId: "connection-b",
    });
    expect(openInPanelA).not.toHaveBeenCalled();
  });
});
