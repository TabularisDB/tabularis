export type ShortcutCategory =
  | "editor"
  | "navigation"
  | "data_grid"
  | "notebook";

export interface ShortcutDef {
  id: string;
  category: ShortcutCategory;
  defaultMac: string;
  defaultWin: string;
  macMatch: KeyMatch;
  winMatch: KeyMatch;
  i18nKey: string;
  overridable: boolean;
}

export interface KeyMatch {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type UserOverrides = Record<string, { mac: KeyMatch; win: KeyMatch }>;

export interface ResolvedShortcut extends ShortcutDef {
  match: KeyMatch;
}

const KEY_BY_CODE: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: " ",
  NumpadEnter: "Enter",
  NumpadDecimal: ".",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadMultiply: "*",
  NumpadDivide: "/",
};

const SHIFTED_KEY_BY_CODE: Record<string, string> = {
  Backquote: "~",
  Digit1: "!",
  Digit2: "@",
  Digit3: "#",
  Digit4: "$",
  Digit5: "%",
  Digit6: "^",
  Digit7: "&",
  Digit8: "*",
  Digit9: "(",
  Digit0: ")",
  Minus: "_",
  Equal: "+",
  BracketLeft: "{",
  BracketRight: "}",
  Backslash: "|",
  Semicolon: ":",
  Quote: "\"",
  Comma: "<",
  Period: ">",
  Slash: "?",
};

function keyFromCode(
  code: string | undefined,
  shiftKey: boolean,
): string | undefined {
  if (!code) return undefined;
  const baseKey = Object.hasOwn(KEY_BY_CODE, code)
    ? KEY_BY_CODE[code]
    : undefined;
  const shiftedKey =
    shiftKey && Object.hasOwn(SHIFTED_KEY_BY_CODE, code)
      ? SHIFTED_KEY_BY_CODE[code]
      : undefined;
  const mappedKey = shiftedKey ?? baseKey;
  if (mappedKey !== undefined) return mappedKey.toLowerCase();
  if (code.length === 4 && code.startsWith("Key")) {
    return code.slice(3).toLowerCase();
  }
  if (code.length === 6 && code.startsWith("Digit")) {
    return code.slice(5);
  }
  if (code.length === 7 && code.startsWith("Numpad")) {
    const digit = code.slice(6);
    if (digit >= "0" && digit <= "9") return digit;
  }
  return code.toLowerCase();
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
 * Matches either the produced character or the physical key, with exact modifiers.
 */
export function matchesEvent(event: KeyboardEvent, match: KeyMatch): boolean {
  const keyHit = event.key.toLowerCase() === match.key.toLowerCase();
  const codeHit = match.code !== undefined && event.code === match.code;
  if (!keyHit && !codeHit) return false;
  if (!!match.ctrlKey !== event.ctrlKey) return false;
  if (!!match.metaKey !== event.metaKey) return false;
  if (!!match.shiftKey !== event.shiftKey) return false;
  if (!!match.altKey !== event.altKey) return false;
  return true;
}

/** Returns the zero-based connection index for Cmd/Ctrl+Shift+1–9. */
export function connectionIndexFromShortcut(
  shortcut: Pick<
    KeyMatch,
    "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
  isMac: boolean,
): number | null {
  const hasExactPrimaryModifier = isMac
    ? !!shortcut.metaKey !== !!shortcut.ctrlKey
    : !!shortcut.ctrlKey && !shortcut.metaKey;
  if (
    !hasExactPrimaryModifier ||
    !shortcut.shiftKey ||
    shortcut.altKey ||
    !/^Digit[1-9]$/.test(shortcut.code ?? "")
  ) {
    return null;
  }
  return Number(shortcut.code?.slice(-1)) - 1;
}

const ARROW_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/** Matches shortcuts whose config entry represents a built-in key range. */
export function matchesReservedShortcut(
  shortcutId: string,
  match: KeyMatch,
  isMac: boolean,
): boolean {
  if (shortcutId === "switch_connection") {
    return connectionIndexFromShortcut(match, isMac) !== null;
  }

  const isArrow = ARROW_KEYS.has(match.key);
  const hasPrimaryModifier = isMac
    ? !!match.metaKey !== !!match.ctrlKey
    : !!match.ctrlKey && !match.metaKey;
  const hasNoPrimaryModifier = !match.ctrlKey && !match.metaKey;
  const hasNoAltModifier = !match.altKey;

  switch (shortcutId) {
    case "extend_cell_range":
      return (
        isArrow &&
        !!match.shiftKey &&
        hasNoPrimaryModifier &&
        hasNoAltModifier
      );
    case "jump_to_edge":
      return (
        isArrow &&
        hasPrimaryModifier &&
        !match.shiftKey &&
        hasNoAltModifier
      );
    case "extend_cell_range_to_edge":
      return (
        isArrow &&
        hasPrimaryModifier &&
        !!match.shiftKey &&
        hasNoAltModifier
      );
    case "select_row":
      return (
        match.key === " " &&
        !!match.shiftKey &&
        hasNoPrimaryModifier &&
        hasNoAltModifier
      );
    case "select_column":
      return (
        match.key === " " &&
        hasPrimaryModifier &&
        hasNoAltModifier
      );
    default:
      return false;
  }
}

/**
 * Detects current aliases and potential code-to-key collisions after a layout switch.
 * Physical codes project to their US-QWERTY key because KeyboardEvent.code uses that layout.
 */
export function keyMatchesOverlap(
  first: KeyMatch,
  second: KeyMatch,
  isMac = false,
): boolean {
  if (!!first.shiftKey !== !!second.shiftKey) return false;
  if (!!first.altKey !== !!second.altKey) return false;

  const samePrimaryModifiers =
    !!first.ctrlKey === !!second.ctrlKey &&
    !!first.metaKey === !!second.metaKey;
  // KeybindingsProvider lets Cmd-only shortcuts accept Ctrl on macOS.
  const usesMacAlias =
    isMac &&
    ((!!first.metaKey &&
      !first.ctrlKey &&
      !!second.ctrlKey &&
      !second.metaKey) ||
      (!!second.metaKey &&
        !second.ctrlKey &&
        !!first.ctrlKey &&
        !first.metaKey));
  if (!samePrimaryModifiers && !usesMacAlias) return false;

  const firstKey = first.key.toLowerCase();
  const secondKey = second.key.toLowerCase();
  const sameKey = firstKey === secondKey;
  const sameCode =
    first.code !== undefined &&
    second.code !== undefined &&
    first.code === second.code;
  const firstCodeMatchesKey =
    keyFromCode(first.code, !!first.shiftKey) === secondKey;
  const secondCodeMatchesKey =
    keyFromCode(second.code, !!second.shiftKey) === firstKey;
  return (
    sameKey || sameCode || firstCodeMatchesKey || secondCodeMatchesKey
  );
}

/**
 * Navigation is global, editor and data-grid share one handler, and notebook is isolated.
 */
export function shortcutCategoriesOverlap(
  first: ShortcutCategory,
  second: ShortcutCategory,
): boolean {
  if (first === "notebook" || second === "notebook") {
    return first === second || first === "navigation" || second === "navigation";
  }
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
