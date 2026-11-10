import {describe, expect, it} from 'vitest';
import {pluginGuestThemeVariables} from '@/utils/pluginGuestTheme';
import {themeRegistry} from '@/themes/themeRegistry';
import {contrastRatio, TEXT_CONTRAST} from '@/utils/themeContrast';

describe('pluginGuestThemeVariables', () => {
    for (const id of ['tabularis-light', 'tabularis-dark']) {
        it(`provides compatible wizard colors and theme geometry for ${id}`, () => {
            const theme = themeRegistry.getPreset(id)!;
            const tokens = pluginGuestThemeVariables(theme as unknown as Record<string, unknown>);
            expect(tokens['--color-text-primary']).toBe(theme.colors.text.primary);
            expect(tokens['--color-bg-elevated']).toBe(theme.colors.bg.elevated);
            expect(tokens['--color-border']).toBe(theme.colors.border.default);
            expect(tokens['--radius-lg']).toBe(theme.layout.borderRadius.lg);
            expect(tokens['--font-mono']).toBe(theme.typography.fontFamily.mono);
            for (const foreground of [
                '--text-primary',
                '--text-muted',
                '--accent-error',
                '--accent-success',
            ]) {
                expect(
                    contrastRatio(tokens[foreground], tokens['--bg-elevated']),
                ).toBeGreaterThanOrEqual(TEXT_CONTRAST);
            }
            expect(
                contrastRatio(tokens['--text-inverse'], tokens['--accent-primary']),
            ).toBeGreaterThanOrEqual(TEXT_CONTRAST);
        });
    }
    it('ignores missing and malformed token values', () => {
        expect(pluginGuestThemeVariables({colors: null})).toEqual({});
        expect(pluginGuestThemeVariables({colors: {text: {primary: 7, muted: 'custom'}}})).toEqual({
            '--text-muted': 'custom',
            '--color-text-muted': 'custom',
        });
    });
});
