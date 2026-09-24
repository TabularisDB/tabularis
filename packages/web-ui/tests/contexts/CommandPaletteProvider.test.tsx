import { act, render, waitFor } from "@testing-library/react";
import { memo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPaletteProvider } from "../../src/contexts/CommandPaletteProvider";
import { CommandPaletteScopeBridge } from "../../src/components/layout/CommandPaletteScopeBridge";
import {
  useCommandPaletteDispatch,
  useCommandPaletteState,
} from "../../src/hooks/useCommandPalette";
import { useCommandPaletteActionItems } from "../../src/hooks/useCommandPaletteActionItems";
import type {
  CommandPaletteDispatchContextType,
  CommandPaletteStateContextType,
} from "../../src/contexts/CommandPaletteContext";
import type { PaletteItem } from "../../src/types/palette";
import { ROOT_COMMAND_SCOPE_ID } from "../../src/utils/commandScopeStore";
import { createPaletteSearch } from "../../src/utils/paletteItems";

const navigateMock = vi.fn();
const addTabMock = vi.fn(() => "console-tab");

const databaseState: {
  activeConnectionId: string | null;
  activeDriver: string | null;
  activeDatabaseName: string | null;
  activeSchema: string | null;
} = {
  activeConnectionId: "connection-1",
  activeDriver: "postgres",
  activeDatabaseName: "app",
  activeSchema: "public",
};

const editorState = {
  activeTab: {
    id: "table-tab",
    type: "table" as const,
    connectionId: "connection-1",
    activeTable: "users",
    schema: "public",
  },
  addTab: addTabMock,
};

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useLocation: () => ({ pathname: "/editor" }),
    useNavigate: () => navigateMock,
  };
});

vi.mock("../../src/hooks/useDatabase", () => ({
  useDatabase: () => databaseState,
}));

vi.mock("../../src/hooks/useEditor", () => ({
  useEditor: () => editorState,
}));

vi.mock("../../src/hooks/useConnectionLayoutContext", () => ({
  useConnectionLayoutContext: () => ({
    explorerConnectionId: "connection-1",
    isSplitVisible: false,
    splitView: null,
  }),
}));

interface PaletteContexts {
  items: PaletteItem[];
  dispatch: CommandPaletteDispatchContextType;
  state: CommandPaletteStateContextType;
}

function ContextConsumer({
  onContexts,
}: {
  onContexts: (contexts: PaletteContexts) => void;
}) {
  const items = useCommandPaletteActionItems(vi.fn(), vi.fn());
  const dispatch = useCommandPaletteDispatch();
  const state = useCommandPaletteState();
  onContexts({ items, dispatch, state });
  return null;
}

function PaletteTestHarness({
  onContexts,
}: {
  onContexts: (contexts: PaletteContexts) => void;
}) {
  const { activePalette } = useCommandPaletteState();

  return (
    <>
      <CommandPaletteScopeBridge scopeId={ROOT_COMMAND_SCOPE_ID} />
      {activePalette === "actions" ? (
        <ContextConsumer onContexts={onContexts} />
      ) : (
        <DispatchAndStateConsumer onContexts={onContexts} />
      )}
    </>
  );
}

function DispatchAndStateConsumer({
  onContexts,
}: {
  onContexts: (contexts: PaletteContexts) => void;
}) {
  const dispatch = useCommandPaletteDispatch();
  const state = useCommandPaletteState();
  onContexts({
    items: [],
    dispatch,
    state,
  });
  return null;
}

const DispatchConsumer = memo(function DispatchConsumer({
  onRender,
}: {
  onRender: () => void;
}) {
  useCommandPaletteDispatch();
  onRender();
  return null;
});

