import { describe, it, expect } from 'vitest';
import {
  resolveMatch,
  matchesEvent,
  keyMatchesOverlap,
  connectionIndexFromShortcut,
  matchesReservedShortcut,
  mergeShortcuts,
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

  it('matches a physical key across keyboard layouts when code is defined', () => {
    const match: KeyMatch = { metaKey: true, key: ',', code: 'Comma' };
    const event = makeEvent({ key: 'б', code: 'Comma', metaKey: true });

    expect(matchesEvent(event, match)).toBe(true);
  });

  it('matches the shortcut character on a different physical key', () => {
    const match: KeyMatch = { metaKey: true, key: ',', code: 'Comma' };
    const event = makeEvent({ key: ',', code: 'KeyM', metaKey: true });

    expect(matchesEvent(event, match)).toBe(true);
  });

  it('rejects an event when neither key nor physical code matches', () => {
    const match: KeyMatch = { metaKey: true, key: ',', code: 'Comma' };
    const event = makeEvent({ key: ';', code: 'Semicolon', metaKey: true });

    expect(matchesEvent(event, match)).toBe(false);
  });

  it('rejects a malformed match without throwing', () => {
    const malformed = { ctrlKey: true } as KeyMatch;

    expect(matchesEvent(makeEvent({ ctrlKey: true }), malformed)).toBe(false);
  });
});

describe('keyMatchesOverlap', () => {
  it('rejects malformed matches without throwing', () => {
    const malformed = { metaKey: true } as KeyMatch;

    expect(
      keyMatchesOverlap(malformed, { metaKey: true, key: "k" }),
    ).toBe(false);
  });

  it('detects shortcuts sharing a character alias', () => {
    const first: KeyMatch = { metaKey: true, key: ',', code: 'Comma' };
    const second: KeyMatch = { metaKey: true, key: ',', code: 'KeyM' };

    expect(keyMatchesOverlap(first, second)).toBe(true);
  });

  it('detects shortcuts sharing a physical key alias', () => {
    const first: KeyMatch = { metaKey: true, key: ',', code: 'Comma' };
    const second: KeyMatch = { metaKey: true, key: ';', code: 'Comma' };

    expect(keyMatchesOverlap(first, second)).toBe(true);
  });

  it('detects a same-code collision without key aliases', () => {
    const first: KeyMatch = { metaKey: true, key: 'ö', code: 'Semicolon' };
    const second: KeyMatch = { metaKey: true, key: 'ä', code: 'Semicolon' };

    expect(keyMatchesOverlap(first, second)).toBe(true);
  });

  it.each([
    { code: 'KeyC', recordedKey: 'с', defaultKey: 'c' },
    { code: 'Comma', recordedKey: ';', defaultKey: ',' },
    { code: 'Digit1', recordedKey: '&', defaultKey: '1' },
  ])('detects $code against a key-only shortcut', ({ code, recordedKey, defaultKey }) => {
    const recorded: KeyMatch = { metaKey: true, key: recordedKey, code };
    const defaultMatch: KeyMatch = { metaKey: true, key: defaultKey };

    expect(keyMatchesOverlap(recorded, defaultMatch)).toBe(true);
    expect(keyMatchesOverlap(defaultMatch, recorded)).toBe(true);
  });

  it('reserves a physical alias that can conflict after switching layouts', () => {
    const germanLayout: KeyMatch = {
      metaKey: true,
      key: 'ö',
      code: 'Semicolon',
    };
    const usLayout: KeyMatch = { metaKey: true, key: ';' };

    expect(keyMatchesOverlap(germanLayout, usLayout)).toBe(true);
  });

  it('normalizes shifted punctuation using US-QWERTY output', () => {
    const recorded: KeyMatch = {
      metaKey: true,
      shiftKey: true,
      key: 'Б',
      code: 'Comma',
    };
    const shiftedComma: KeyMatch = {
      metaKey: true,
      shiftKey: true,
      key: '<',
    };
    const unshiftedComma: KeyMatch = {
      metaKey: true,
      shiftKey: true,
      key: ',',
    };

    expect(keyMatchesOverlap(recorded, shiftedComma)).toBe(true);
    expect(keyMatchesOverlap(recorded, unshiftedComma)).toBe(false);
  });

  it('normalizes numpad digit codes', () => {
    const numpad: KeyMatch = { metaKey: true, key: 'End', code: 'Numpad1' };
    const digit: KeyMatch = { metaKey: true, key: '1' };

    expect(keyMatchesOverlap(numpad, digit)).toBe(true);
  });

  it('normalizes named codes through the fallback', () => {
    const physicalArrow: KeyMatch = {
      metaKey: true,
      key: '→',
      code: 'ArrowRight',
    };
    const namedArrow: KeyMatch = { metaKey: true, key: 'ArrowRight' };

    expect(keyMatchesOverlap(physicalArrow, namedArrow)).toBe(true);
  });

  it('allows the same key with different modifiers', () => {
    const first: KeyMatch = { metaKey: true, key: ',', code: 'Comma' };
    const second: KeyMatch = { ctrlKey: true, key: ',', code: 'Comma' };

    expect(keyMatchesOverlap(first, second)).toBe(false);
  });

  it('detects the Cmd/Ctrl alias overlap on Mac', () => {
    const first: KeyMatch = { metaKey: true, key: ',', code: 'Comma' };
    const second: KeyMatch = { ctrlKey: true, key: ',', code: 'Comma' };

    expect(keyMatchesOverlap(first, second, true)).toBe(true);
  });

  it('allows shortcuts with distinct keys and physical codes', () => {
    const first: KeyMatch = { metaKey: true, key: ',', code: 'Comma' };
    const second: KeyMatch = { metaKey: true, key: 'p', code: 'KeyP' };

    expect(keyMatchesOverlap(first, second)).toBe(false);
  });

  it('handles inherited object property names as unrecognized codes', () => {
    const recorded: KeyMatch = {
      metaKey: true,
      key: 'a',
      code: 'constructor',
    };
    const existing: KeyMatch = { metaKey: true, key: 'b' };

    expect(keyMatchesOverlap(recorded, existing)).toBe(false);
  });
});

