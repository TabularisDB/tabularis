import { createContext } from "react";

import type {
  CommandPaletteMode,
} from "../types/commands";

export interface CommandPaletteStateContextType {
  activePalette: CommandPaletteMode | null;
}

export interface CommandPaletteDispatchContextType {
  openPalette: (mode: CommandPaletteMode) => void;
  closePalette: () => void;
  togglePalette: (mode: CommandPaletteMode) => void;
}

export const CommandPaletteStateContext = createContext<
  CommandPaletteStateContextType | undefined
>(undefined);

export const CommandPaletteDispatchContext = createContext<
  CommandPaletteDispatchContextType | undefined
>(undefined);
