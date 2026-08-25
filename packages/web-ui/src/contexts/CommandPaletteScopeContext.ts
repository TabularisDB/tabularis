import { createContext } from "react";

import type { CommandScopeStore } from "../utils/commandScopeStore";

export interface CommandPaletteScopeContextValue {
  activeScopeId: string;
  store: CommandScopeStore;
}

export const CommandPaletteScopeContext = createContext<
  CommandPaletteScopeContextValue | undefined
>(undefined);
