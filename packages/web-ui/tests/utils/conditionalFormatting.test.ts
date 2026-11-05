import {describe, it, expect} from 'vitest';
import {
    MAX_FORMAT_RULES_PER_TABLE,
    compileFormatRules,
    createFormatRule,
    formatRow,
    getRowFormats,
    formatRulesScope,
    getFormatRowClass,
    getFormatTextClass,
    getTableFormatRules,
    isFormatRuleActive,
    sanitizeFormatRules,
    setTableFormatRules,
    unquoteRuleValue,
    type FormatRule,
} from '@/utils/conditionalFormatting';
import type {FilterOperator} from '@/utils/filterBar';

const columns = ['id', 'status', 'amount', 'deleted_at', 'note', 'active'];

let nextId = 0;
const rule = (
    partial: Partial<FormatRule> & {column: string; operator: FilterOperator},
): FormatRule => ({
    id: `r${nextId++}`,
    name: '',
    value: '',
    tone: 'danger',
    target: 'row',
    ...partial,
});

/** Whether a single rule matches one value of its column. */
const matches = (partial: Partial<FormatRule> & {operator: FilterOperator}, value: unknown) => {
    const compiled = compileFormatRules([rule({column: 'note', ...partial})], columns);
    const row = columns.map(() => null as unknown);
    row[columns.indexOf('note')] = value;
    return formatRow(compiled, row) !== null;
};

