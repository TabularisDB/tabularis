import {describe, expect, it} from 'vitest';
import en from '@/i18n/locales/en.json';

const locales = import.meta.glob<{default: typeof en}>('../../src/i18n/locales/*.json', {
    eager: true,
});

describe('find in results translations', () => {
    it.each(Object.entries(locales))(
        'covers the find bar and its shortcut in %s',
        (_path, locale) => {
            const {dataGrid, settings} = locale.default;
            expect(settings.shortcuts.findInGrid.trim()).not.toBe('');
            expect(Object.keys(dataGrid.find).sort()).toEqual(Object.keys(en.dataGrid.find).sort());
            for (const value of Object.values(dataGrid.find)) expect(value.trim()).not.toBe('');
            for (const key of ['position', 'announcement'] as const) {
                expect(dataGrid.find[key]).toContain('{{current}}');
                expect(dataGrid.find[key]).toContain('{{total}}');
            }
            expect(dataGrid.find.loadedRowsOnly).toContain('{{loaded}}');
            expect(dataGrid.find.loadedRowsOfTotal).toContain('{{loaded}}');
            expect(dataGrid.find.loadedRowsOfTotal).toContain('{{total}}');
        },
    );
});
