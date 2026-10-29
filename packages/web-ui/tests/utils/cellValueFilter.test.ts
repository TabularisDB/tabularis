import {describe, it, expect} from 'vitest';
import {
    buildCellValueFilterClause,
    combineFilterClauses,
    getCellValueFilterOperators,
} from '@/utils/cellValueFilter';
import {buildSingleFilterClause} from '@/utils/filterBar';

describe('cellValueFilter', () => {
    describe('buildCellValueFilterClause', () => {
        it('quotes string values and escapes embedded single quotes', () => {
            expect(buildCellValueFilterClause('name', '=', "O'Brien", 'postgres')).toBe(
                `"name" = 'O''Brien'`,
            );
        });

        it('emits numbers unquoted', () => {
            expect(buildCellValueFilterClause('id', '=', 42, 'postgres')).toBe('"id" = 42');
            expect(buildCellValueFilterClause('id', '=', 42, 'mysql')).toBe('`id` = 42');
        });

        it.each(['real', 'FLOAT4', ' real '])(
            'compares PostgreSQL %s cell values at column precision',
            (columnType) => {
                for (const operator of ['=', '<>'] as const) {
                    for (const value of [89.9, '89.9']) {
                        expect(
                            buildCellValueFilterClause(
                                'price',
                                operator,
                                value,
                                'postgres',
                                columnType,
                            ),
                        ).toBe(`"price" ${operator} CAST(89.9 AS real)`);
                    }
                }
            },
        );

        it('keeps other column types and dialects at their existing precision', () => {
            for (const operator of ['=', '<>'] as const) {
                expect(
                    buildCellValueFilterClause(
                        'price',
                        operator,
                        89.9,
                        'postgres',
                        'double precision',
                    ),
                ).toBe(`"price" ${operator} 89.9`);
                expect(buildCellValueFilterClause('price', operator, 89.9, 'mysql', 'real')).toBe(
                    `\`price\` ${operator} 89.9`,
                );
            }
        });

        it('keeps PostgreSQL real NULL predicates unchanged', () => {
            for (const operator of ['IS NULL', 'IS NOT NULL'] as const) {
                expect(
                    buildCellValueFilterClause('price', operator, null, 'postgres', 'real'),
                ).toBe(`"price" ${operator}`);
            }
        });

        it('emits bigint values unquoted', () => {
            expect(
                buildCellValueFilterClause('id', '=', BigInt('9007199254740993'), 'sqlite'),
            ).toBe('"id" = 9007199254740993');
        });

        it('keeps numeric-looking strings quoted in varchar columns', () => {
            expect(buildCellValueFilterClause('code', '=', '42', 'postgres', 'varchar(255)')).toBe(
                `"code" = '42'`,
            );
        });

        it('emits numeric-looking strings unquoted in numeric columns', () => {
            expect(buildCellValueFilterClause('age', '=', '42', 'postgres', 'integer')).toBe(
                '"age" = 42',
            );
            expect(
                buildCellValueFilterClause('price', '=', '19.99', 'mysql', 'DECIMAL(10,2)'),
            ).toBe('`price` = 19.99');
        });

        it('emits booleans as TRUE/FALSE', () => {
            expect(buildCellValueFilterClause('active', '=', true, 'postgres')).toBe(
                '"active" = TRUE',
            );
            expect(buildCellValueFilterClause('active', '=', false, 'postgres')).toBe(
                '"active" = FALSE',
            );
        });

        it('supports the <> operator', () => {
            expect(buildCellValueFilterClause('id', '<>', 7, 'postgres')).toBe('"id" <> 7');
            expect(buildCellValueFilterClause('name', '<>', "O'Brien", 'mysql')).toBe(
                "`name` <> 'O''Brien'",
            );
        });

        it('emits IS NULL / IS NOT NULL and ignores the value', () => {
            expect(buildCellValueFilterClause('deleted_at', 'IS NULL', 'DROP TABLE', 'mysql')).toBe(
                '`deleted_at` IS NULL',
            );
            expect(
                buildCellValueFilterClause('deleted_at', 'IS NOT NULL', 'DROP TABLE', 'postgres'),
            ).toBe('"deleted_at" IS NOT NULL');
        });

        it.each(['>', '>=', '<', '<='] as const)(
            'supports the %s operator on numeric and date/time values',
            (operator) => {
                expect(buildCellValueFilterClause('age', operator, 42, 'postgres', 'integer')).toBe(
                    `"age" ${operator} 42`,
                );
                expect(
                    buildCellValueFilterClause(
                        'price',
                        operator,
                        '19.99',
                        'mysql',
                        'decimal(10,2)',
                    ),
                ).toBe(`\`price\` ${operator} 19.99`);
                expect(
                    buildCellValueFilterClause(
                        'created_at',
                        operator,
                        '2024-01-31 10:00:00',
                        'sqlite',
                        'datetime',
                    ),
                ).toBe(`"created_at" ${operator} '2024-01-31 10:00:00'`);
            },
        );

        it('compares PostgreSQL real columns at column precision for ordering operators too', () => {
            expect(buildCellValueFilterClause('price', '>=', 89.9, 'postgres', 'real')).toBe(
                `"price" >= CAST(89.9 AS real)`,
            );
        });

        it('builds contains as LIKE with surrounding wildcards and an explicit ESCAPE', () => {
            expect(
                buildCellValueFilterClause('name', 'contains', 'Alice', 'postgres', 'text'),
            ).toBe(`"name" LIKE '%Alice%' ESCAPE '!'`);
            expect(
                buildCellValueFilterClause('name', 'contains', 'Alice', 'mysql', 'varchar(255)'),
            ).toBe("`name` LIKE '%Alice%' ESCAPE '!'");
            expect(buildCellValueFilterClause('name', 'contains', 'Alice', 'sqlite', 'TEXT')).toBe(
                `"name" LIKE '%Alice%' ESCAPE '!'`,
            );
        });

        it('escapes %, _ and the escape character so contains matches them literally', () => {
            for (const driver of ['postgres', 'mysql', 'sqlite']) {
                const clause = buildCellValueFilterClause(
                    'note',
                    'contains',
                    '50%_off!',
                    driver,
                    'text',
                );
                expect(clause).toMatch(/LIKE '%50!%!_off!!%' ESCAPE '!'$/);
            }
        });

        it('escapes single quotes in contains values', () => {
            expect(
                buildCellValueFilterClause('name', 'contains', "O'Brien", 'postgres', 'text'),
            ).toBe(`"name" LIKE '%O''Brien%' ESCAPE '!'`);
        });

        it('doubles backslashes in contains values only on MySQL-style dialects', () => {
            expect(buildCellValueFilterClause('path', 'contains', 'C:\\tmp', 'mysql', 'text')).toBe(
                "`path` LIKE '%C:\\\\tmp%' ESCAPE '!'",
            );
            expect(
                buildCellValueFilterClause('path', 'contains', 'C:\\tmp', 'postgres', 'text'),
            ).toBe(`"path" LIKE '%C:\\tmp%' ESCAPE '!'`);
            expect(
                buildCellValueFilterClause('path', 'contains', 'C:\\tmp', 'sqlite', 'text'),
            ).toBe(`"path" LIKE '%C:\\tmp%' ESCAPE '!'`);
        });

        it('builds not contains, starts with and ends with as literal LIKE clauses', () => {
            expect(
                buildCellValueFilterClause('email', 'not contains', '@test.', 'postgres', 'text'),
            ).toBe(`"email" NOT LIKE '%@test.%' ESCAPE '!'`);
            expect(
                buildCellValueFilterClause('sku', 'starts with', 'EU-1042', 'mysql', 'varchar(32)'),
            ).toBe("`sku` LIKE 'EU-1042%' ESCAPE '!'");
            expect(buildCellValueFilterClause('file', 'ends with', '.csv', 'sqlite', 'TEXT')).toBe(
                `"file" LIKE '%.csv' ESCAPE '!'`,
            );
        });

        it('escapes %, _, the escape character and quotes for the new LIKE operators', () => {
            expect(
                buildCellValueFilterClause('note', 'not contains', "50%_off!'", 'postgres', 'text'),
            ).toBe(`"note" NOT LIKE '%50!%!_off!!''%' ESCAPE '!'`);
            expect(
                buildCellValueFilterClause('note', 'starts with', '50%_', 'postgres', 'text'),
            ).toBe(`"note" LIKE '50!%!_%' ESCAPE '!'`);
            expect(buildCellValueFilterClause('note', 'ends with', '_x', 'postgres', 'text')).toBe(
                `"note" LIKE '%!_x' ESCAPE '!'`,
            );
            expect(
                buildCellValueFilterClause('path', 'starts with', 'C:\\tmp', 'mysql', 'text'),
            ).toBe("`path` LIKE 'C:\\\\tmp%' ESCAPE '!'");
        });

        it('matches the filter bar clause for the same operator and value', () => {
            for (const driver of ['postgres', 'mysql', 'sqlite']) {
                for (const operator of ['contains', 'starts with', 'ends with'] as const) {
                    expect(
                        buildCellValueFilterClause('sku', operator, 'EU-%', driver, 'text'),
                    ).toBe(
                        buildSingleFilterClause(
                            {id: '1', column: 'sku', operator, value: 'EU-%'},
                            driver,
                            'always',
                        ),
                    );
                }
            }
        });

        it('quotes the identifier per driver', () => {
            expect(buildCellValueFilterClause('my col', '=', 1, 'mysql')).toBe('`my col` = 1');
            expect(buildCellValueFilterClause('my col', '=', 1, 'postgres')).toBe('"my col" = 1');
            expect(buildCellValueFilterClause('my col', '=', 1, 'sqlite')).toBe('"my col" = 1');
        });
    });

    describe('combineFilterClauses', () => {
        const added = '"status" = \'active\'';

        it('returns the added clause when there is no existing one', () => {
            expect(combineFilterClauses(undefined, added)).toBe(added);
            expect(combineFilterClauses(null, added)).toBe(added);
            expect(combineFilterClauses('', added)).toBe(added);
        });

        it('treats whitespace-only existing clauses as empty', () => {
            expect(combineFilterClauses('   ', added)).toBe(added);
        });

        it('ANDs and parenthesises an existing clause', () => {
            expect(combineFilterClauses(`"a" = 1 OR "b" = 2`, added)).toBe(
                `("a" = 1 OR "b" = 2) AND ${added}`,
            );
        });

        it('trims the existing clause', () => {
            expect(combineFilterClauses('  "a" = 1  ', added)).toBe(`("a" = 1) AND ${added}`);
        });
    });

    describe('getCellValueFilterOperators', () => {
        it('offers the IS NULL / IS NOT NULL pair for null and undefined', () => {
            expect(getCellValueFilterOperators(null)).toEqual(['IS NULL', 'IS NOT NULL']);
            expect(getCellValueFilterOperators(undefined)).toEqual(['IS NULL', 'IS NOT NULL']);
        });

        it('offers = / <> for any non-null value, including empty string and zero', () => {
            expect(getCellValueFilterOperators('')).toEqual(['=', '<>']);
            expect(getCellValueFilterOperators(0)).toEqual(['=', '<>']);
            expect(getCellValueFilterOperators('abc')).toEqual(['=', '<>']);
            expect(getCellValueFilterOperators(false)).toEqual(['=', '<>']);
        });

        it('adds ordering operators for numeric columns', () => {
            for (const columnType of [
                'integer',
                'BIGINT',
                'decimal(10,2)',
                'double precision',
                'real',
            ]) {
                expect(getCellValueFilterOperators(5, {columnType})).toEqual([
                    '=',
                    '<>',
                    '>',
                    '>=',
                    '<',
                    '<=',
                ]);
            }
        });

        it('adds ordering operators for date and time columns, with or without precision', () => {
            for (const columnType of [
                'date',
                'datetime',
                'DATETIME(3)',
                'timestamp',
                'timestamp(6) with time zone',
                'timestamp without time zone',
                'time',
            ]) {
                expect(getCellValueFilterOperators('2024-01-31', {columnType})).toEqual([
                    '=',
                    '<>',
                    '>',
                    '>=',
                    '<',
                    '<=',
                ]);
            }
        });

        it('adds the literal LIKE operators for text columns', () => {
            for (const columnType of ['text', 'varchar(255)', 'character varying(50)', 'CHAR(3)']) {
                expect(getCellValueFilterOperators('abc', {columnType})).toEqual([
                    '=',
                    '<>',
                    'contains',
                    'not contains',
                    'starts with',
                    'ends with',
                ]);
            }
        });

        it('does not offer the LIKE operators for an empty string', () => {
            expect(getCellValueFilterOperators('', {columnType: 'text'})).toEqual(['=', '<>']);
        });

        it('keeps = / <> only for other or unknown column types', () => {
            for (const columnType of [
                'uuid',
                'boolean',
                "enum('a','b')",
                'point',
                'geometry',
                '',
            ]) {
                expect(getCellValueFilterOperators('x', {columnType})).toEqual(['=', '<>']);
            }
            expect(getCellValueFilterOperators('x')).toEqual(['=', '<>']);
        });

        it('keeps IS NULL / IS NOT NULL for NULL cells of any column type', () => {
            for (const columnType of ['integer', 'text', 'date']) {
                expect(getCellValueFilterOperators(null, {columnType})).toEqual([
                    'IS NULL',
                    'IS NOT NULL',
                ]);
            }
        });

        it('offers only IS NULL / IS NOT NULL for masked cells, whatever the value', () => {
            for (const value of ['alice@example.com', '', 0, null]) {
                expect(getCellValueFilterOperators(value, {masked: true})).toEqual([
                    'IS NULL',
                    'IS NOT NULL',
                ]);
            }
            for (const columnType of ['integer', 'text', 'date']) {
                expect(getCellValueFilterOperators('42', {masked: true, columnType})).toEqual([
                    'IS NULL',
                    'IS NOT NULL',
                ]);
            }
            expect(getCellValueFilterOperators('abc', {masked: false})).toEqual(['=', '<>']);
        });
    });
});
