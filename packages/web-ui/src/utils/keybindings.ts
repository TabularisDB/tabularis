export interface ShortcutDef {
  id: string;
  category: "editor" | "navigation" | "data_grid";
  defaultMac: string;
  defaultWin: string;
  macMatch: KeyMatch;
  winMatch: KeyMatch;
  i18nKey: string;
  overridable: boolean;
}

export interface KeyMatch {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type UserOverrides = Record<string, { mac: KeyMatch; win: KeyMatch }>;

export interface ResolvedShortcut extends ShortcutDef {
  match: KeyMatch;
}

const MAC_SYMBOL_MAP: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "Del",
  " ": "Space",
};

/**
 * Reverse of MAC_SYMBOL_MAP: maps display strings back to canonical e.key values.
 * Needed so that parseCombo("Ctrl+→") correctly produces { key: "ArrowRight" }.
 */
const DISPLAY_TO_KEY: Record<string, string> = {
  "→": "ArrowRight",
  "←": "ArrowLeft",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "⌫": "Backspace",
  Del: "Delete",
  Esc: "Escape",
  Space: " ",
};

/**
 * Resolves the effective KeyMatch for the current platform, applying user overrides when present.
 */
export function resolveMatch(
  def: ShortcutDef,
  overrides: UserOverrides,
  isMac: boolean,
): KeyMatch {
  const override = overrides[def.id];
  if (override) {
    return isMac ? override.mac : override.win;
  }
  return isMac ? def.macMatch : def.winMatch;
}

/**
 * Returns true if a KeyboardEvent matches the given KeyMatch.
 */
export function matchesEvent(event: KeyboardEvent, match: KeyMatch): boolean {
  if (event.key.toLowerCase() !== match.key.toLowerCase()) return false;
  if (!!match.ctrlKey !== event.ctrlKey) return false;
  if (!!match.metaKey !== event.metaKey) return false;
  if (!!match.shiftKey !== event.shiftKey) return false;
  if (!!match.altKey !== event.altKey) return false;
  return true;
}

/**
 * Merges default shortcut definitions with user overrides into a resolved list.
 * Non-overridable shortcuts always use their defaults.
 */
export function mergeShortcuts(
  defaults: ShortcutDef[],
  overrides: UserOverrides,
  isMac: boolean,
): ResolvedShortcut[] {
  return defaults.map((def) => ({
    ...def,
    match: resolveMatch(def, overrides, isMac),
  }));
}

/**
 * Parses a combo string like "⌘+Shift+T" or "Ctrl+ArrowRight" into a KeyMatch.
 */
export function parseCombo(combo: string): KeyMatch {
  const parts = combo.split("+");
  const result: KeyMatch = { key: "" };

  for (const part of parts) {
    const p = part.trim();
    if (p === "⌘" || p === "Cmd" || p === "Meta") {
      result.metaKey = true;
    } else if (p === "Ctrl" || p === "Control") {
      result.ctrlKey = true;
    } else if (p === "Shift") {
      result.shiftKey = true;
    } else if (p === "Alt" || p === "Option" || p === "⌥") {
      result.altKey = true;
    } else {
      // Reverse-map display symbols back to canonical e.key values, then
      // lowercase single-character keys (letters) for consistent matching.
      if (DISPLAY_TO_KEY[p] !== undefined) {
        result.key = DISPLAY_TO_KEY[p];
      } else {
        result.key = p.length === 1 ? p.toLowerCase() : p;
      }
    }
  }

  return result;
}

/**
 * Formats a KeyboardEvent into a human-readable combo string.
 */
export function formatEvent(event: KeyboardEvent, isMac: boolean): string {
  const parts: string[] = [];
  if (isMac) {
    if (event.metaKey) parts.push("⌘");
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.shiftKey) parts.push("Shift");
    if (event.altKey) parts.push("⌥");
  } else {
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.shiftKey) parts.push("Shift");
    if (event.altKey) parts.push("Alt");
  }
  const key = formatKey(event.key, isMac);
  if (key) parts.push(key);
  return parts.join("+");
}

/**
 * Formats a KeyMatch into a human-readable combo string.
 */
export function formatMatch(match: KeyMatch, isMac: boolean): string {
  const parts: string[] = [];
  if (isMac) {
    if (match.metaKey) parts.push("⌘");
    if (match.ctrlKey) parts.push("Ctrl");
    if (match.shiftKey) parts.push("Shift");
    if (match.altKey) parts.push("⌥");
  } else {
    if (match.ctrlKey) parts.push("Ctrl");
    if (match.shiftKey) parts.push("Shift");
    if (match.altKey) parts.push("Alt");
  }
  const key = formatKey(match.key, isMac);
  if (key) parts.push(key);
  return parts.join("+");
}

function formatKey(key: string, isMac: boolean): string {
  if (isMac && MAC_SYMBOL_MAP[key]) return MAC_SYMBOL_MAP[key];
  // Common display names for all platforms
  const COMMON_DISPLAY: Record<string, string> = {
    ArrowRight: "→",
    ArrowLeft: "←",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Enter: "Enter",
    Tab: "Tab",
    Escape: "Esc",
    Backspace: "Backspace",
    Delete: "Del",
    " ": "Space",
  };
  if (COMMON_DISPLAY[key]) return COMMON_DISPLAY[key];
  // Uppercase single letter keys for display
  if (key.length === 1) return key.toUpperCase();
  return key;
}
