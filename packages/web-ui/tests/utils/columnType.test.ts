import {describe, expect, it} from 'vitest';
import {formatColumnType, resolveTypeModifiers} from '@/utils/columnType';

describe('formatColumnType', () => {
    it('shows the full type when the driver reports one', () => {
        expect(formatColumnType({data_type: 'varchar', full_type: 'varchar(255)'})).toBe(
            'varchar(255)',
        );
        expect(formatColumnType({data_type: 'decimal', full_type: 'decimal(10,2)'})).toBe(
            'decimal(10,2)',
        );
        expect(formatColumnType({data_type: 'tinyint', full_type: 'tinyint(1)'})).toBe(
            'tinyint(1)',
        );
        expect(formatColumnType({data_type: 'int', full_type: 'int unsigned'})).toBe(
            'int unsigned',
        );
        expect(formatColumnType({data_type: 'ARRAY', full_type: 'integer[]'})).toBe('integer[]');
    });

    it('prefers the full type over the separate length and precision fields', () => {
        expect(
            formatColumnType({
                data_type: 'character varying',
                full_type: 'character varying(255)',
                character_maximum_length: 255,
            }),
        ).toBe('character varying(255)');
        expect(
            formatColumnType({
                data_type: 'decimal',
                full_type: 'decimal(10,2) unsigned',
                numeric_precision: 10,
                numeric_scale: 2,
            }),
        ).toBe('decimal(10,2) unsigned');
    });

    it('falls back to data_type with the reported modifiers when there is no full type', () => {
        // A plugin driver that only sends the separate fields.
        expect(
            formatColumnType({data_type: 'VARCHAR', character_maximum_length: 50, full_type: null}),
        ).toBe('VARCHAR(50)');
        expect(
            formatColumnType({data_type: 'numeric', numeric_precision: 18, numeric_scale: 4}),
        ).toBe('numeric(18,4)');
    });

    it('falls back to data_type as is when nothing else is known', () => {
        expect(formatColumnType({data_type: 'text'})).toBe('text');
        expect(formatColumnType({data_type: 'int', full_type: '   '})).toBe('int');
        // SQLite already reports the declared type in data_type.
        expect(formatColumnType({data_type: 'VARCHAR(255)', character_maximum_length: 255})).toBe(
            'VARCHAR(255)',
        );
        // Enum values stay visible.
        expect(formatColumnType({data_type: "enum('free','pro')"})).toBe("enum('free','pro')");
    });
});

describe('resolveTypeModifiers', () => {
    it('ignores full_type: DDL generation keeps building from data_type', () => {
        expect(
            resolveTypeModifiers({
                data_type: 'varchar',
                full_type: 'varchar(255)',
                character_maximum_length: 255,
            }),
        ).toBe('varchar(255)');
        expect(resolveTypeModifiers({data_type: 'int', full_type: 'int unsigned'})).toBe('int');
    });

    it('does not size types that already carry a modifier or have none', () => {
        expect(
            resolveTypeModifiers({
                data_type: 'numeric(10,2)',
                numeric_precision: 10,
                numeric_scale: 2,
            }),
        ).toBe('numeric(10,2)');
        expect(resolveTypeModifiers({data_type: 'integer', numeric_precision: 32})).toBe('integer');
        expect(resolveTypeModifiers({data_type: 'decimal', numeric_precision: 38})).toBe(
            'decimal(38,0)',
        );
    });
});
