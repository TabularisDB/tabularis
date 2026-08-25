import { useState, useEffect, useCallback, type ReactNode } from "react";
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
import { useTabularisClient } from "../hooks/useTabularisClient";

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

export const KeybindingsProvider = ({ children }: { children: ReactNode }) => {
  const client = useTabularisClient();
  const [overrides, setOverrides] = useState<UserOverrides>({});

  useEffect(() => {
    client.call("get_keybindings", undefined)
      .then((data) => {
        if (data && typeof data === "object") setOverrides(data);
      })
      .catch(() => {
        // no keybindings file yet — use defaults
      });
  }, [client]);

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
      await client.call("save_keybindings", { keybindings: next });
    },
    [client, overrides],
  );

  const resetOverride = useCallback(
    async (id: string) => {
      const next = { ...overrides };
      delete next[id];
      setOverrides(next);
      await client.call("save_keybindings", { keybindings: next });
    },
    [client, overrides],
  );

  return (
    <KeybindingsContext.Provider
      value={{ shortcuts, matchesShortcut, saveOverride, resetOverride, overrides, isMac }}
    >
      {children}
    </KeybindingsContext.Provider>
  );
};
