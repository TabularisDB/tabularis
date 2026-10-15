import { createContext } from "react";
import type { ResolvedShortcut, UserOverrides, KeyMatch } from "../utils/keybindings";

export interface KeybindingsContextType {
  shortcuts: ResolvedShortcut[];
  matchesShortcut: (event: KeyboardEvent, id: string) => boolean;
  saveOverride: (id: string, mac: KeyMatch, win: KeyMatch) => Promise<void>;
  resetOverride: (id: string) => Promise<void>;
  overrides: UserOverrides;
  isMac: boolean;
}

export const KeybindingsContext = createContext<KeybindingsContextType | undefined>(undefined);
