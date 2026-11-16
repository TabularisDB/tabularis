import {describe, expect, it} from 'vitest';
import type {QueryResult} from '@/types/editor';
import {rowsToHtmlTable} from '@/utils/clipboard';
import {
    formatResultForExport,
    formatRowsForExport,
    getLoadedRowsExportLimit,
    hasUnloadedRows,
    resolveExportScope,
} from '@/utils/resultExport';

const result: QueryResult = {
    columns: ['id', 'name'],
    rows: [
        [1, 'John'],
        [2, null],
    ],
    affected_rows: 0,
};

describe('resultExport', () => {
    it('formats loaded result rows as CSV with headers', () => {
        expect(formatResultForExport(result, 'csv')).toBe('id,name\n1,John\n2,NULL\n');
    });

    it('writes NULL the same way the streaming exporter does', () => {
        // Mirrors value_to_csv_string in src-tauri/src/export/format.rs: only NULL
        // gets the sentinel, an empty string stays an empty field.
        const fixture: QueryResult = {
            columns: ['null_col', 'empty_col', 'literal_null', 'zero', 'flag'],
            rows: [[null, '', 'NULL', 0, false]],
            affected_rows: 0,
        };

        expect(formatResultForExport(fixture, 'csv')).toBe(
            'null_col,empty_col,literal_null,zero,flag\nNULL,,NULL,0,false\n',
        );
    });

    it('keeps quoting around NULL-adjacent fields that need it', () => {
        const tricky: QueryResult = {
            columns: ['a', 'b', 'c'],
            rows: [[null, 'has,comma', 'say "hi"\nthere']],
            affected_rows: 0,
        };

        expect(formatResultForExport(tricky, 'csv')).toBe(
            'a,b,c\nNULL,"has,comma","say ""hi""\nthere"\n',
        );
    });

    it('uses the configured CSV delimiter', () => {
        expect(formatResultForExport(result, 'csv', ';')).toBe('id;name\n1;John\n2;NULL\n');
    });

    it('escapes CSV fields that contain delimiters, quotes, or newlines', () => {
        const specialResult: QueryResult = {
            columns: ['id', 'note'],
            rows: [[1, 'hello, "world"\nagain']],
            affected_rows: 0,
        };

        expect(formatResultForExport(specialResult, 'csv')).toBe(
            'id,note\n1,"hello, ""world""\nagain"\n',
        );
    });

    it('quotes a CSV field with a lone carriage return, as the clipboard does', () => {
        const carriageResult: QueryResult = {
            columns: ['id', 'note'],
            rows: [[1, 'hello\rworld']],
            affected_rows: 0,
        };

        expect(formatResultForExport(carriageResult, 'csv')).toBe('id,note\n1,"hello\rworld"\n');
    });

    it('writes object and array values as JSON text, not [object Object]', () => {
        const withJson: QueryResult = {
            columns: ['id', 'doc', 'tags'],
            rows: [[1, {a: 1, b: [true, null]}, ['x', 'y']]],
            affected_rows: 0,
        };

        expect(formatResultForExport(withJson, 'csv')).toBe(
            'id,doc,tags\n1,"{""a"":1,""b"":[true,null]}","[""x"",""y""]"\n',
        );
    });

    it('treats undefined like NULL in CSV and JSON', () => {
        const sparse: QueryResult = {
            columns: ['a', 'b'],
            rows: [[undefined, 1]],
            affected_rows: 0,
        };

        expect(formatResultForExport(sparse, 'csv')).toBe('a,b\nNULL,1\n');
        expect(JSON.parse(formatResultForExport(sparse, 'json'))).toEqual([{a: null, b: 1}]);
    });

    it('writes only the header for an empty result', () => {
        expect(formatResultForExport({columns: ['a'], rows: [], affected_rows: 0}, 'csv')).toBe(
            'a\n',
        );
    });

    it('formats loaded result rows as pretty JSON', () => {
        expect(formatResultForExport(result, 'json')).toBe(
            JSON.stringify(
                [
                    {id: 1, name: 'John'},
                    {id: 2, name: null},
                ],
                null,
                2,
            ),
        );
    });

    it('formats loaded result rows as NDJSON with one JSON object per line and escaped newlines', () => {
        const ndjsonResult: QueryResult = {
            columns: ['id', 'active', 'note', 'meta', 'missing'],
            rows: [
                [1, true, 'first\nline\r\nsecond', {role: 'admin', tags: ['a', 'b']}, undefined],
                [2, false, null, {role: 'user', tags: []}, 'present'],
            ],
            affected_rows: 0,
        };

        const output = formatResultForExport(ndjsonResult, 'ndjson');
        // Every record ends with a newline, the last one included.
        expect(output.endsWith('}\n')).toBe(true);
        const lines = output.slice(0, -1).split('\n');

        expect(lines).toHaveLength(2);
        expect(lines.map((line) => JSON.parse(line))).toEqual([
            {
                id: 1,
                active: true,
                note: 'first\nline\r\nsecond',
                meta: {role: 'admin', tags: ['a', 'b']},
                missing: null,
            },
            {
                id: 2,
                active: false,
                note: null,
                meta: {role: 'user', tags: []},
                missing: 'present',
            },
        ]);
    });

    it('produces an empty file when exporting empty results as NDJSON', () => {
        const emptyResult: QueryResult = {
            columns: ['id', 'name'],
            rows: [],
            affected_rows: 0,
        };

        expect(formatResultForExport(emptyResult, 'ndjson')).toBe('');
    });

    it('formats loaded result rows as Markdown', () => {
        expect(formatResultForExport(result, 'markdown')).toBe(
            '| id | name |\n| --- | --- |\n| 1 | John |\n| 2 | null |',
        );
    });

    it('wraps loaded rows in a UTF-8 HTML document using the clipboard table', () => {
        const html = formatResultForExport(result, 'html');

        expect(html.startsWith('<!DOCTYPE html>\n')).toBe(true);
        expect(html).toContain('<meta charset="utf-8">');
        expect(html).toContain(rowsToHtmlTable(result.rows, result.columns));
        expect(html).toContain('<th>id</th><th>name</th>');
        expect(html).toContain('<td>1</td><td>John</td>');
        expect(html).toContain('<td>2</td><td>null</td>');
    });

    it('escapes HTML names and values, including script text, quotes and ampersands', () => {
        const specialResult: QueryResult = {
            columns: ['<tag>', 'note'],
            rows: [
                ['<script>alert(1)</script>', `"quotes" & 'ok'`],
                ['café 你好', null],
            ],
            affected_rows: 0,
        };

        const html = formatResultForExport(specialResult, 'html');

        expect(html).toContain('<th>&lt;tag&gt;</th>');
        expect(html).toContain('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>');
        expect(html).toContain('<td>&quot;quotes&quot; &amp; &#39;ok&#39;</td>');
        expect(html).toContain('<td>café 你好</td>');
        expect(html).toContain('<td>null</td>');
        expect(html).not.toMatch(/<script[\s>]/i);
        expect(html).toContain(rowsToHtmlTable(specialResult.rows, specialResult.columns));
    });

    it('keeps a header row when the loaded result has no data rows', () => {
        const emptyResult: QueryResult = {
            columns: ['id', 'name'],
            rows: [],
            affected_rows: 0,
        };

        const html = formatResultForExport(emptyResult, 'html');

        expect(html).toContain('<th>id</th><th>name</th>');
        expect(html).toContain('<tbody></tbody>');
        expect(html).not.toContain('<td>');
        expect(html).toContain(rowsToHtmlTable([], ['id', 'name']));
    });

    it('detects when only part of a paginated result is loaded for export', () => {
        expect(
            getLoadedRowsExportLimit({
                ...result,
                pagination: {
                    total_rows: 25,
                    page: 1,
                    page_size: 2,
                    has_more: true,
                },
            }),
        ).toEqual({loadedRows: 2, totalRows: 25});
    });

    it('does not warn when all paginated rows are loaded', () => {
        expect(
            getLoadedRowsExportLimit({
                ...result,
                pagination: {
                    total_rows: 2,
                    page: 1,
                    page_size: 2,
                    has_more: false,
                },
            }),
        ).toBeNull();
    });

    it('does not warn without pagination or when a single unknown-total page is complete', () => {
        expect(getLoadedRowsExportLimit(result)).toBeNull();
        expect(
            getLoadedRowsExportLimit({
                ...result,
                pagination: {total_rows: null, page: 1, page_size: 2, has_more: false},
            }),
        ).toBeNull();
    });

    it('warns when a non-paginated result was truncated by the driver limit', () => {
        expect(
            getLoadedRowsExportLimit({
                ...result,
                truncated: true,
            }),
        ).toEqual({loadedRows: 2, totalRows: null});
    });

    it('warns without a total when more pages exist', () => {
        expect(
            getLoadedRowsExportLimit({
                ...result,
                pagination: {total_rows: null, page: 1, page_size: 2, has_more: true},
            }),
        ).toEqual({loadedRows: 2, totalRows: null});
    });

    it('warns without a total when the loaded page is not the first', () => {
        expect(
            getLoadedRowsExportLimit({
                ...result,
                pagination: {total_rows: null, page: 3, page_size: 2, has_more: false},
            }),
        ).toEqual({loadedRows: 2, totalRows: null});
    });

    it('treats a non-finite total as unknown', () => {
        expect(
            getLoadedRowsExportLimit({
                ...result,
                pagination: {
                    total_rows: Number.POSITIVE_INFINITY,
                    page: 1,
                    page_size: 2,
                    has_more: true,
                },
            }),
        ).toEqual({loadedRows: 2, totalRows: null});
    });

    describe('hasUnloadedRows', () => {
        const page = (total_rows: number | null, has_more: boolean) => ({
            page: 1,
            page_size: 2,
            total_rows,
            has_more,
        });

        it('is false without pagination', () => {
            expect(hasUnloadedRows(result)).toBe(false);
        });

        it('is true when truncated is set without pagination', () => {
            expect(hasUnloadedRows({...result, truncated: true})).toBe(true);
        });

        it('is true when fewer rows are loaded than the known total', () => {
            expect(hasUnloadedRows({...result, pagination: page(10, true)})).toBe(true);
        });

        it('is false when every row of the known total is loaded', () => {
            expect(hasUnloadedRows({...result, pagination: page(2, false)})).toBe(false);
        });

        it('follows has_more and the page number when the total is unknown', () => {
            expect(hasUnloadedRows({...result, pagination: page(null, true)})).toBe(true);
            expect(hasUnloadedRows({...result, pagination: page(null, false)})).toBe(false);
            expect(hasUnloadedRows({...result, pagination: {...page(null, false), page: 2}})).toBe(
                true,
            );
        });
    });

    describe('resolveExportScope', () => {
        const partial: QueryResult = {
            ...result,
            pagination: {page: 1, page_size: 2, total_rows: 10, has_more: true},
        };
        const empty: QueryResult = {columns: ['id'], rows: [], affected_rows: 0};

        it('keeps the requested scope when rows are missing from the grid', () => {
            expect(resolveExportScope(partial, 'all', true)).toBe('all');
            expect(resolveExportScope(partial, 'loaded', true)).toBe('loaded');
        });

        it('writes the grid instead of re-running the query when it is complete', () => {
            expect(resolveExportScope(result, 'all', true)).toBe('loaded');
            expect(resolveExportScope(result, 'loaded', true)).toBe('loaded');
        });

        it('writes an empty, complete result from the grid to keep its header', () => {
            expect(resolveExportScope(empty, 'all', true)).toBe('loaded');
        });

        it('uses the grid for result sets that cannot be re-run alone', () => {
            expect(resolveExportScope(partial, 'all', false)).toBe('loaded');
            expect(resolveExportScope(result, 'all', false)).toBe('loaded');
        });
    });
});

