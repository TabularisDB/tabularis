import {describe, expect, it} from 'vitest';
import {booleanEditValue, getBooleanValue} from '@/utils/boolean';
import type {DriverCapabilities} from '@/types/plugins';

describe('Boolean column values', () => {
    it.each(['bool', 'BOOLEAN', ' pg_catalog.bool '])('recognizes %s', (type) => {
        expect(getBooleanValue(true, type)).toBe(true);
        expect(getBooleanValue('f', type)).toBe(false);
        expect(getBooleanValue(null, type)).toBeNull();
    });

    it.each([true, false, 0, 1, '0', '1', 't', 'f', 'TRUE', 'FALSE', 'True', 'False', null])(
        'retains the representation when toggling and reverting %s',
        (original) => {
            const parsed = getBooleanValue(original, 'boolean');
            const toggled = booleanEditValue(!parsed, original, 'boolean');
            expect(getBooleanValue(toggled, 'boolean')).toBe(!parsed);
            expect(booleanEditValue(parsed!, original, 'boolean')).toBe(original);
        },
    );

    it('recognizes MySQL types through plugin capabilities', () => {
        const plugin = {sql_dialect: 'mysql'} as DriverCapabilities;
        for (const type of ['tinyint(1)', 'TINYINT ( 1 ) unsigned', 'bit(1)']) {
            expect(getBooleanValue(1, type, plugin)).toBe(true);
            expect(getBooleanValue('0', type, plugin)).toBe(false);
            expect(booleanEditValue(true, null, type)).toBe(1);
        }
    });

    it('distinguishes SQL Server BIT from PostgreSQL bitstrings', () => {
        expect(getBooleanValue(1, 'bit', {sql_dialect: 'mssql'} as DriverCapabilities)).toBe(true);
        expect(
            getBooleanValue('1', 'bit', {sql_dialect: 'postgres'} as DriverCapabilities),
        ).toBeUndefined();
        expect(getBooleanValue('1', 'bit(1)', 'postgres')).toBeUndefined();
        expect(getBooleanValue('101', 'bit(3)', 'mysql')).toBeUndefined();
    });

    it.each(['integer', 'tinyint', 'tinyint(2)', 'varchar', 'boolean[]', 'varbit'])(
        'keeps %s as an ordinary value',
        (type) => {
            expect(getBooleanValue(1, type, 'mysql')).toBeUndefined();
            expect(getBooleanValue(true, type, 'mysql')).toBeUndefined();
        },
    );

    it.each([2, -1, '', 'yes', 'BLOB:1:application/octet-stream:AA==', [1], {}])(
        'does not coerce unsupported value %s',
        (value) => {
            expect(getBooleanValue(value, 'boolean')).toBeUndefined();
        },
    );

    it('uses native Booleans without metadata, without inferring numeric columns', () => {
        expect(getBooleanValue(false)).toBe(false);
        expect(getBooleanValue(0)).toBeUndefined();
        expect(getBooleanValue('true')).toBeUndefined();
        expect(getBooleanValue(null)).toBeUndefined();
    });
});
