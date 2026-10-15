import {
  useCallback,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";

import { CommandPaletteScopeContext } from "../contexts/CommandPaletteScopeContext";
import type { CommandScope } from "../types/commands";

function useCommandScopeContext() {
  const context = useContext(CommandPaletteScopeContext);
  if (!context) {
    throw new Error(
      "Command palette scopes must be used inside CommandPaletteProvider",
    );
  }
  return context;
}

export function useRegisterCommandPaletteScope(
  scopeId: string,
  scope: CommandScope,
) {
  const { store } = useCommandScopeContext();

  useLayoutEffect(
    () => store.registerScope(scopeId, scope),
    [scope, scopeId, store],
  );
}

export function useActiveCommandPaletteScope(): CommandScope | undefined {
  const { activeScopeId, store } = useCommandScopeContext();
  const getSnapshot = useCallback(
    () => store.getScope(activeScopeId),
    [activeScopeId, store],
  );

  return useSyncExternalStore(
    store.subscribe,
    getSnapshot,
    getSnapshot,
  );
}
