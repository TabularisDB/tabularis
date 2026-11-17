import {describe, expect, it} from 'vitest';

import {matchesShortcutSearch, normalizeShortcutText} from '@/utils/shortcutSearch';

describe('normalizeShortcutText', () => {
    it.each([
        ['⌘+Shift+Enter', true, 'cmd+shift+enter'],
        ['Command + Shift + Return', true, 'cmd+shift+enter'],
        ['Shift+⌥+F', true, 'shift+alt+f'],
        ['shift+option+f', true, 'shift+alt+f'],
        ['⌘+⇧+T', true, 'cmd+shift+t'],
        ['Control+Tab', true, 'ctrl+tab'],
        ['⌘+Space / ⌘+Shift+Space', true, 'cmd+space/cmd+shift+space'],
        ['ctrl enter', false, 'ctrl+enter'],
        ['Cmd+Enter', false, 'ctrl+enter'],
        ['⌘+K', false, 'ctrl+k'],
    ])('normalises "%s" (mac: %s) to "%s"', (text, isMac, expected) => {
        expect(normalizeShortcutText(text, isMac)).toBe(expected);
    });
});

describe('matchesShortcutSearch', () => {
    const runAll = {label: 'Run all statements', shortcut: '⌘+Shift+Enter'};
    const tabSwitcher = {label: 'Switch tab', shortcut: 'Ctrl+Tab'};

    it('matches every row for an empty or whitespace-only query', () => {
        expect(matchesShortcutSearch(runAll, '', true)).toBe(true);
        expect(matchesShortcutSearch(runAll, '   ', true)).toBe(true);
    });

    it('matches the label case-insensitively', () => {
        expect(matchesShortcutSearch(runAll, 'RUN ALL', true)).toBe(true);
        expect(matchesShortcutSearch(runAll, 'switch', true)).toBe(false);
    });

    it('matches a key combination through modifier aliases', () => {
        expect(matchesShortcutSearch(runAll, 'cmd+shift+enter', true)).toBe(true);
        expect(matchesShortcutSearch(runAll, '⌘ ⇧ enter', true)).toBe(true);
        expect(matchesShortcutSearch(runAll, 'shift+enter', true)).toBe(true);
    });

    it('keeps Ctrl and Cmd apart on macOS only', () => {
        expect(matchesShortcutSearch(runAll, 'ctrl+shift+enter', true)).toBe(false);
        expect(matchesShortcutSearch(tabSwitcher, 'control+tab', true)).toBe(true);

        const windowsRunAll = {label: 'Run all statements', shortcut: 'Ctrl+Shift+Enter'};
        expect(matchesShortcutSearch(windowsRunAll, 'cmd+shift+enter', false)).toBe(true);
        expect(matchesShortcutSearch(windowsRunAll, 'ctrl+shift+enter', false)).toBe(true);
    });

    it('does not match an unrelated query', () => {
        expect(matchesShortcutSearch(runAll, 'alt+f', true)).toBe(false);
    });
});
