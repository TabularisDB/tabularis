import { describe, it, expect } from 'vitest';
import {
  resolveMatch,
  matchesEvent,
  mergeShortcuts,
  parseCombo,
  formatEvent,
  formatMatch,
  type ShortcutDef,
  type KeyMatch,
  type UserOverrides,
} from '../../src/utils/keybindings';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeDef = (overrides?: Partial<ShortcutDef>): ShortcutDef => ({
  id: 'toggle_sidebar',
  category: 'navigation',
  defaultMac: '⌘+B',
  defaultWin: 'Ctrl+B',
  macMatch: { metaKey: true, key: 'b' },
  winMatch: { ctrlKey: true, key: 'b' },
  i18nKey: 'settings.shortcuts.toggleSidebar',
  overridable: true,
  ...overrides,
});

const makeEvent = (overrides: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    key: 'b',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent);

// ─── resolveMatch ─────────────────────────────────────────────────────────────

describe('resolveMatch', () => {
  it('returns macMatch on Mac when no override', () => {
    const def = makeDef();
    expect(resolveMatch(def, {}, true)).toEqual({ metaKey: true, key: 'b' });
  });

  it('returns winMatch on Win when no override', () => {
    const def = makeDef();
    expect(resolveMatch(def, {}, false)).toEqual({ ctrlKey: true, key: 'b' });
  });

  it('applies mac override when present', () => {
    const def = makeDef();
    const overrides: UserOverrides = {
      toggle_sidebar: {
        mac: { metaKey: true, key: 'k' },
        win: { ctrlKey: true, key: 'k' },
      },
    };
    expect(resolveMatch(def, overrides, true)).toEqual({ metaKey: true, key: 'k' });
  });

  it('applies win override when present', () => {
    const def = makeDef();
    const overrides: UserOverrides = {
      toggle_sidebar: {
        mac: { metaKey: true, key: 'k' },
        win: { ctrlKey: true, key: 'k' },
      },
    };
    expect(resolveMatch(def, overrides, false)).toEqual({ ctrlKey: true, key: 'k' });
  });

  it('ignores override for a different id', () => {
    const def = makeDef({ id: 'new_tab' });
    const overrides: UserOverrides = {
      toggle_sidebar: { mac: { metaKey: true, key: 'k' }, win: { ctrlKey: true, key: 'k' } },
    };
    expect(resolveMatch(def, overrides, true)).toEqual(def.macMatch);
  });
});

// ─── matchesEvent ─────────────────────────────────────────────────────────────

describe('matchesEvent', () => {
  it('matches a correct event', () => {
    const match: KeyMatch = { metaKey: true, key: 'b' };
    const event = makeEvent({ key: 'b', metaKey: true });
    expect(matchesEvent(event, match)).toBe(true);
  });

  it('rejects wrong key', () => {
    const match: KeyMatch = { metaKey: true, key: 'b' };
    const event = makeEvent({ key: 'k', metaKey: true });
    expect(matchesEvent(event, match)).toBe(false);
  });

  it('rejects wrong modifier', () => {
    const match: KeyMatch = { metaKey: true, key: 'b' };
    const event = makeEvent({ key: 'b', ctrlKey: true });
    expect(matchesEvent(event, match)).toBe(false);
  });

  it('rejects extra shift when not expected', () => {
    const match: KeyMatch = { ctrlKey: true, key: 'b' };
    const event = makeEvent({ key: 'b', ctrlKey: true, shiftKey: true });
    expect(matchesEvent(event, match)).toBe(false);
  });

  it('matches shortcut that requires shift', () => {
    const match: KeyMatch = { ctrlKey: true, shiftKey: true, key: 'n' };
    const event = makeEvent({ key: 'n', ctrlKey: true, shiftKey: true });
    expect(matchesEvent(event, match)).toBe(true);
  });

  it('is case-insensitive on key', () => {
    const match: KeyMatch = { metaKey: true, key: 'b' };
    const event = makeEvent({ key: 'B', metaKey: true });
    expect(matchesEvent(event, match)).toBe(true);
  });
});

// ─── mergeShortcuts ────────────────────────────────────────────────────────────

describe('mergeShortcuts', () => {
  const defs: ShortcutDef[] = [
    makeDef({ id: 'toggle_sidebar', overridable: true }),
    makeDef({ id: 'run_query', overridable: false, macMatch: { metaKey: true, key: 'F5' }, winMatch: { ctrlKey: true, key: 'F5' } }),
  ];

  it('preserves all defaults when no overrides', () => {
    const result = mergeShortcuts(defs, {}, true);
    expect(result).toHaveLength(2);
    expect(result[0].match).toEqual(defs[0].macMatch);
    expect(result[1].match).toEqual(defs[1].macMatch);
  });

  it('applies override to overridable shortcut', () => {
    const overrides: UserOverrides = {
      toggle_sidebar: { mac: { metaKey: true, key: 'k' }, win: { ctrlKey: true, key: 'k' } },
    };
    const result = mergeShortcuts(defs, overrides, true);
    expect(result[0].match).toEqual({ metaKey: true, key: 'k' });
  });

  it('non-overridable shortcut still uses override if provided (resolveMatch does not enforce — enforcement is in UI)', () => {
    // The mergeShortcuts function doesn't enforce overridable; the UI does.
    // Just confirm it still resolves without error.
    const overrides: UserOverrides = {
      run_query: { mac: { metaKey: true, key: 'x' }, win: { ctrlKey: true, key: 'x' } },
    };
    expect(() => mergeShortcuts(defs, overrides, true)).not.toThrow();
  });

  it('uses win matches on non-mac', () => {
    const result = mergeShortcuts(defs, {}, false);
    expect(result[0].match).toEqual(defs[0].winMatch);
  });
});

