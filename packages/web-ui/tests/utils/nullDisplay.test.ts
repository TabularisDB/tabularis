import {describe, it, expect} from 'vitest';
import {DEFAULT_NULL_DISPLAY, getNullDisplayLabel} from '@/utils/nullDisplay';
import {formatCellValue} from '@/utils/dataGrid';

describe('nullDisplay', () => {
    describe('getNullDisplayLabel', () => {
        it('keeps the translated label by default', () => {
            expect(getNullDisplayLabel('default', 'null')).toBe('null');
            expect(getNullDisplayLabel(undefined, 'nulo')).toBe('nulo');
            expect(getNullDisplayLabel(DEFAULT_NULL_DISPLAY, 'null')).toBe('null');
        });

        it('returns the chosen marker', () => {
            expect(getNullDisplayLabel('parenthesized', 'null')).toBe('(null)');
            expect(getNullDisplayLabel('emptySet', 'null')).toBe('∅');
            expect(getNullDisplayLabel('empty', 'null')).toBe('');
        });

        it('only changes NULL cells when passed to formatCellValue', () => {
            const label = getNullDisplayLabel('emptySet', 'null');
            expect(formatCellValue(null, label)).toBe('∅');
            expect(formatCellValue(undefined, label)).toBe('∅');
            expect(formatCellValue('', label)).toBe('');
            expect(formatCellValue(0, label)).toBe('0');
        });
    });
});
