import {describe, expect, it} from 'vitest';
import {clamp} from '@/utils/number';

describe('clamp', () => {
    it('keeps a value inside the limits', () => {
        expect(clamp(120, 48, 2000)).toBe(120);
    });

    it('raises a value below the minimum', () => {
        expect(clamp(10, 48, 2000)).toBe(48);
        expect(clamp(-50, 48, 2000)).toBe(48);
    });

    it('lowers a value above the maximum', () => {
        expect(clamp(2400, 48, 2000)).toBe(2000);
    });

    it('accepts the limits themselves', () => {
        expect(clamp(48, 48, 2000)).toBe(48);
        expect(clamp(2000, 48, 2000)).toBe(2000);
    });
});