describe('formatRowsForExport', () => {
    // The selected-row export (#1154) serialises arbitrary rows, so every format
    // has to live here and a full-result export has to go through the same code:
    // a selected row must be byte-identical to the same row in a full export.

    it('serialises arbitrary rows exactly like the full result export', () => {
        const columns = ['id', 'name'];
        const rows: unknown[][] = [
            [1, 'John'],
            [2, null],
        ];
        const fullResult: QueryResult = {...result, columns, rows};

        for (const format of ['csv', 'json', 'ndjson', 'markdown', 'html'] as const) {
            expect(formatRowsForExport(rows, columns, format)).toBe(
                formatResultForExport(fullResult, format),
            );
        }
    });

    it('writes the given rows as NDJSON, one object per line ending with a newline', () => {
        const output = formatRowsForExport(
            [
                [1, 'Chloe'],
                [2, null],
                [3, 'comma, quote " and newline\ninside'],
            ],
            ['id', 'name'],
            'ndjson',
        );

        expect(output.endsWith('\n')).toBe(true);
        const lines = output.slice(0, -1).split('\n');
        expect(lines).toHaveLength(3);
        expect(lines.map((line) => JSON.parse(line))).toEqual([
            {id: 1, name: 'Chloe'},
            {id: 2, name: null},
            {id: 3, name: 'comma, quote " and newline\ninside'},
        ]);
    });

    it('produces an empty file when the selected-row export has no rows', () => {
        expect(formatRowsForExport([], ['id', 'name'], 'ndjson')).toBe('');
    });
});
