import {describe, it, expect} from 'vitest';
import {resolveConnectionBarColor} from '@/utils/connectionColorBar';

describe('resolveConnectionBarColor', () => {
    it('mixes the connection accent color toward the theme text color', () => {
        expect(resolveConnectionBarColor('#f97316')).toBe(
            'color-mix(in srgb, #f97316 80%, var(--text-primary))',
        );
    });

    it('handles theme variables the same way', () => {
        expect(resolveConnectionBarColor('var(--accent-secondary)')).toBe(
            'color-mix(in srgb, var(--accent-secondary) 80%, var(--text-primary))',
        );
    });

    it('falls back to the theme accent when there is no connection', () => {
        const expected = 'color-mix(in srgb, var(--accent-primary) 80%, var(--text-primary))';
        expect(resolveConnectionBarColor(null)).toBe(expected);
        expect(resolveConnectionBarColor(undefined)).toBe(expected);
        expect(resolveConnectionBarColor('')).toBe(expected);
    });
});