describe('connectionIndexFromShortcut', () => {
  it.each([
    { code: 'Digit2', index: 1 },
    { code: 'Digit9', index: 8 },
  ])('maps $code to connection index $index', ({ code, index }) => {
    const match: KeyMatch = {
      metaKey: true,
      shiftKey: true,
      key: '',
      code,
    };

    expect(connectionIndexFromShortcut(match, true)).toBe(index);
  });

  it('rejects a digit without the platform modifier', () => {
    const match: KeyMatch = {
      shiftKey: true,
      key: '',
      code: 'Digit2',
    };

    expect(connectionIndexFromShortcut(match, true)).toBeNull();
  });

  it('rejects extra modifiers on Windows', () => {
    const match: KeyMatch = {
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
      key: '@',
      code: 'Digit2',
    };

    expect(connectionIndexFromShortcut(match, false)).toBeNull();
  });

  it('rejects pressing both primary modifiers on macOS', () => {
    const match: KeyMatch = {
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
      key: '@',
      code: 'Digit2',
    };

    expect(connectionIndexFromShortcut(match, true)).toBeNull();
  });
});

describe('matchesReservedShortcut', () => {
  it('rejects a malformed match without throwing', () => {
    const malformed = { metaKey: true } as KeyMatch;

    expect(matchesReservedShortcut('jump_to_edge', malformed, true)).toBe(false);
  });

  it.each([
    {
      id: 'extend_cell_range',
      match: { shiftKey: true, key: 'ArrowLeft', code: 'ArrowLeft' },
    },
    {
      id: 'jump_to_edge',
      match: { metaKey: true, key: 'ArrowUp', code: 'ArrowUp' },
    },
    {
      id: 'extend_cell_range_to_edge',
      match: {
        ctrlKey: true,
        shiftKey: true,
        key: 'ArrowRight',
        code: 'ArrowRight',
      },
    },
    {
      id: 'select_row',
      match: { shiftKey: true, key: ' ', code: 'Space' },
    },
    {
      id: 'select_column',
      match: { metaKey: true, shiftKey: true, key: ' ', code: 'Space' },
    },
    {
      id: 'switch_connection',
      match: {
        metaKey: true,
        shiftKey: true,
        key: '@',
        code: 'Digit2',
      },
    },
  ])('matches the full $id range', ({ id, match }) => {
    expect(matchesReservedShortcut(id, match, true)).toBe(true);
  });

  it('does not reserve an unrelated shortcut', () => {
    const match: KeyMatch = {
      metaKey: true,
      key: 'k',
      code: 'KeyK',
    };

    expect(matchesReservedShortcut('select_column', match, true)).toBe(false);
    expect(matchesReservedShortcut('open_settings', match, true)).toBe(false);
  });

  it.each([
    { platform: 'macOS', isMac: true },
    { platform: 'Windows', isMac: false },
  ])(
    'does not reserve a shortcut with both primary modifiers on $platform',
    ({ isMac }) => {
      const match: KeyMatch = {
        ctrlKey: true,
        metaKey: true,
        key: 'ArrowRight',
        code: 'ArrowRight',
      };

      expect(matchesReservedShortcut('jump_to_edge', match, isMac)).toBe(false);
    },
  );
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
  it('returns an empty label for a malformed match', () => {
    expect(formatMatch({} as KeyMatch, true)).toBe('');
  });

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
