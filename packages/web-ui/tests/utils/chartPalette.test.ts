import {describe, it, expect} from 'vitest';
import {
    CATEGORICAL_SERIES_TOKENS,
    buildCategoricalSeries,
    radiusToPixels,
} from '@/utils/chartPalette';
import builtinThemes from '@/themes/builtin-themes.json';
import type {ThemeColors} from '@/types/theme';

const themes = builtinThemes as unknown as {
    id: string;
    colors: ThemeColors;
}[];
const byId = (id: string) => themes.find((t) => t.id === id)!.colors;

describe('chartPalette', () => {
    describe('buildCategoricalSeries', () => {
        it('follows the colour-blind-checked token order', () => {
            const colors = byId('tabularis-dark');
            expect(buildCategoricalSeries(colors).slice(0, 4)).toEqual([
                colors.accent.primary,
                colors.accent.warning,
                colors.semantic.boolean,
                colors.accent.success,
            ]);
        });

        it('never repeats a colour when a theme reuses one hue for two tokens', () => {
            const colors = byId('high-contrast');
            const series = buildCategoricalSeries(colors);
            const normalized = series.map((c) => c.toLowerCase());
            expect(new Set(normalized).size).toBe(series.length);
            expect(series.length).toBeLessThan(CATEGORICAL_SERIES_TOKENS.length);
        });

        it('gives every built-in theme at least five distinct series colours', () => {
            for (const theme of themes) {
                expect(buildCategoricalSeries(theme.colors).length).toBeGreaterThanOrEqual(5);
            }
        });
    });

    describe('radiusToPixels', () => {
        it('converts rem and px and caps the result', () => {
            expect(radiusToPixels('0.25rem')).toBe(4);
            expect(radiusToPixels('2px')).toBe(2);
            expect(radiusToPixels('1rem')).toBe(4);
        });

        it('keeps square themes square', () => {
            expect(radiusToPixels('0')).toBe(0);
            expect(radiusToPixels(undefined)).toBe(0);
            expect(radiusToPixels('none')).toBe(0);
        });
    });
});
