import type { CommandScope } from "../types/commands";

export const ROOT_COMMAND_SCOPE_ID = "root";

type ScopeListener = () => void;

interface ActiveCommandScopeState {
  explorerConnectionId: string | null;
  isSplitRendered: boolean;
}

export function getActiveCommandScopeId({
  explorerConnectionId,
  isSplitRendered,
}: ActiveCommandScopeState): string {
  return isSplitRendered && explorerConnectionId
    ? explorerConnectionId
    : ROOT_COMMAND_SCOPE_ID;
}

export interface CommandScopeStore {
  getScope: (scopeId: string) => CommandScope | undefined;
  /** Each scope id has exactly one owner: the layout, or a split pane. */
  registerScope: (scopeId: string, scope: CommandScope) => () => void;
  subscribe: (listener: ScopeListener) => () => void;
}

export function createCommandScopeStore(): CommandScopeStore {
  const scopes = new Map<string, CommandScope>();
  const listeners = new Set<ScopeListener>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    getScope: (scopeId) => scopes.get(scopeId),
    registerScope: (scopeId, scope) => {
      scopes.set(scopeId, scope);
      notify();

      return () => {
        // A re-registration can land before the previous effect cleans up, so
        // only the current owner is allowed to clear the entry.
        if (scopes.get(scopeId) !== scope) return;
        scopes.delete(scopeId);
        notify();
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
