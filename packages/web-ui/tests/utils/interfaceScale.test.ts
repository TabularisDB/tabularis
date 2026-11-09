import {describe, expect, it} from 'vitest';
import {normalizeInterfaceScale} from '@/utils/interfaceScale';

describe('interface scaling', () => {
    it('keeps old profiles at 100% and bounds native zoom', () => {
        for (const value of [undefined, null, NaN, Infinity, '125'])
            expect(normalizeInterfaceScale(value)).toBe(100);
        expect(normalizeInterfaceScale(125)).toBe(125);
        expect(normalizeInterfaceScale(50)).toBe(75);
        expect(normalizeInterfaceScale(1000)).toBe(200);
    });
});
