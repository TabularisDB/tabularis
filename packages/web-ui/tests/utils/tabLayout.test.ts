import {describe, it, expect} from 'vitest';
import {DEFAULT_TAB_LAYOUT, resolveTabLayout} from '@/utils/tabLayout';

describe('resolveTabLayout', () => {
    it('defaults to horizontal', () => {
        expect(DEFAULT_TAB_LAYOUT).toBe('horizontal');
        expect(resolveTabLayout(undefined)).toBe('horizontal');
    });

    it('accepts vertical and horizontal', () => {
        expect(resolveTabLayout('vertical')).toBe('vertical');
        expect(resolveTabLayout('horizontal')).toBe('horizontal');
    });

    it('falls back to horizontal for unknown values', () => {
        expect(resolveTabLayout('diagonal')).toBe('horizontal');
        expect(resolveTabLayout(null)).toBe('horizontal');
        expect(resolveTabLayout(42)).toBe('horizontal');
    });
});
