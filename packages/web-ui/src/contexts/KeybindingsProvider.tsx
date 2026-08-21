import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import shortcutDefs from "../config/shortcuts.json";
import {
  mergeShortcuts,
  matchesEvent,
  resolveMatch,
  type ShortcutDef,
  type UserOverrides,
  type KeyMatch,
} from "../utils/keybindings";
import { KeybindingsContext } from "./KeybindingsContext";

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

export const KeybindingsProvider = ({ children }: { children: ReactNode }) => {
  const [overrides, setOverrides] = useState<UserOverrides>({});

  useEffect(() => {
    invoke<UserOverrides>("get_keybindings")
      .then((data) => {
        if (data && typeof data === "object") setOverrides(data as UserOverrides);
      })
      .catch(() => {
        // no keybindings file yet — use defaults
      });
  }, []);

  const shortcuts = mergeShortcuts(shortcutDefs as ShortcutDef[], overrides, isMac);

  const matchesShortcut = useCallback(
    (event: KeyboardEvent, id: string): boolean => {
      const def = (shortcutDefs as ShortcutDef[]).find((d) => d.id === id);
      if (!def) return false;
      const match = resolveMatch(def, overrides, isMac);
      if (matchesEvent(event, match)) return true;
      // On Mac, accept Ctrl as an alias for ⌘ (and vice-versa) for user convenience
      if (isMac && match.metaKey && !match.ctrlKey) {
        return matchesEvent(event, { ...match, metaKey: false, ctrlKey: true });
      }
      return false;
    },
    [overrides],
  );

  const saveOverride = useCallback(
    async (id: string, mac: KeyMatch, win: KeyMatch) => {
      const next = { ...overrides, [id]: { mac, win } };
      setOverrides(next);
      await invoke("save_keybindings", { keybindings: next });
    },
    [overrides],
  );

  const resetOverride = useCallback(
    async (id: string) => {
      const next = { ...overrides };
      delete next[id];
      setOverrides(next);
      await invoke("save_keybindings", { keybindings: next });
    },
    [overrides],
  );

  return (
    <KeybindingsContext.Provider
      value={{ shortcuts, matchesShortcut, saveOverride, resetOverride, overrides, isMac }}
    >
      {children}
    </KeybindingsContext.Provider>
  );
};