// ─── parseCombo ───────────────────────────────────────────────────────────────

describe('parseCombo', () => {
  it('parses ⌘+T', () => {
    expect(parseCombo('⌘+T')).toEqual({ metaKey: true, key: 't' });
  });

  it('parses Ctrl+Shift+N', () => {
    expect(parseCombo('Ctrl+Shift+N')).toEqual({ ctrlKey: true, shiftKey: true, key: 'n' });
  });

  it('parses Ctrl+ArrowRight', () => {
    expect(parseCombo('Ctrl+ArrowRight')).toEqual({ ctrlKey: true, key: 'ArrowRight' });
  });

  it('parses ⌘+Shift+C', () => {
    expect(parseCombo('⌘+Shift+C')).toEqual({ metaKey: true, shiftKey: true, key: 'c' });
  });

  it('parses Ctrl+Tab', () => {
    expect(parseCombo('Ctrl+Tab')).toEqual({ ctrlKey: true, key: 'Tab' });
  });

  it('parses Alt+F4', () => {
    expect(parseCombo('Alt+F4')).toEqual({ altKey: true, key: 'F4' });
  });

  it('reverse-maps arrow symbol → to ArrowRight', () => {
    expect(parseCombo('Ctrl+→')).toEqual({ ctrlKey: true, key: 'ArrowRight' });
  });

  it('reverse-maps arrow symbol ← to ArrowLeft', () => {
    expect(parseCombo('Ctrl+←')).toEqual({ ctrlKey: true, key: 'ArrowLeft' });
  });

  it('reverse-maps ⌫ to Backspace', () => {
    expect(parseCombo('Ctrl+⌫')).toEqual({ ctrlKey: true, key: 'Backspace' });
  });

  it('reverse-maps Space to the space character', () => {
    expect(parseCombo('Ctrl+Space')).toEqual({ ctrlKey: true, key: ' ' });
  });

  it('reverse-maps Esc to Escape', () => {
    expect(parseCombo('Ctrl+Esc')).toEqual({ ctrlKey: true, key: 'Escape' });
  });
});

// ─── formatEvent ──────────────────────────────────────────────────────────────

describe('formatEvent', () => {
  it('formats Cmd+T on Mac', () => {
    const event = makeEvent({ key: 't', metaKey: true });
    expect(formatEvent(event, true)).toBe('⌘+T');
  });

  it('formats Ctrl+T on Win', () => {
    const event = makeEvent({ key: 't', ctrlKey: true });
    expect(formatEvent(event, false)).toBe('Ctrl+T');
  });

  it('formats Ctrl+Shift+N on Win', () => {
    const event = makeEvent({ key: 'n', ctrlKey: true, shiftKey: true });
    expect(formatEvent(event, false)).toBe('Ctrl+Shift+N');
  });

  it('formats Cmd+Shift+C on Mac', () => {
    const event = makeEvent({ key: 'c', metaKey: true, shiftKey: true });
    expect(formatEvent(event, true)).toBe('⌘+Shift+C');
  });

  it('formats arrow key on Mac', () => {
    const event = makeEvent({ key: 'ArrowRight', metaKey: true });
    expect(formatEvent(event, true)).toBe('⌘+→');
  });

  it('formats arrow key on Win', () => {
    const event = makeEvent({ key: 'ArrowLeft', ctrlKey: true });
    expect(formatEvent(event, false)).toBe('Ctrl+←');
  });

  it('formats spacebar as Space', () => {
    const event = makeEvent({ key: ' ', ctrlKey: true });
    expect(formatEvent(event, false)).toBe('Ctrl+Space');
  });
});

// ─── formatMatch ──────────────────────────────────────────────────────────────

describe('formatMatch', () => {
  it('formats metaKey match on Mac', () => {
    const match: KeyMatch = { metaKey: true, key: 'b' };
    expect(formatMatch(match, true)).toBe('⌘+B');
  });

  it('formats ctrlKey match on Win', () => {
    const match: KeyMatch = { ctrlKey: true, key: 'b' };
    expect(formatMatch(match, false)).toBe('Ctrl+B');
  });

  it('formats shift combo on Mac', () => {
    const match: KeyMatch = { metaKey: true, shiftKey: true, key: 'n' };
    expect(formatMatch(match, true)).toBe('⌘+Shift+N');
  });

  it('formats ArrowRight on Win', () => {
    const match: KeyMatch = { ctrlKey: true, key: 'ArrowRight' };
    expect(formatMatch(match, false)).toBe('Ctrl+→');
  });

  it('formats space key as Space', () => {
    const match: KeyMatch = { ctrlKey: true, key: ' ' };
    expect(formatMatch(match, false)).toBe('Ctrl+Space');
  });
});
