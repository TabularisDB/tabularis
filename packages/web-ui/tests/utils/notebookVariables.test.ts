import {describe, it, expect} from 'vitest';
import {
    extractCellReferences,
    hasCellReferences,
    resolveQueryVariables,
    findUnresolvedDependencies,
    variableOptionsForDriver,
    describeUnresolvedReferences,
    supportsNamedResultReferences,
} from '@/utils/notebookVariables';
import {removeCellFromCells} from '@/utils/notebook';
import {reorderCells} from '@/utils/notebookDnd';
import type {NotebookCell} from '@/types/notebook';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {GOOGLESQL_CAPS} from '../../../../tests/fixtures/sql-syntax/googlesql';

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: overrides.id ?? 'cell-1',
        type: overrides.type ?? 'sql',
        content: overrides.content ?? '',
        result: null,
        error: undefined,
        executionTime: null,
        isLoading: false,
        ...overrides,
    };
}

describe('notebookVariables', () => {
    describe('extractCellReferences', () => {
        it('should extract single cell reference', () => {
            const refs = extractCellReferences('SELECT * FROM {{cell_1}}');
            expect(refs).toHaveLength(1);
            expect(refs[0]).toEqual({match: '{{cell_1}}', cellIndex: 0});
        });

        it('should extract multiple cell references', () => {
            const refs = extractCellReferences('SELECT * FROM {{cell_1}} JOIN {{cell_3}}');
            expect(refs).toHaveLength(2);
            expect(refs[0].cellIndex).toBe(0);
            expect(refs[1].cellIndex).toBe(2);
        });

        it('should return empty array for no references', () => {
            expect(extractCellReferences('SELECT 1')).toEqual([]);
        });

        it('should handle double-digit cell numbers', () => {
            const refs = extractCellReferences('SELECT * FROM {{cell_12}}');
            expect(refs[0].cellIndex).toBe(11);
        });
    });

    describe('hasCellReferences', () => {
        it('should return true when references exist', () => {
            expect(hasCellReferences('SELECT * FROM {{cell_1}}')).toBe(true);
        });

        it('should return false when no references', () => {
            expect(hasCellReferences('SELECT 1')).toBe(false);
        });

        it('should stay consistent across repeated and interleaved calls', () => {
            for (let i = 0; i < 3; i++) {
                expect(hasCellReferences('SELECT * FROM {{cell_1}}')).toBe(true);
                expect(hasCellReferences('SELECT * FROM {{cell_1}}')).toBe(true);
                expect(hasCellReferences('SELECT 1')).toBe(false);
                expect(hasCellReferences('SELECT * FROM {{cell_02}}')).toBe(true);
                expect(hasCellReferences('')).toBe(false);
                expect(hasCellReferences('SELECT * FROM {{cell_1}}')).toBe(true);
            }
        });
    });

    describe('resolveQueryVariables', () => {
        it('should return original SQL when no references', () => {
            const cells = [makeCell()];
            const result = resolveQueryVariables('SELECT 1', cells);
            expect(result.sql).toBe('SELECT 1');
            expect(result.unresolvedRefs).toEqual([]);
        });

        it('should resolve a reference to a cell with results', () => {
            const cells = [
                makeCell({
                    id: 'c1',
                    type: 'sql',
                    content: 'SELECT 1',
                    result: {columns: ['id', 'name'], rows: [[1, 'Alice']], affected_rows: 0},
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.sql).toContain('WITH cell_1 AS');
            expect(result.sql).toContain('SELECT * FROM cell_1');
            expect(result.unresolvedRefs).toEqual([]);
        });

        it('should mark unresolved refs when cell has no result', () => {
            const cells = [makeCell({id: 'c1', type: 'sql'})];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.unresolvedRefs).toHaveLength(1);
        });

        it('should mark unresolved refs when cell index is out of bounds', () => {
            const result = resolveQueryVariables('SELECT * FROM {{cell_5}}', []);
            expect(result.unresolvedRefs).toHaveLength(1);
        });

        it('should mark unresolved refs when target is a markdown cell', () => {
            const cells = [makeCell({type: 'markdown'})];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.unresolvedRefs).toHaveLength(1);
        });

        it('should mark unresolved refs when target has error', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    error: 'syntax error',
                    result: {columns: ['a'], rows: [[1]], affected_rows: 0},
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.unresolvedRefs).toHaveLength(1);
        });

        it('should handle multiple references', () => {
            const cells = [
                makeCell({
                    id: 'c1',
                    type: 'sql',
                    result: {columns: ['a'], rows: [[1]], affected_rows: 0},
                }),
                makeCell({
                    id: 'c2',
                    type: 'sql',
                    result: {columns: ['b'], rows: [[2]], affected_rows: 0},
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}} JOIN {{cell_2}}', cells);
            expect(result.sql).toContain('cell_1 AS');
            expect(result.sql).toContain('cell_2 AS');
            expect(result.unresolvedRefs).toEqual([]);
        });

        it.each([
            ['WITH x AS (SELECT * FROM {{cell_1}}) SELECT * FROM x', 'WITH '],
            [
                '-- totals\nwith recursive x AS (SELECT * FROM {{cell_1}}) SELECT * FROM x',
                '-- totals\nwith recursive ',
            ],
        ])('should add the cell CTE to a query that has its own WITH: %j', (sql, head) => {
            const cells = [
                makeCell({
                    result: {columns: ['id'], rows: [[1]], affected_rows: 0},
                }),
            ];
            const result = resolveQueryVariables(sql, cells);

            expect(result.sql).toBe(
                `${head}cell_1 AS (\n  SELECT 1 AS "id"\n),\n` +
                    'x AS (SELECT * FROM cell_1) SELECT * FROM x',
            );
        });

        it('should replace every identical reference with a single CTE', () => {
            const cells = [
                makeCell({
                    result: {columns: ['id'], rows: [[1]], affected_rows: 0},
                }),
            ];
            const result = resolveQueryVariables(
                'SELECT * FROM {{cell_1}} a JOIN {{cell_1}} b ON a.id = b.id ' +
                    'JOIN {{cell_1}} c ON b.id = c.id',
                cells,
            );

            expect(result.sql).toBe(
                'WITH cell_1 AS (\n  SELECT 1 AS "id"\n)\n' +
                    'SELECT * FROM cell_1 a JOIN cell_1 b ON a.id = b.id ' +
                    'JOIN cell_1 c ON b.id = c.id',
            );
            expect(result.unresolvedRefs).toEqual([]);
        });

        it.each([
            'SELECT * FROM {{cell_01}} a JOIN {{cell_2}} b ON a.id = b.id ' +
                'JOIN {{cell_1}} c ON b.id = c.id JOIN {{cell_002}} d ON c.id = d.id',
            'SELECT * FROM {{cell_1}} a JOIN {{cell_02}} b ON a.id = b.id ' +
                'JOIN {{cell_001}} c ON b.id = c.id JOIN {{cell_2}} d ON c.id = d.id',
        ])('should replace mixed leading-zero references with one CTE per cell: %s', (sql) => {
            const cells = [1, 2].map((id) =>
                makeCell({
                    id: `c${id}`,
                    result: {columns: ['id'], rows: [[id]], affected_rows: 0},
                }),
            );
            const result = resolveQueryVariables(sql, cells);

            expect(result.sql).toBe(
                'WITH cell_1 AS (\n  SELECT 1 AS "id"\n),\n' +
                    'cell_2 AS (\n  SELECT 2 AS "id"\n)\n' +
                    'SELECT * FROM cell_1 a JOIN cell_2 b ON a.id = b.id ' +
                    'JOIN cell_1 c ON b.id = c.id JOIN cell_2 d ON c.id = d.id',
            );
            expect(result.unresolvedRefs).toEqual([]);
        });

        it.each([
            {reason: 'missing result', cells: [makeCell()], why: 'noResult'},
            {reason: 'missing cell', cells: [], why: 'missing'},
            {reason: 'markdown cell', cells: [makeCell({type: 'markdown'})], why: 'notSql'},
            {
                reason: 'errored cell',
                why: 'noResult',
                cells: [
                    makeCell({
                        error: 'query failed',
                        result: {columns: ['id'], rows: [[1]], affected_rows: 0},
                    }),
                ],
            },
        ])('should preserve each unresolved occurrence for $reason', ({cells, why}) => {
            const sql =
                'SELECT * FROM {{cell_1}} UNION SELECT * FROM {{cell_01}} ' +
                'UNION SELECT * FROM {{cell_3}} UNION SELECT * FROM {{cell_1}}';
            const result = resolveQueryVariables(sql, cells);

            expect(result.sql).toBe(sql);
            expect(result.unresolvedRefs).toEqual([
                {match: '{{cell_1}}', cellIndex: 0, reason: why},
                {match: '{{cell_01}}', cellIndex: 0, reason: why},
                {match: '{{cell_3}}', cellIndex: 2, reason: 'missing'},
                {match: '{{cell_1}}', cellIndex: 0, reason: why},
            ]);
        });

        it('should replace resolved refs while preserving interleaved unresolved occurrences', () => {
            const cells = [
                makeCell({
                    result: {columns: ['id'], rows: [[1]], affected_rows: 0},
                }),
                makeCell({id: 'c2'}),
            ];
            const result = resolveQueryVariables(
                'SELECT * FROM {{cell_2}} UNION SELECT * FROM {{cell_01}} ' +
                    'UNION SELECT * FROM {{cell_02}} UNION SELECT * FROM {{cell_1}} ' +
                    'UNION SELECT * FROM {{cell_2}}',
                cells,
            );

            expect(result.sql).toBe(
                'WITH cell_1 AS (\n  SELECT 1 AS "id"\n)\n' +
                    'SELECT * FROM {{cell_2}} UNION SELECT * FROM cell_1 ' +
                    'UNION SELECT * FROM {{cell_02}} UNION SELECT * FROM cell_1 ' +
                    'UNION SELECT * FROM {{cell_2}}',
            );
            expect(result.unresolvedRefs).toEqual([
                {match: '{{cell_2}}', cellIndex: 1, reason: 'noResult'},
                {match: '{{cell_02}}', cellIndex: 1, reason: 'noResult'},
                {match: '{{cell_2}}', cellIndex: 1, reason: 'noResult'},
            ]);
        });

        it('should escape single quotes in string values', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['name'],
                        rows: [["O'Brien"]],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.sql).toContain("O''Brien");
        });

        it('should handle null values in result rows', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['a'],
                        rows: [[null]],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.sql).toContain('NULL AS');
        });

        it('should escape double quotes in column names', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['a" FROM x; DROP TABLE y; --'],
                        rows: [['v']],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.sql).toContain('AS "a"" FROM x; DROP TABLE y; --"');
            expect(result.sql).not.toContain('AS "a" FROM x');
        });

        it('should leave backslashes untouched by default', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['path'],
                        rows: [['C:\\temp\\']],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.sql).toContain("'C:\\temp\\'");
        });

        it('should double backslashes when escapeBackslashes is set', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['path'],
                        rows: [['C:\\temp\\']],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells, {
                escapeBackslashes: true,
            });
            expect(result.sql).toContain("'C:\\\\temp\\\\'");
        });

        it('should backslash-escape literals for a backslash-escape syntax', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['v'],
                        rows: [["it's C:\\temp\nnext"]],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables(
                'SELECT * FROM {{cell_1}}',
                cells,
                variableOptionsForDriver(GOOGLESQL_CAPS),
            );
            expect(result.sql).toContain("'it\\'s C:\\\\temp\\nnext' AS `v`");
            // The same result keeps its standard rendering for other drivers.
            const standard = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(standard.sql).toContain("'it''s C:\\temp\nnext' AS \"v\"");
        });

        it('should write booleans in the declared boolean_literals style', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {columns: ['on', 'off'], rows: [[true, false]], affected_rows: 0},
                }),
            ];
            const sql = (options?: Parameters<typeof resolveQueryVariables>[2]) =>
                resolveQueryVariables('SELECT * FROM {{cell_1}}', cells, options).sql;
            expect(sql(variableOptionsForDriver(GOOGLESQL_CAPS))).toContain(
                'SELECT TRUE AS `on`, FALSE AS `off`',
            );
            const numeric = {
                ...GOOGLESQL_CAPS,
                sql_syntax: {...GOOGLESQL_CAPS.sql_syntax, boolean_literals: 'numeric' as const},
            };
            expect(sql(variableOptionsForDriver(numeric))).toContain(
                'SELECT 1 AS `on`, 0 AS `off`',
            );
            // Without a declaration booleans stay quoted strings, as before.
            expect(sql()).toContain(`SELECT 'true' AS "on", 'false' AS "off"`);
            expect(sql(variableOptionsForDriver('postgres'))).toContain(
                `SELECT 'true' AS "on", 'false' AS "off"`,
            );
        });

        it('should escape a backslash-quote sequence safely for MySQL', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['v'],
                        rows: [["\\', (SELECT 1)) --"]],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells, {
                escapeBackslashes: true,
            });
            expect(result.sql).toContain("'\\\\'', (SELECT 1)) --'");
        });

        it('should emit non-finite numbers as string literals', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['n'],
                        rows: [[Number.POSITIVE_INFINITY]],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.sql).toContain("'Infinity'");
        });

        it('should keep repeated resolutions of one result identical', () => {
            const cells = [
                makeCell({
                    result: {columns: ['id'], rows: [[1], [2]], affected_rows: 0},
                }),
            ];
            const first = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            const second = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(second.sql).toBe(first.sql);
        });

        it('should re-serialize once a cell holds a new result', () => {
            const cell = makeCell({
                result: {columns: ['id'], rows: [[1]], affected_rows: 0},
            });
            const before = resolveQueryVariables('SELECT * FROM {{cell_1}}', [cell]);
            const after = resolveQueryVariables('SELECT * FROM {{cell_1}}', [
                {...cell, result: {columns: ['id'], rows: [[2]], affected_rows: 0}},
            ]);
            expect(before.sql).toContain('SELECT 1 AS "id"');
            expect(after.sql).toContain('SELECT 2 AS "id"');
        });

        it('should not reuse a resolution across escaping dialects', () => {
            const cells = [
                makeCell({
                    result: {columns: ['path'], rows: [['C:\\temp']], affected_rows: 0},
                }),
            ];
            const plain = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            const escaped = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells, {
                escapeBackslashes: true,
            });
            expect(plain.sql).toContain("'C:\\temp'");
            expect(escaped.sql).toContain("'C:\\\\temp'");
        });

        it('should handle empty result set', () => {
            const cells = [
                makeCell({
                    type: 'sql',
                    result: {
                        columns: ['a', 'b'],
                        rows: [],
                        affected_rows: 0,
                    },
                }),
            ];
            const result = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(result.sql).toContain('WHERE 1=0');
        });
    });

    describe('identifier quoting', () => {
        const cells = [
            makeCell({
                result: {columns: ['id', 'we"ird`col'], rows: [[1, 'a']], affected_rows: 0},
            }),
        ];
        const emptyCells = [makeCell({result: {columns: ['id'], rows: [], affected_rows: 0}})];

        it('should default to double quotes', () => {
            const {sql} = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            expect(sql).toContain(`SELECT 1 AS "id", 'a' AS "we""ird\`col"`);
        });

        it('should use the identifierQuote option and double it inside names', () => {
            const {sql} = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells, {
                identifierQuote: '`',
            });
            expect(sql).toContain("SELECT 1 AS `id`, 'a' AS `we\"ird``col`");
        });

        it('should quote empty-result columns with the identifierQuote option', () => {
            const {sql} = resolveQueryVariables('SELECT * FROM {{cell_1}}', emptyCells, {
                identifierQuote: '`',
            });
            expect(sql).toContain('SELECT NULL AS `id` WHERE 1=0');
        });

        it('should not reuse a resolution across identifier quotes', () => {
            const ansi = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
            const backtick = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells, {
                identifierQuote: '`',
            });
            expect(ansi.sql).toContain('AS "id"');
            expect(backtick.sql).toContain('AS `id`');
        });

        it('should close bracket-quoted names with ] and double ] inside them', () => {
            const bracketCells = [
                makeCell({
                    result: {
                        columns: ['id', 'a]b', 'c[d'],
                        rows: [[1, 'x', 'y']],
                        affected_rows: 0,
                    },
                }),
            ];
            const {sql} = resolveQueryVariables('SELECT * FROM {{cell_1}}', bracketCells, {
                identifierQuote: '[',
            });
            expect(sql).toContain("SELECT 1 AS [id], 'x' AS [a]]b], 'y' AS [c[d]");
            expect(sql).not.toContain('[id[');
        });

        it('should close bracket-quoted empty-result columns with ]', () => {
            const {sql} = resolveQueryVariables('SELECT * FROM {{cell_1}}', emptyCells, {
                identifierQuote: '[',
            });
            expect(sql).toContain('SELECT NULL AS [id] WHERE 1=0');
        });

        it('should bracket-quote aliases for a plugin declaring identifier_quote "["', () => {
            const caps = {identifier_quote: '[', sql_dialect: 'mssql'} as DriverCapabilities;
            const {sql} = resolveQueryVariables(
                'SELECT * FROM {{cell_1}}',
                cells,
                variableOptionsForDriver(caps),
            );
            expect(sql).toContain(`SELECT 1 AS [id], 'a' AS [we"ird\`col]`);
        });
    });

    describe('variableOptionsForDriver', () => {
        const caps = (overrides: Partial<DriverCapabilities>): DriverCapabilities =>
            ({identifier_quote: '"', ...overrides}) as DriverCapabilities;

        it('should read the identifier quote and dialect from capabilities', () => {
            expect(
                variableOptionsForDriver(caps({identifier_quote: '`', sql_dialect: 'mysql'})),
            ).toEqual({escapeBackslashes: true, identifierQuote: '`'});
            expect(
                variableOptionsForDriver(caps({identifier_quote: '"', sql_dialect: 'postgres'})),
            ).toEqual({escapeBackslashes: false, identifierQuote: '"'});
        });

        it('should read a declared backslash string_escape', () => {
            expect(variableOptionsForDriver(GOOGLESQL_CAPS)).toEqual({
                escapeBackslashes: true,
                identifierQuote: '`',
                backslashLiterals: true,
                booleanLiterals: 'keywords',
            });
        });

        it("should honour a plugin's backtick quote outside the MySQL dialect", () => {
            expect(
                variableOptionsForDriver(caps({identifier_quote: '`', sql_dialect: 'generic'})),
            ).toEqual({escapeBackslashes: false, identifierQuote: '`'});
        });

        it('should keep the driver-id escaping when capabilities name no dialect', () => {
            // A `mariadb` plugin without sql_dialect: main escaped by id, so the
            // capabilities must not make it weaker.
            expect(variableOptionsForDriver(caps({identifier_quote: '`'}), 'mariadb')).toEqual({
                escapeBackslashes: true,
                identifierQuote: '`',
            });
            expect(
                variableOptionsForDriver(
                    caps({identifier_quote: '`', sql_dialect: 'generic'}),
                    'mysql',
                ),
            ).toEqual({escapeBackslashes: true, identifierQuote: '`'});
            expect(variableOptionsForDriver(caps({}), 'informix')).toEqual({
                escapeBackslashes: false,
                identifierQuote: '"',
            });
        });

        it('should let a declared dialect decide over the driver id', () => {
            expect(variableOptionsForDriver(caps({sql_dialect: 'postgres'}), 'mariadb')).toEqual({
                escapeBackslashes: false,
                identifierQuote: '"',
            });
            expect(
                variableOptionsForDriver(
                    caps({sql_dialect: 'mysql', identifier_quote: '`'}),
                    'custom',
                ),
            ).toEqual({escapeBackslashes: true, identifierQuote: '`'});
        });

        it('should read the id from a plugin manifest', () => {
            const manifest = {
                id: 'mariadb',
                capabilities: caps({identifier_quote: '`'}),
            } as unknown as PluginManifest;
            expect(variableOptionsForDriver(manifest).escapeBackslashes).toBe(true);
        });

        it('should double backslashes in the CTE for a dialect-less mariadb plugin', () => {
            const cells = [
                makeCell({
                    id: 'c1',
                    result: {
                        columns: ['v'],
                        rows: [['a\\']],
                        affected_rows: 0,
                    } as NotebookCell['result'],
                }),
            ];
            const {sql} = resolveQueryVariables(
                'SELECT * FROM {{cell_1}}',
                cells,
                variableOptionsForDriver(caps({identifier_quote: '`'}), 'mariadb'),
            );
            expect(sql).toContain("'a\\\\' AS `v`");
        });

        it('should fall back to builtin rules for a bare driver id', () => {
            expect(variableOptionsForDriver('mysql')).toEqual({
                escapeBackslashes: true,
                identifierQuote: '`',
            });
            expect(variableOptionsForDriver('mariadb')).toEqual({
                escapeBackslashes: true,
                identifierQuote: '`',
            });
            expect(variableOptionsForDriver('postgres')).toEqual({
                escapeBackslashes: false,
                identifierQuote: '"',
            });
            expect(variableOptionsForDriver(null)).toEqual({
                escapeBackslashes: false,
                identifierQuote: '"',
            });
        });
    });

    describe('findUnresolvedDependencies', () => {
        it('returns empty array when no references', () => {
            const cells = [makeCell({content: 'SELECT 1'})];
            expect(findUnresolvedDependencies('SELECT 1', cells)).toEqual([]);
        });

        it('returns indices of cells without results', () => {
            const cells = [
                makeCell({id: 'c1', content: 'SELECT 1', result: null}),
                makeCell({id: 'c2', content: 'SELECT 2', result: null}),
            ];
            const result = findUnresolvedDependencies(
                'SELECT * FROM {{cell_1}} JOIN {{cell_2}}',
                cells,
            );
            expect(result).toEqual([0, 1]);
        });

        it('excludes cells that already have results', () => {
            const cells = [
                makeCell({
                    id: 'c1',
                    content: 'SELECT 1',
                    result: {columns: ['id'], rows: [[1]], affected_rows: 0},
                }),
                makeCell({id: 'c2', content: 'SELECT 2', result: null}),
            ];
            const result = findUnresolvedDependencies(
                'SELECT * FROM {{cell_1}} JOIN {{cell_2}}',
                cells,
            );
            expect(result).toEqual([1]);
        });

        it('excludes non-SQL cells', () => {
            const cells = [makeCell({id: 'c1', type: 'markdown', content: '# Title'})];
            const result = findUnresolvedDependencies('SELECT * FROM {{cell_1}}', cells);
            expect(result).toEqual([]);
        });

        it('includes cells with errors', () => {
            const cells = [
                makeCell({
                    id: 'c1',
                    content: 'SELECT bad',
                    result: {columns: [], rows: [], affected_rows: 0},
                    error: 'syntax error',
                }),
            ];
            const result = findUnresolvedDependencies('SELECT * FROM {{cell_1}}', cells);
            expect(result).toEqual([0]);
        });

        it('returns sorted indices', () => {
            const cells = [
                makeCell({id: 'c1', content: 'SELECT 1'}),
                makeCell({id: 'c2', content: 'SELECT 2'}),
                makeCell({id: 'c3', content: 'SELECT 3'}),
            ];
            const result = findUnresolvedDependencies(
                'SELECT * FROM {{cell_3}} JOIN {{cell_1}}',
                cells,
            );
            expect(result).toEqual([0, 2]);
        });

        it('deduplicates repeated references', () => {
            const cells = [makeCell({id: 'c1', content: 'SELECT 1'})];
            const result = findUnresolvedDependencies(
                'SELECT * FROM {{cell_1}} UNION SELECT * FROM {{cell_1}}',
                cells,
            );
            expect(result).toEqual([0]);
        });
    });
});

