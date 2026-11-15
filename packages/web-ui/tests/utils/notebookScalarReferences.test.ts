import {describe, expect, it} from 'vitest';
import type {NotebookCell} from '@/types/notebook';
import {
    buildScalarSuggestions,
    extractScalarReferences,
    formatScalarResolutionText,
    parseScalarReference,
    resolveScalarReference,
} from '@/utils/notebookScalarReferences';

function makeSqlCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: 'sql-1',
        type: 'sql',
        content: 'SELECT 1 AS total',
        result: null,
        ...overrides,
    };
}

describe('notebookScalarReferences', () => {
    describe('parseScalarReference', () => {
        it('parses positional cell_N.column references', () => {
            expect(parseScalarReference('{{value:cell_3.total}}', 'cell_3.total')).toEqual({
                raw: '{{value:cell_3.total}}',
                target: 'cell_3',
                column: 'total',
            });
        });

        it('parses cell aliases and quoted columns or aliases', () => {
            expect(
                parseScalarReference('{{value:revenue_summary.total}}', 'revenue_summary.total'),
            ).toEqual({
                raw: '{{value:revenue_summary.total}}',
                target: 'revenue_summary',
                column: 'total',
            });

            expect(
                parseScalarReference(
                    '{{value:"Revenue Summary"."total revenue"}}',
                    '"Revenue Summary"."total revenue"',
                ),
            ).toEqual({
                raw: '{{value:"Revenue Summary"."total revenue"}}',
                target: 'Revenue Summary',
                column: 'total revenue',
            });
        });

        it('rejects invalid references', () => {
            expect(parseScalarReference('{{value:}}', '')).toBeNull();
            expect(parseScalarReference('{{value:cell_1}}', 'cell_1')).toBeNull();
            expect(parseScalarReference('{{value:cell_0.total}}', 'cell_0.total')).toBeNull();
            expect(parseScalarReference('{{value:cell_1.}}', 'cell_1.')).toBeNull();
            expect(parseScalarReference('{{value:.total}}', '.total')).toBeNull();
            expect(
                parseScalarReference('{{value:cell_1."unclosed}}', 'cell_1."unclosed'),
            ).toBeNull();
        });
    });

    describe('extractScalarReferences', () => {
        it('extracts multiple references from markdown text', () => {
            const matches = extractScalarReferences(
                'Revenue: {{value:cell_1.total}}, Orders: {{value:cell_2.count}}',
            );
            expect(matches).toHaveLength(2);
            expect(matches[0].inner).toBe('cell_1.total');
            expect(matches[1].inner).toBe('cell_2.count');
        });
    });

    describe('resolveScalarReference', () => {
        it('handles zero, false, exact decimal strings, Unicode, and Markdown/HTML payloads', () => {
            const cells: NotebookCell[] = [
                makeSqlCell({
                    result: {
                        columns: ['zero', 'negZero', 'flag', 'precise', 'unicode', 'payload'],
                        rows: [
                            [
                                0,
                                -0,
                                false,
                                '123456789012345678901234567890.000123456789',
                                'Café ☕ — €1,234.56 — 日本語',
                                '**bold** <script>alert(1)</script>',
                            ],
                        ],
                        affected_rows: 0,
                    },
                }),
            ];

            expect(
                resolveScalarReference('{{value:cell_1.zero}}', 'cell_1.zero', cells),
            ).toMatchObject({
                kind: 'value',
                text: '0',
                isStale: false,
            });
            expect(
                resolveScalarReference('{{value:cell_1.negZero}}', 'cell_1.negZero', cells),
            ).toMatchObject({kind: 'value', text: '0'});
            expect(
                resolveScalarReference('{{value:cell_1.flag}}', 'cell_1.flag', cells),
            ).toMatchObject({
                kind: 'value',
                text: 'false',
            });
            expect(
                resolveScalarReference('{{value:cell_1.precise}}', 'cell_1.precise', cells),
            ).toMatchObject({
                kind: 'value',
                text: '123456789012345678901234567890.000123456789',
            });
            expect(
                resolveScalarReference('{{value:cell_1.unicode}}', 'cell_1.unicode', cells),
            ).toMatchObject({
                kind: 'value',
                text: 'Café ☕ — €1,234.56 — 日本語',
            });
            expect(
                resolveScalarReference('{{value:cell_1.payload}}', 'cell_1.payload', cells),
            ).toMatchObject({
                kind: 'value',
                text: '**bold** <script>alert(1)</script>',
            });
        });

        it('distinguishes SQL NULL from missing values', () => {
            const cells: NotebookCell[] = [
                makeSqlCell({
                    result: {
                        columns: ['nullable_col'],
                        rows: [[null]],
                        affected_rows: 0,
                    },
                }),
            ];

            const nullRes = resolveScalarReference(
                '{{value:cell_1.nullable_col}}',
                'cell_1.nullable_col',
                cells,
            );
            expect(nullRes.kind).toBe('null');
            expect(formatScalarResolutionText(nullRes)).toBe('NULL');

            const missingRes = resolveScalarReference(
                '{{value:cell_1.other_col}}',
                'cell_1.other_col',
                cells,
            );
            expect(missingRes.kind).toBe('missingColumn');
            expect(formatScalarResolutionText(missingRes)).toBe(
                '[Cell 1: missing column "other_col"]',
            );
        });

        it('detects ambiguous column names (exact duplicates and case-insensitive collisions)', () => {
            const cells: NotebookCell[] = [
                makeSqlCell({
                    result: {
                        columns: ['id', 'id', 'Total', 'TOTAL'],
                        rows: [[1, 2, 10, 20]],
                        affected_rows: 0,
                    },
                }),
            ];

            const dup = resolveScalarReference('{{value:cell_1.id}}', 'cell_1.id', cells);
            expect(dup.kind).toBe('ambiguousColumn');
            expect(formatScalarResolutionText(dup)).toBe('[Cell 1: ambiguous column "id"]');

            const ciDup = resolveScalarReference('{{value:cell_1.total}}', 'cell_1.total', cells);
            expect(ciDup.kind).toBe('ambiguousColumn');

            const exact = resolveScalarReference('{{value:cell_1.Total}}', 'cell_1.Total', cells);
            expect(exact).toMatchObject({kind: 'value', text: '10'});
        });

        it('requires exactly one row and reports never-run, error, zero rows, multiple rows, and invalid targets', () => {
            const cells: NotebookCell[] = [
                makeSqlCell({result: null}),
                makeSqlCell({id: 'sql-2', error: 'syntax error', result: null}),
                makeSqlCell({
                    id: 'sql-3',
                    result: {columns: ['total'], rows: [], affected_rows: 0},
                }),
                makeSqlCell({
                    id: 'sql-4',
                    result: {columns: ['total'], rows: [[1], [2]], affected_rows: 0},
                }),
                {id: 'md-5', type: 'markdown', content: '# Notes'},
            ];

            expect(
                resolveScalarReference('{{value:cell_1.total}}', 'cell_1.total', cells).kind,
            ).toBe('notRun');
            expect(
                resolveScalarReference('{{value:cell_2.total}}', 'cell_2.total', cells).kind,
            ).toBe('error');
            expect(
                resolveScalarReference('{{value:cell_3.total}}', 'cell_3.total', cells).kind,
            ).toBe('noRows');
            expect(
                resolveScalarReference('{{value:cell_4.total}}', 'cell_4.total', cells),
            ).toMatchObject({kind: 'multipleRows', rowCount: 2});
            expect(
                resolveScalarReference('{{value:cell_5.total}}', 'cell_5.total', cells).kind,
            ).toBe('notSqlCell');
            expect(
                resolveScalarReference('{{value:cell_99.total}}', 'cell_99.total', cells).kind,
            ).toBe('missingCell');
            expect(resolveScalarReference('{{value:bad}}', 'bad', cells).kind).toBe('invalid');
        });

        it('resolves by unique cell alias and flags ambiguous cell aliases', () => {
            const cells: NotebookCell[] = [
                makeSqlCell({
                    name: 'revenue',
                    result: {columns: ['total'], rows: [[500]], affected_rows: 0},
                }),
                makeSqlCell({id: 'sql-2', name: 'dup'}),
                makeSqlCell({id: 'sql-3', name: 'dup'}),
            ];

            expect(
                resolveScalarReference('{{value:revenue.total}}', 'revenue.total', cells),
            ).toMatchObject({kind: 'value', text: '500'});
            expect(resolveScalarReference('{{value:dup.total}}', 'dup.total', cells).kind).toBe(
                'ambiguousCell',
            );
        });

        it('detects stale output when SQL content changed after last execution', () => {
            const cells: NotebookCell[] = [
                makeSqlCell({
                    content: 'SELECT 999 AS total',
                    result: {columns: ['total'], rows: [[42]], affected_rows: 0},
                    history: [
                        {
                            query: 'SELECT 42 AS total',
                            result: {columns: ['total'], rows: [[42]], affected_rows: 0},
                            executionTime: 5,
                            timestamp: 1000,
                        },
                    ],
                }),
            ];

            const res = resolveScalarReference('{{value:cell_1.total}}', 'cell_1.total', cells);
            expect(res).toMatchObject({kind: 'value', text: '42', isStale: true});
            expect(formatScalarResolutionText(res)).toBe('42 (outdated)');
        });
    });

    describe('buildScalarSuggestions', () => {
        it('builds positional and unique alias suggestions with scalar previews', () => {
            const cells: NotebookCell[] = [
                makeSqlCell({
                    name: 'Revenue Summary',
                    result: {
                        columns: ['total', 'total revenue'],
                        rows: [[42, 100]],
                        affected_rows: 0,
                    },
                }),
                {id: 'md-2', type: 'markdown', content: 'text'},
            ];

            const suggestions = buildScalarSuggestions(cells);
            expect(suggestions.map((s) => s.insertText)).toEqual([
                '{{value:cell_1.total}}',
                '{{value:"Revenue Summary".total}}',
                '{{value:cell_1."total revenue"}}',
                '{{value:"Revenue Summary"."total revenue"}}',
            ]);
            expect(suggestions[0].preview).toBe('42');
        });
    });
});