describe('conditionalFormatting', () => {
    describe('unquoteRuleValue', () => {
        it('removes one pair of matching quotes and unescapes doubled ones', () => {
            expect(unquoteRuleValue("'failed'")).toBe('failed');
            expect(unquoteRuleValue('"failed"')).toBe('failed');
            expect(unquoteRuleValue("'O''Hare'")).toBe("O'Hare");
            expect(unquoteRuleValue('  failed ')).toBe('failed');
        });

        it('keeps unmatched or lone quotes', () => {
            expect(unquoteRuleValue("O'Hare")).toBe("O'Hare");
            expect(unquoteRuleValue("'")).toBe("'");
            expect(unquoteRuleValue('\'a"')).toBe('\'a"');
            expect(unquoteRuleValue("''")).toBe('');
        });
    });

    describe('conditions', () => {
        it('= and != compare text exactly, with or without quotes', () => {
            expect(matches({operator: '=', value: 'failed'}, 'failed')).toBe(true);
            expect(matches({operator: '=', value: "'failed'"}, 'failed')).toBe(true);
            expect(matches({operator: '=', value: 'failed'}, 'Failed')).toBe(false);
            expect(matches({operator: '!=', value: 'failed'}, 'paid')).toBe(true);
            expect(matches({operator: '!=', value: 'failed'}, 'failed')).toBe(false);
        });

        it('compares numbers numerically, whether they arrive as numbers or strings', () => {
            expect(matches({operator: '<', value: '0'}, -5)).toBe(true);
            expect(matches({operator: '<', value: '0'}, '-0.01')).toBe(true);
            expect(matches({operator: '<', value: '0'}, 0)).toBe(false);
            expect(matches({operator: '>', value: '9'}, 10)).toBe(true);
            expect(matches({operator: '>', value: '9'}, '10')).toBe(true);
            expect(matches({operator: '>=', value: '10'}, 10)).toBe(true);
            expect(matches({operator: '<=', value: '1e3'}, 1000)).toBe(true);
            expect(matches({operator: '=', value: '1.50'}, 1.5)).toBe(true);
            expect(matches({operator: '=', value: '42'}, BigInt(42))).toBe(true);
        });

        it('compares ISO dates as text', () => {
            expect(matches({operator: '<', value: '2024-01-01'}, '2023-12-31')).toBe(true);
            expect(matches({operator: '>=', value: '2024-01-01'}, '2024-01-01 08:00:00')).toBe(
                true,
            );
            expect(
                matches(
                    {operator: 'BETWEEN', value: '2024-01-01', value2: '2024-12-31'},
                    '2024-06-15',
                ),
            ).toBe(true);
        });

        it('compares boolean cells with true / false words', () => {
            expect(matches({operator: '=', value: 'true'}, true)).toBe(true);
            expect(matches({operator: '=', value: '1'}, true)).toBe(true);
            expect(matches({operator: '=', value: 'false'}, false)).toBe(true);
            expect(matches({operator: '=', value: 'true'}, false)).toBe(false);
            expect(matches({operator: '!=', value: 'maybe'}, true)).toBe(false);
        });

        it('never matches NULL with value operators, like SQL', () => {
            for (const operator of [
                '=',
                '!=',
                '<',
                '>',
                'contains',
                'NOT LIKE',
                'NOT IN',
            ] as const) {
                expect(matches({operator, value: 'x'}, null)).toBe(false);
                expect(matches({operator, value: 'x'}, undefined)).toBe(false);
            }
            expect(matches({operator: 'BETWEEN', value: '1', value2: '2'}, null)).toBe(false);
        });

        it('IS NULL, IS NOT NULL, is empty and is not empty', () => {
            expect(matches({operator: 'IS NULL'}, null)).toBe(true);
            expect(matches({operator: 'IS NULL'}, '')).toBe(false);
            expect(matches({operator: 'IS NOT NULL'}, '2024-01-01')).toBe(true);
            expect(matches({operator: 'IS NOT NULL'}, null)).toBe(false);
            expect(matches({operator: 'IS NOT NULL'}, 0)).toBe(true);
            expect(matches({operator: 'is empty'}, '')).toBe(true);
            expect(matches({operator: 'is empty'}, null)).toBe(true);
            expect(matches({operator: 'is empty'}, ' ')).toBe(false);
            expect(matches({operator: 'is not empty'}, 'x')).toBe(true);
            expect(matches({operator: 'is not empty'}, '')).toBe(false);
        });

        it('contains, starts with and ends with ignore case and treat % and _ literally', () => {
            expect(matches({operator: 'contains', value: 'ERR'}, 'an error here')).toBe(true);
            expect(matches({operator: 'starts with', value: 'an'}, 'An error')).toBe(true);
            expect(matches({operator: 'ends with', value: 'here'}, 'an error HERE')).toBe(true);
            expect(matches({operator: 'contains', value: '50%'}, 'discount 50%')).toBe(true);
            expect(matches({operator: 'contains', value: '50%'}, 'discount 500')).toBe(false);
            expect(matches({operator: 'contains', value: 'é'}, 'Café')).toBe(true);
        });

        it('LIKE and NOT LIKE use % and _ wildcards and escape regex characters', () => {
            expect(matches({operator: 'LIKE', value: 'fail%'}, 'failed')).toBe(true);
            expect(matches({operator: 'LIKE', value: 'f_iled'}, 'FAILED')).toBe(true);
            expect(matches({operator: 'LIKE', value: 'fail'}, 'failed')).toBe(false);
            expect(matches({operator: 'LIKE', value: 'a.c'}, 'abc')).toBe(false);
            expect(matches({operator: 'LIKE', value: '(x)%'}, '(x) y')).toBe(true);
            expect(matches({operator: 'LIKE', value: '%'}, 'line1\nline2')).toBe(true);
            expect(matches({operator: 'NOT LIKE', value: 'fail%'}, 'paid')).toBe(true);
            expect(matches({operator: 'NOT LIKE', value: 'fail%'}, 'failed')).toBe(false);
        });

        it('LIKE treats a backslash as the escape character, like MySQL and PostgreSQL', () => {
            expect(matches({operator: 'LIKE', value: 'a\\_%'}, 'a_b')).toBe(true);
            expect(matches({operator: 'LIKE', value: 'a\\_%'}, 'axb')).toBe(false);
            expect(matches({operator: 'LIKE', value: '100\\%'}, '100%')).toBe(true);
            expect(matches({operator: 'LIKE', value: '100\\%'}, '1000')).toBe(false);
            expect(matches({operator: 'LIKE', value: 'C:\\\\%'}, 'C:\\temp')).toBe(true);
            expect(matches({operator: 'LIKE', value: 'end\\'}, 'end\\')).toBe(true);
            expect(matches({operator: 'NOT LIKE', value: 'a\\_%'}, 'axb')).toBe(true);
        });

        it('IN and NOT IN split on commas outside quotes', () => {
            expect(matches({operator: 'IN', value: 'failed, cancelled'}, 'cancelled')).toBe(true);
            expect(matches({operator: 'IN', value: "'Paris, TX', Rome"}, 'Paris, TX')).toBe(true);
            expect(matches({operator: 'IN', value: '1, 2, 3'}, 2)).toBe(true);
            expect(matches({operator: 'IN', value: 'a, b'}, 'c')).toBe(false);
            expect(matches({operator: 'NOT IN', value: 'a, b'}, 'c')).toBe(true);
            expect(matches({operator: 'NOT IN', value: 'a, b'}, 'a')).toBe(false);
        });

        it('BETWEEN is inclusive on both bounds', () => {
            expect(matches({operator: 'BETWEEN', value: '1', value2: '10'}, 1)).toBe(true);
            expect(matches({operator: 'BETWEEN', value: '1', value2: '10'}, 10)).toBe(true);
            expect(matches({operator: 'BETWEEN', value: '1', value2: '10'}, 11)).toBe(false);
            expect(matches({operator: 'BETWEEN', value: '1', value2: '10'}, '5')).toBe(true);
        });

        it('compares JSON values by their text', () => {
            expect(matches({operator: 'contains', value: '"vip"'}, {tags: ['vip']})).toBe(true);
        });

        it('extreme numbers', () => {
            expect(matches({operator: '>', value: '0'}, Number.MAX_VALUE)).toBe(true);
            expect(matches({operator: '<', value: '0'}, -Infinity)).toBe(true);
            expect(matches({operator: '=', value: 'NaN'}, NaN)).toBe(false);
            expect(matches({operator: '>', value: '0'}, NaN)).toBe(false);
            expect(matches({operator: '>', value: '9007199254740991'}, '9007199254740993')).toBe(
                true,
            );
        });
    });

    describe('isFormatRuleActive / compileFormatRules', () => {
        it('skips disabled and incomplete rules and rules on missing columns', () => {
            const rules = [
                rule({column: 'status', operator: '=', value: 'failed', enabled: false}),
                rule({column: 'status', operator: '=', value: '  '}),
                rule({column: 'status', operator: 'BETWEEN', value: '1'}),
                rule({column: 'gone', operator: 'IS NULL'}),
                rule({column: '', operator: 'IS NULL'}),
                rule({column: 'deleted_at', operator: 'IS NOT NULL'}),
            ];
            expect(rules.map(isFormatRuleActive)).toEqual([false, false, false, true, false, true]);
            expect(compileFormatRules(rules, columns).map((c) => c.rule.column)).toEqual([
                'deleted_at',
            ]);
        });
    });

    describe('formatRow', () => {
        const failed = rule({name: 'Failed', column: 'status', operator: '=', value: 'failed'});
        const negative = rule({
            name: 'Negative',
            column: 'amount',
            operator: '<',
            value: '0',
            target: 'cell',
        });
        const deleted = rule({
            name: 'Deleted',
            column: 'deleted_at',
            operator: 'IS NOT NULL',
            tone: 'muted',
        });

        it('paints the row with the first matching row rule', () => {
            const compiled = compileFormatRules([failed, deleted], columns);
            const format = formatRow(compiled, [1, 'failed', 5, '2024-01-01', null, true]);
            expect(format?.row).toEqual({tone: 'danger', name: 'Failed'});
            expect(format?.names).toEqual(['Failed']);
            const reversed = formatRow(compileFormatRules([deleted, failed], columns), [
                1,
                'failed',
                5,
                '2024-01-01',
                null,
                true,
            ]);
            expect(reversed?.row).toEqual({tone: 'muted', name: 'Deleted'});
        });

        it('paints only the cell of a cell rule', () => {
            const format = formatRow(compileFormatRules([negative], columns), [
                1,
                'paid',
                -3,
                null,
                null,
                true,
            ]);
            expect(format?.row).toBeNull();
            expect(format?.cells.get(columns.indexOf('amount'))).toEqual({
                tone: 'danger',
                name: 'Negative',
            });
            expect(format?.cells.get(columns.indexOf('status'))).toBeUndefined();
        });

        it('a cell rule after a matching row rule loses, one before it wins its cell', () => {
            const row = [1, 'failed', -3, null, null, true];
            const rowFirst = formatRow(compileFormatRules([failed, negative], columns), row);
            expect(rowFirst?.cells.size).toBe(0);
            expect(rowFirst?.names).toEqual(['Failed']);
            const cellFirst = formatRow(compileFormatRules([negative, failed], columns), row);
            expect(cellFirst?.row?.name).toBe('Failed');
            expect(cellFirst?.cells.get(columns.indexOf('amount'))?.name).toBe('Negative');
            expect(cellFirst?.names).toEqual(['Negative', 'Failed']);
        });

        it('keeps the first cell rule of a column', () => {
            const big = rule({
                name: 'Big',
                column: 'amount',
                operator: '<',
                value: '100',
                target: 'cell',
                tone: 'info',
            });
            const format = formatRow(compileFormatRules([negative, big], columns), [
                1,
                'x',
                -1,
                null,
                null,
                true,
            ]);
            expect(format?.cells.get(columns.indexOf('amount'))?.name).toBe('Negative');
        });

        it('falls back to the column name when a rule has no name', () => {
            const unnamed = rule({column: 'status', operator: '=', value: 'failed', name: '  '});
            const format = formatRow(compileFormatRules([unnamed], columns), [1, 'failed']);
            expect(format?.names).toEqual(['status']);
        });

        it('returns null when nothing matches', () => {
            expect(formatRow(compileFormatRules([failed], columns), [1, 'paid'])).toBeNull();
            expect(formatRow([], [1, 'failed'])).toBeNull();
        });
    });

    describe('getRowFormats', () => {
        it('keys formats by row index and leaves unmatched rows out', () => {
            const compiled = compileFormatRules(
                [rule({name: 'Failed', column: 'status', operator: '=', value: 'failed'})],
                columns,
            );
            const formats = getRowFormats(compiled, [
                [1, 'paid'],
                [2, 'failed'],
                [3, 'failed'],
            ]);
            expect([...formats.keys()]).toEqual([1, 2]);
            expect([...getRowFormats(compiled, [null, [2, 'failed']]).keys()]).toEqual([1]);
            expect(getRowFormats([], [[1, 'failed']]).size).toBe(0);
        });

        it('evaluates 10k rows with several rules in one pass', () => {
            const compiled = compileFormatRules(
                [
                    rule({column: 'status', operator: 'IN', value: 'failed, cancelled'}),
                    rule({column: 'amount', operator: '<', value: '0', target: 'cell'}),
                    rule({column: 'note', operator: 'contains', value: 'urgent', target: 'cell'}),
                    rule({column: 'deleted_at', operator: 'IS NOT NULL', tone: 'muted'}),
                ],
                columns,
            );
            const statuses = ['paid', 'failed', 'pending', 'cancelled'];
            const rows = Array.from({length: 10_000}, (_, i) => [
                i,
                statuses[i % 4],
                (i % 7) - 3,
                i % 5 === 0 ? '2024-01-01' : null,
                i % 11 === 0 ? 'URGENT call' : 'ok',
                i % 2 === 0,
            ]);
            const formats = getRowFormats(compiled, rows);
            expect(formats.get(1)?.row).not.toBeNull();
            expect(formats.get(0)?.row?.tone).toBe('muted');
            expect(formats.size).toBeGreaterThan(5000);
        });
    });

    describe('class helpers', () => {
        it('maps tones to theme token classes', () => {
            const format = {
                row: {tone: 'warning' as const, name: 'w'},
                cells: new Map([[2, {tone: 'success' as const, name: 's'}]]),
                names: ['w', 's'],
            };
            expect(getFormatRowClass(format)).toContain('bg-accent-warning/');
            expect(getFormatTextClass(format, 2)).toBe('text-accent-success');
            expect(getFormatTextClass(format, 1)).toBeNull();
            expect(getFormatRowClass(null)).toBeNull();
            expect(getFormatTextClass(undefined, 0)).toBeNull();
        });

        it('dims every cell of a muted row', () => {
            const format = {
                row: {tone: 'muted' as const, name: 'm'},
                cells: new Map(),
                names: ['m'],
            };
            expect(getFormatTextClass(format, 0)).toBe('text-muted');
            expect(getFormatTextClass(format, 5)).toBe('text-muted');
        });
    });

    describe('storage', () => {
        const scope = formatRulesScope('shop', 'public', 'orders');
        const failed = rule({name: 'Failed', column: 'status', operator: '=', value: 'failed'});

        it('tells databases, schemas and tables apart, including names with separators', () => {
            const scopes = [
                formatRulesScope('shop', 'public', 'orders'),
                formatRulesScope('shop', 'sales', 'orders'),
                formatRulesScope('crm', 'public', 'orders'),
                formatRulesScope(null, 'public', 'orders'),
                formatRulesScope('shop', null, 'orders'),
                formatRulesScope('shop', 'public', 'orders_archive'),
                formatRulesScope('a","b', 'c', 'd'),
                formatRulesScope('a', 'b","c', 'd'),
            ];
            expect(new Set(scopes).size).toBe(scopes.length);
            expect(formatRulesScope(undefined, undefined, 't')).toBe(
                formatRulesScope(null, null, 't'),
            );
        });

        it('sets and clears a table without touching the input or other tables', () => {
            const other = formatRulesScope('shop', 'public', 'customers');
            const start = setTableFormatRules({}, 'c1', other, [failed]);
            const next = setTableFormatRules(start, 'c1', scope, [failed]);
            expect(getTableFormatRules(next, 'c1', scope)).toEqual([failed]);
            expect(getTableFormatRules(next, 'c1', other)).toEqual([failed]);
            expect(getTableFormatRules(start, 'c1', scope)).toEqual([]);
            expect(getTableFormatRules(next, 'c2', scope)).toEqual([]);
            const cleared = setTableFormatRules(
                setTableFormatRules(next, 'c1', scope, []),
                'c1',
                other,
                [],
            );
            expect(cleared).toEqual({});
        });

        it('keeps at most the rule limit per table', () => {
            const many = Array.from({length: MAX_FORMAT_RULES_PER_TABLE + 5}, () =>
                rule({column: 'id', operator: 'IS NULL'}),
            );
            const stored = setTableFormatRules({}, 'c1', scope, many);
            expect(getTableFormatRules(stored, 'c1', scope)).toHaveLength(
                MAX_FORMAT_RULES_PER_TABLE,
            );
        });

        it('round-trips through JSON and sanitizes malformed values', () => {
            const stored = setTableFormatRules({}, 'c1', scope, [
                failed,
                {...failed, id: 'b', operator: 'BETWEEN', value: '1', value2: '2', enabled: false},
            ]);
            expect(sanitizeFormatRules(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
            expect(sanitizeFormatRules(null)).toEqual({});
            expect(sanitizeFormatRules([])).toEqual({});
            expect(sanitizeFormatRules('x')).toEqual({});
            expect(
                sanitizeFormatRules({
                    c1: {
                        [scope]: [
                            failed,
                            {...failed, tone: 'red'},
                            {...failed, operator: 'DROP'},
                            {...failed, target: 'column'},
                            {...failed, value: 5},
                            null,
                        ],
                        bad: 'x',
                        empty: [],
                    },
                    c2: 'x',
                }),
            ).toEqual({c1: {[scope]: [failed]}});
        });
    });

    describe('createFormatRule', () => {
        it('starts as an unnamed danger row rule on the column', () => {
            const created = createFormatRule('status', '=');
            expect(created).toMatchObject({
                name: '',
                column: 'status',
                operator: '=',
                value: '',
                tone: 'danger',
                target: 'row',
            });
            expect(createFormatRule('status', '=').id).not.toBe(created.id);
        });
    });
});
