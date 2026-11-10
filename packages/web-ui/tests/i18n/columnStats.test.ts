import {describe, expect, it} from 'vitest';
import en from '@/i18n/locales/en.json';

const locales = import.meta.glob<{default: typeof en}>('../../src/i18n/locales/*.json', {
    eager: true,
});

describe('column statistics translations', () => {
    it.each(Object.entries(locales))(
        'covers the menu entry and the popover in %s',
        (_path, locale) => {
            const {dataGrid} = locale.default;
            expect(dataGrid.columnStatistics.trim()).not.toBe('');
            expect(Object.keys(dataGrid.columnStats).sort()).toEqual(
                Object.keys(en.dataGrid.columnStats).sort(),
            );
            for (const value of Object.values(dataGrid.columnStats))
                expect(value.trim()).not.toBe('');
            expect(dataGrid.columnStats.topValues).toContain('{{count}}');
            expect(dataGrid.columnStats.filterBy).toContain('{{value}}');
            expect(dataGrid.columnStats.sampled).toContain('{{size}}');
        },
    );
});
