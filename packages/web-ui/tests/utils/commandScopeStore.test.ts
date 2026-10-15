import { describe, expect, it, vi } from "vitest";

import type { CommandScope } from "../../src/types/commands";
import {
  createCommandScopeStore,
  getActiveCommandScopeId,
  ROOT_COMMAND_SCOPE_ID,
} from "../../src/utils/commandScopeStore";

function createScope(connectionId: string): CommandScope {
  return {
    connectionId,
    driver: null,
    table: null,
    runtime: {
      navigate: vi.fn(),
      openEditor: vi.fn(),
    },
  };
}

describe("createCommandScopeStore", () => {
  it("should ignore a stale unregister after the scope was replaced", () => {
    const store = createCommandScopeStore();
    const oldScope = createScope("old");
    const newScope = createScope("new");

    const unregisterOldScope = store.registerScope(
      ROOT_COMMAND_SCOPE_ID,
      oldScope,
    );
    store.registerScope(ROOT_COMMAND_SCOPE_ID, newScope);

    unregisterOldScope();

    expect(store.getScope(ROOT_COMMAND_SCOPE_ID)).toBe(newScope);
  });

  it("should forget a scope id once its owner unmounts", () => {
    const store = createCommandScopeStore();
    const unregister = store.registerScope(
      "panel",
      createScope("panel"),
    );

    unregister();

    expect(store.getScope("panel")).toBeUndefined();
  });
});

describe("getActiveCommandScopeId", () => {
  it("should use the active split pane when the split layout is rendered", () => {
    expect(
      getActiveCommandScopeId({
        explorerConnectionId: "connection-b",
        isSplitRendered: true,
      }),
    ).toBe("connection-b");
  });

  it("should use the root scope when the split layout is not rendered", () => {
    expect(
      getActiveCommandScopeId({
        explorerConnectionId: "connection-b",
        isSplitRendered: false,
      }),
    ).toBe(ROOT_COMMAND_SCOPE_ID);
  });
});
