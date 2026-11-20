import {describe, expect, it} from 'vitest';

import {APP_MENU_SECTIONS, shouldInstallAppMenu, type AppMenuAction} from '@/utils/appMenu';

const locales = import.meta.glob<{default: unknown}>('../../src/i18n/locales/*.json', {
    eager: true,
});

function lookup(dictionary: unknown, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => {
        if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
        return undefined;
    }, dictionary);
}

const actions = APP_MENU_SECTIONS.flatMap((section) =>
    section.entries.filter((entry): entry is AppMenuAction => entry !== 'separator'),
);

describe('appMenu', () => {
    describe('shouldInstallAppMenu', () => {
        it('installs the menu from the main desktop window on macOS', () => {
            expect(
                shouldInstallAppMenu({environment: 'tauri', windowLabel: 'main', isMac: true}),
            ).toBe(true);
        });

        it.each([
            {environment: 'browser', windowLabel: 'main', isMac: true},
            {environment: 'tauri', windowLabel: 'connection-window-1', isMac: true},
            {environment: 'tauri', windowLabel: 'main', isMac: false},
        ])('skips $environment / $windowLabel / isMac=$isMac', (host) => {
            expect(shouldInstallAppMenu(host)).toBe(false);
        });
    });

    describe('APP_MENU_SECTIONS', () => {
        it('uses each action once', () => {
            const ids = actions.map((action) => action.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it.each(Object.entries(locales))('has a label for every action in %s', (_path, locale) => {
            const missing = actions
                .map((action) => action.labelKey)
                .filter((key) => typeof lookup(locale.default, key) !== 'string');
            expect(missing).toEqual([]);
        });
    });
});