describe('notebookVariables with disabled cells', () => {
    const cached = {columns: ['id'], rows: [[1]], affected_rows: 0};

    it('never substitutes the cached output of a disabled cell', () => {
        const cells = [makeCell({id: 'a', content: 'SELECT 1', result: cached, isDisabled: true})];
        const resolved = resolveQueryVariables('SELECT * FROM {{cell_1}}', cells);
        expect(resolved.sql).toBe('SELECT * FROM {{cell_1}}');
        expect(resolved.unresolvedRefs).toEqual([
            {match: '{{cell_1}}', cellIndex: 0, reason: 'disabled'},
        ]);
    });

    it('does not schedule a disabled cell as a dependency to run', () => {
        const cells = [
            makeCell({id: 'a', content: 'SELECT 1', isDisabled: true}),
            makeCell({id: 'b', content: 'SELECT 2'}),
        ];
        expect(findUnresolvedDependencies('SELECT {{cell_1}}, {{cell_2}}', cells)).toEqual([1]);
    });
});

describe('notebookVariables named result aliases', () => {
    const salesResult = {columns: ['region', 'total'], rows: [['eu', 10]], affected_rows: 0};
    const ordersResult = {columns: ['id'], rows: [[7]], affected_rows: 0};

    function notebook(): NotebookCell[] {
        return [
            makeCell({id: 'orders', alias: 'orders', result: ordersResult}),
            makeCell({id: 'sales', alias: 'sales', result: salesResult}),
            makeCell({id: 'report', content: 'SELECT * FROM {{sales}}'}),
        ];
    }

    it('extracts named references, looked up by alias', () => {
        const cells = notebook();
        expect(extractCellReferences('SELECT * FROM {{sales}} JOIN {{cell_1}}', cells)).toEqual([
            {match: '{{sales}}', cellIndex: 1, alias: 'sales'},
            {match: '{{cell_1}}', cellIndex: 0},
        ]);
        expect(extractCellReferences('SELECT * FROM {{nope}}', cells)).toEqual([
            {match: '{{nope}}', cellIndex: -1, alias: 'nope'},
        ]);
        // Without cells a named reference cannot be placed.
        expect(extractCellReferences('{{sales}}')[0].cellIndex).toBe(-1);
        expect(hasCellReferences('SELECT * FROM {{sales}}')).toBe(true);
    });

    it('does not treat other braces as references', () => {
        for (const sql of ["SELECT '{{}}'", "SELECT '{{1x}}'", 'SELECT {{ sales }}', '{sales}']) {
            expect(hasCellReferences(sql)).toBe(false);
        }
    });

    it('resolves a named reference to a quoted CTE of that cell', () => {
        const {sql, unresolvedRefs} = resolveQueryVariables('SELECT * FROM {{sales}}', notebook());
        expect(unresolvedRefs).toEqual([]);
        expect(sql).toBe(
            'WITH "sales" AS (\n  SELECT \'eu\' AS "region", 10 AS "total"\n)\nSELECT * FROM "sales"',
        );
    });

    it('follows the cell when it is moved: same alias, same result', () => {
        const cells = notebook();
        const before = resolveQueryVariables('SELECT * FROM {{sales}}', cells).sql;
        // Move the source to the end, then to the top.
        const moved = reorderCells(cells, 1, 2);
        expect(moved[2].id).toBe('sales');
        expect(resolveQueryVariables('SELECT * FROM {{sales}}', moved).sql).toBe(before);
        const top = reorderCells(cells, 1, 0);
        expect(resolveQueryVariables('SELECT * FROM {{sales}}', top).sql).toBe(before);
        // A positional reference still follows the position, as before: after the
        // move, cell 2 is another cell.
        expect(resolveQueryVariables('SELECT * FROM {{cell_2}}', top).sql).toContain('7 AS "id"');
        expect(
            resolveQueryVariables('SELECT * FROM {{cell_2}}', moved).unresolvedRefs[0].reason,
        ).toBe('noResult');
    });

    it('reports a deleted source as missing instead of using another cell', () => {
        const cells = removeCellFromCells(notebook(), 'sales');
        const {sql, unresolvedRefs} = resolveQueryVariables('SELECT * FROM {{sales}}', cells);
        expect(sql).toBe('SELECT * FROM {{sales}}');
        expect(unresolvedRefs).toEqual([
            {match: '{{sales}}', cellIndex: -1, alias: 'sales', reason: 'missing'},
        ]);
    });

    it('reports an alias two cells share as a duplicate', () => {
        const cells = [...notebook(), makeCell({id: 'copy', alias: 'sales', result: ordersResult})];
        const {unresolvedRefs} = resolveQueryVariables('SELECT * FROM {{sales}}', cells);
        expect(unresolvedRefs.map((r) => r.reason)).toEqual(['duplicate']);
        expect(findUnresolvedDependencies('SELECT * FROM {{sales}}', cells)).toEqual([]);
    });

    it('reports Markdown, disabled and not yet run targets with their reason', () => {
        const cells = [
            makeCell({id: 'md', type: 'markdown', alias: 'notes', content: '# x'}),
            makeCell({id: 'off', alias: 'off', result: salesResult, isDisabled: true}),
            makeCell({id: 'fresh', alias: 'fresh', content: 'SELECT 1'}),
            makeCell({id: 'broken', alias: 'broken', result: salesResult, error: 'boom'}),
        ];
        const {unresolvedRefs} = resolveQueryVariables(
            'SELECT * FROM {{notes}}, {{off}}, {{fresh}}, {{broken}}, {{cell_1}}, {{cell_9}}',
            cells,
        );
        expect(unresolvedRefs.map((r) => [r.match, r.reason])).toEqual([
            ['{{notes}}', 'notSql'],
            ['{{off}}', 'disabled'],
            ['{{fresh}}', 'noResult'],
            ['{{broken}}', 'noResult'],
            ['{{cell_1}}', 'notSql'],
            ['{{cell_9}}', 'missing'],
        ]);
    });

    it('runs a named dependency that has no result yet, but never a disabled one', () => {
        const cells = [
            makeCell({id: 'a', alias: 'fresh', content: 'SELECT 1'}),
            makeCell({id: 'b', alias: 'off', content: 'SELECT 2', isDisabled: true}),
        ];
        expect(findUnresolvedDependencies('SELECT * FROM {{fresh}} JOIN {{off}}', cells)).toEqual([
            0,
        ]);
    });

    it('uses a plugin capabilities object for quoting the CTE and its columns', () => {
        const caps = {
            identifier_quote: '`',
            sql_dialect: 'mysql',
        } as unknown as DriverCapabilities;
        const {sql} = resolveQueryVariables(
            'SELECT * FROM {{sales}}',
            notebook(),
            variableOptionsForDriver(caps, 'my-plugin'),
        );
        expect(sql).toBe(
            "WITH `sales` AS (\n  SELECT 'eu' AS `region`, 10 AS `total`\n)\nSELECT * FROM `sales`",
        );

        const brackets = {
            identifier_quote: '[',
            sql_dialect: 'mssql',
        } as unknown as DriverCapabilities;
        const bracketSql = resolveQueryVariables(
            'SELECT * FROM {{sales}} JOIN {{cell_1}} ON 1=1',
            notebook(),
            variableOptionsForDriver(brackets, 'mssql-plugin'),
        ).sql;
        expect(bracketSql).toContain('[sales] AS (');
        expect(bracketSql).toContain('AS [region]');
        expect(bracketSql).toContain('cell_1 AS (');
        expect(bracketSql).toContain('FROM [sales] JOIN cell_1 ON 1=1');
    });

    it('quotes an alias that is also a keyword', () => {
        const cells = [makeCell({id: 'k', alias: 'select', result: ordersResult})];
        const {sql} = resolveQueryVariables('SELECT * FROM {{select}}', cells);
        expect(sql).toBe('WITH "select" AS (\n  SELECT 7 AS "id"\n)\nSELECT * FROM "select"');
    });

    it('explains instead of sending SQL when the driver declares no SQL dialect', () => {
        const caps = {identifier_quote: '"'} as unknown as DriverCapabilities;
        expect(supportsNamedResultReferences(caps)).toBe(false);
        const {sql, unresolvedRefs} = resolveQueryVariables('db.find({{sales}})', notebook(), {
            ...variableOptionsForDriver(caps, 'mongo-plugin'),
            namedReferencesUnsupported: true,
        });
        expect(sql).toBe('db.find({{sales}})');
        expect(unresolvedRefs.map((r) => r.reason)).toEqual(['unsupported']);

        // Declared dialects, a manifest and built-in ids all speak SQL.
        const extendsOnly = {
            identifier_quote: '"',
            sql_syntax: {extends: 'postgres'},
        } as unknown as DriverCapabilities;
        expect(supportsNamedResultReferences(extendsOnly)).toBe(true);
        const manifest = {
            id: 'pg',
            capabilities: {identifier_quote: '"', sql_dialect: 'postgres'},
        } as unknown as PluginManifest;
        expect(supportsNamedResultReferences(manifest)).toBe(true);
        const bareManifest = {
            id: 'mongo',
            capabilities: {identifier_quote: '"'},
        } as unknown as PluginManifest;
        expect(supportsNamedResultReferences(bareManifest)).toBe(false);
        const badDialect = {
            identifier_quote: '"',
            sql_dialect: 'mongodb',
        } as unknown as DriverCapabilities;
        expect(supportsNamedResultReferences(badDialect)).toBe(false);
        expect(supportsNamedResultReferences('mysql')).toBe(true);
        expect(supportsNamedResultReferences(null)).toBe(true);
    });

    it('keeps {{cell_N}} working on such drivers, as before', () => {
        const caps = {identifier_quote: '"'} as unknown as DriverCapabilities;
        const {sql, unresolvedRefs} = resolveQueryVariables(
            'SELECT * FROM {{cell_1}}',
            notebook(),
            {
                ...variableOptionsForDriver(caps, 'mongo-plugin'),
                namedReferencesUnsupported: true,
            },
        );
        expect(unresolvedRefs).toEqual([]);
        expect(sql).toContain('cell_1 AS (');
    });

    it('adds one CTE per name when a cell is referenced by alias and position', () => {
        const {sql} = resolveQueryVariables(
            'SELECT * FROM {{sales}} a JOIN {{sales}} b JOIN {{cell_2}} c',
            notebook(),
        );
        expect(sql.match(/"sales" AS \(/g)).toHaveLength(1);
        expect(sql.match(/cell_2 AS \(/g)).toHaveLength(1);
        expect(sql).toContain('FROM "sales" a JOIN "sales" b JOIN cell_2 c');
    });

    it('merges named CTEs into a query that has its own WITH clause', () => {
        const {sql} = resolveQueryVariables(
            'WITH x AS (SELECT 1) SELECT * FROM x, {{sales}}',
            notebook(),
        );
        expect(sql.startsWith('WITH "sales" AS (')).toBe(true);
        expect(sql).toContain('),\nx AS (SELECT 1) SELECT * FROM x, "sales"');
    });

    describe('describeUnresolvedReferences', () => {
        const t = (key: string, options?: Record<string, unknown>) =>
            `${key.split('.').pop()}(${Object.values(options ?? {}).join('|')})`;

        it('names each reference with its reason, once', () => {
            expect(
                describeUnresolvedReferences(
                    [
                        {match: '{{sales}}', cellIndex: -1, alias: 'sales', reason: 'missing'},
                        {match: '{{sales}}', cellIndex: -1, alias: 'sales', reason: 'missing'},
                        {match: '{{cell_3}}', cellIndex: 2, reason: 'noResult'},
                    ],
                    t,
                ),
            ).toBe('unresolved(missing({{sales}}) noResult({{cell_3}}))');
        });
    });
});
