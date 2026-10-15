import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { CommandPaletteScopeContext } from "../../src/contexts/CommandPaletteScopeContext";
import { useActiveCommandPaletteScope } from "../../src/hooks/useCommandPaletteScope";
import type { CommandScope } from "../../src/types/commands";
import { createCommandScopeStore } from "../../src/utils/commandScopeStore";

describe("useActiveCommandPaletteScope", () => {
  it("should resolve the provider-owned active scope without reading layout state", () => {
    const store = createCommandScopeStore();
    const scope: CommandScope = {
      connectionId: "connection-b",
      driver: null,
      table: null,
      runtime: {
        navigate: vi.fn(),
        openEditor: vi.fn(),
      },
    };
    store.registerScope("connection-b", scope);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <CommandPaletteScopeContext.Provider
        value={{
          activeScopeId: "connection-b",
          store,
        }}
      >
        {children}
      </CommandPaletteScopeContext.Provider>
    );

    const { result } = renderHook(
      () => useActiveCommandPaletteScope(),
      { wrapper },
    );

    expect(result.current).toBe(scope);
  });
});
