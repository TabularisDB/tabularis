import {describe, it, expect} from 'vitest';
import {resolveConnectionBarColor} from '@/utils/connectionColorBar';

describe('resolveConnectionBarColor', () => {
    it('brightens the connection accent color', () => {
        expect(resolveConnectionBarColor('#f97316')).toBe('color-mix(in srgb, #f97316 80%, white)');
    });

    it('brightens theme variables the same way', () => {
        expect(resolveConnectionBarColor('var(--accent-primary)')).toBe(
            'color-mix(in srgb, var(--accent-primary) 80%, white)',
        );
    });

    it('falls back to light blue when there is no connection', () => {
        expect(resolveConnectionBarColor(null)).toBe('lightskyblue');
        expect(resolveConnectionBarColor(undefined)).toBe('lightskyblue');
        expect(resolveConnectionBarColor('')).toBe('lightskyblue');
    });
});