describe("CommandPaletteProvider", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    addTabMock.mockClear();
    databaseState.activeConnectionId = "connection-1";
  });

  it("should expose global and contextual built-in commands", () => {
    let palette: PaletteContexts | undefined;

    render(
      <CommandPaletteProvider>
        <PaletteTestHarness
          onContexts={(contexts) => {
            palette = contexts;
          }}
        />
      </CommandPaletteProvider>,
    );

    act(() => palette!.dispatch.openPalette("actions"));

    expect(
      createPaletteSearch(palette!.items)("").map(
        (item) => item.id,
      ),
    ).toEqual([
      "table.open-in-console",
      "table.inspect",
      "table.generate-sql",
      "table.count-rows",
      "app.open-settings",
      "app.open-connections",
      "connection.new-console",
    ]);
  });

  it("should expose one explicit active palette state", () => {
    let palette: PaletteContexts | undefined;

    render(
      <CommandPaletteProvider>
        <PaletteTestHarness
          onContexts={(contexts) => {
            palette = contexts;
          }}
        />
      </CommandPaletteProvider>,
    );

    expect(palette!.state.activePalette).toBeNull();

    act(() => palette!.dispatch.openPalette("objects"));

    expect(palette!.state.activePalette).toBe("objects");
  });

  it("should restore focus when the palette is closed through its dispatch", async () => {
    const trigger = document.createElement("button");
    const paletteInput = document.createElement("input");
    document.body.append(trigger, paletteInput);
    trigger.focus();
    let palette: PaletteContexts | undefined;

    render(
      <CommandPaletteProvider>
        <PaletteTestHarness
          onContexts={(contexts) => {
            palette = contexts;
          }}
        />
      </CommandPaletteProvider>,
    );

    act(() => palette!.dispatch.openPalette("actions"));
    paletteInput.focus();
    act(() => palette!.dispatch.closePalette());

    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
    paletteInput.remove();
  });

  it("should keep object search closed without an active connection", () => {
    databaseState.activeConnectionId = null;
    let palette: PaletteContexts | undefined;

    render(
      <CommandPaletteProvider>
        <PaletteTestHarness
          onContexts={(contexts) => {
            palette = contexts;
          }}
        />
      </CommandPaletteProvider>,
    );

    act(() => palette!.dispatch.openPalette("objects"));

    expect(palette!.state.activePalette).toBeNull();
  });

  it("should open the current table in a new SQL console", async () => {
    let palette: PaletteContexts | undefined;

    render(
      <CommandPaletteProvider>
        <PaletteTestHarness
          onContexts={(contexts) => {
            palette = contexts;
          }}
        />
      </CommandPaletteProvider>,
    );

    act(() => palette!.dispatch.openPalette("actions"));

    const command = palette!.items.find(
      (item) => item.id === "table.open-in-console",
    );

    await act(async () => {
      await command!.primaryAction.execute();
    });

    // The root scope has no in-place editor, so it routes through route state
    // — the same path every other object navigation uses.
    expect(navigateMock).toHaveBeenCalledWith("/editor", {
      state: {
        kind: "console",
        initialQuery: 'SELECT * FROM "public"."users"',
        queryName: "users",
        preventAutoRun: true,
        schema: "public",
        targetConnectionId: "connection-1",
      },
    });
    expect(addTabMock).not.toHaveBeenCalled();
  });

  it("should not notify dispatch consumers when the active tab changes", () => {
    const onRender = vi.fn();
    const { rerender } = render(
      <CommandPaletteProvider>
        <DispatchConsumer onRender={onRender} />
      </CommandPaletteProvider>,
    );

    editorState.activeTab = {
      ...editorState.activeTab,
    };

    rerender(
      <CommandPaletteProvider>
        <DispatchConsumer onRender={onRender} />
      </CommandPaletteProvider>,
    );

    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("should keep dispatch consumers stable while toggling palette state", () => {
    const onRender = vi.fn();
    let palette: PaletteContexts | undefined;
    render(
      <CommandPaletteProvider>
        <DispatchAndStateConsumer
          onContexts={(contexts) => {
            palette = contexts;
          }}
        />
        <DispatchConsumer onRender={onRender} />
      </CommandPaletteProvider>,
    );

    act(() => palette!.dispatch.togglePalette("actions"));
    expect(palette!.state.activePalette).toBe("actions");
    expect(onRender).toHaveBeenCalledTimes(1);

    act(() => palette!.dispatch.togglePalette("actions"));
    expect(palette!.state.activePalette).toBeNull();
    expect(onRender).toHaveBeenCalledTimes(1);
  });
});
