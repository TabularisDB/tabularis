import {describe, it, expect} from 'vitest';
import {exportNotebookToHtml} from '@/utils/notebookHtmlExport';
import {serializeNotebook} from '@/utils/notebookFile';
import type {NotebookCell} from '@/types/notebook';

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: 'c1',
        type: 'sql',
        content: '',
        result: null,
        error: undefined,
        executionTime: null,
        isLoading: false,
        ...overrides,
    };
}

describe('notebookHtmlExport', () => {
    it('should produce valid HTML document', () => {
        const html = exportNotebookToHtml('Test', []);
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<title>Test</title>');
        expect(html).toContain('</html>');
    });

    it('should render markdown cells', () => {
        const cells = [makeCell({type: 'markdown', content: '# Hello World'})];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('<h1>Hello World</h1>');
        expect(html).toContain('class="markdown-cell"');
    });

    it('should render SQL cells with code', () => {
        const cells = [makeCell({type: 'sql', content: 'SELECT * FROM users'})];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('SELECT * FROM users');
        expect(html).toContain('class="sql-code"');
    });

    it('should render SQL cell results as table', () => {
        const cells = [
            makeCell({
                type: 'sql',
                content: 'SELECT 1',
                result: {
                    columns: ['id', 'name'],
                    rows: [
                        [1, 'Alice'],
                        [2, 'Bob'],
                    ],
                    affected_rows: 0,
                },
                executionTime: 42,
            }),
        ];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('<th>id</th>');
        expect(html).toContain('<th>name</th>');
        expect(html).toContain('<td>Alice</td>');
        expect(html).toContain('2 rows');
        expect(html).toContain('42ms');
    });

    it('should render SQL cell errors', () => {
        const cells = [
            makeCell({
                type: 'sql',
                content: 'BAD SQL',
                error: 'syntax error near BAD',
            }),
        ];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('syntax error near BAD');
        expect(html).toContain('class="cell-error"');
    });

    it('should escape HTML in content', () => {
        const cells = [makeCell({type: 'markdown', content: 'Use <script>alert(1)</script>'})];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('should handle null values in result table', () => {
        const cells = [
            makeCell({
                type: 'sql',
                content: 'SELECT 1',
                result: {
                    columns: ['val'],
                    rows: [[null]],
                    affected_rows: 0,
                },
            }),
        ];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('<em>NULL</em>');
    });

    it('should write JSON values as JSON instead of [object Object]', () => {
        const cells = [
            makeCell({
                type: 'sql',
                content: 'SELECT data, tags FROM t',
                result: {
                    columns: ['data', 'tags', 'missing'],
                    rows: [[{a: 1, b: '<x>'}, ['red', 'blue'], undefined]],
                    affected_rows: 0,
                },
            }),
        ];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).not.toContain('[object Object]');
        expect(html).toContain('<td>{&quot;a&quot;:1,&quot;b&quot;:&quot;&lt;x&gt;&quot;}</td>');
        expect(html).toContain('<td>[&quot;red&quot;,&quot;blue&quot;]</td>');
        expect(html).toContain('<td><em>NULL</em></td>');
    });

    it('should render cell schema/database in SQL cell header', () => {
        const cells = [
            makeCell({
                type: 'sql',
                content: 'SELECT 1',
                schema: 'production_db',
            }),
        ];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('production_db');
        expect(html).toContain('SQL Cell #1');
    });

    it('should not render schema when not set', () => {
        const cells = [makeCell({type: 'sql', content: 'SELECT 1'})];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).not.toContain('· <span');
    });

    it('should render bold and italic in markdown', () => {
        const cells = [
            makeCell({
                type: 'markdown',
                content: '**bold** and *italic*',
            }),
        ];
        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<em>italic</em>');
    });

    it('should interpolate scalar references safely in markdown cells without executing HTML or markdown', () => {
        const cells = [
            makeCell({
                id: 's1',
                type: 'sql',
                name: 'summary',
                content: 'SELECT 1',
                result: {
                    columns: ['total', 'zero', 'flag', 'null_col', 'payload'],
                    rows: [[42, 0, false, null, '**not bold** <script>alert(1)</script>']],
                    affected_rows: 0,
                },
            }),
            makeCell({
                id: 'm1',
                type: 'markdown',
                content:
                    'Total: {{value:cell_1.total}}, Alias: {{value:summary.zero}}, Flag: {{value:cell_1.flag}}, Null: {{value:cell_1.null_col}}, Payload: {{value:cell_1.payload}}, Code: `{{value:cell_1.total}}`',
            }),
        ];

        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('Total: 42');
        expect(html).toContain('Alias: 0');
        expect(html).toContain('Flag: false');
        expect(html).toContain('Null: <em class="scalar-null">NULL</em>');
        expect(html).toContain('Payload: **not bold** &lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<strong>not bold</strong>');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('<code>{{value:cell_1.total}}</code>');

        // Original markdown source is preserved in notebook files
        const serialized = serializeNotebook('Test', cells);
        expect(serialized.cells[1].content).toContain('{{value:cell_1.total}}');
    });

    it('should render explicit placeholders for missing/invalid/outdated scalar references', () => {
        const cells = [
            makeCell({
                id: 's1',
                type: 'sql',
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
            makeCell({
                id: 'm1',
                type: 'markdown',
                content:
                    'Stale: {{value:cell_1.total}} | Missing: {{value:cell_1.nope}} | Invalid: {{value:bad}}',
            }),
        ];

        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('42 <span class="scalar-outdated">(outdated)</span>');
        expect(html).toContain(
            '<span class="scalar-placeholder">[Cell 1: missing column &quot;nope&quot;]</span>',
        );
        expect(html).toContain(
            '<span class="scalar-placeholder">[invalid reference: {{value:bad}}]</span>',
        );
    });

    it('should keep scalar references literal inside tilde and backtick fenced code blocks while interpolating prose', () => {
        const cells = [
            makeCell({
                id: 's1',
                type: 'sql',
                content: 'SELECT 42 AS total',
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
            makeCell({
                id: 'm1',
                type: 'markdown',
                content: [
                    'Prose total: {{value:cell_1.total}}',
                    '',
                    '~~~markdown',
                    '{{value:cell_1.total}}',
                    '~~~',
                    '',
                    '```',
                    '{{value:cell_1.total}}',
                    '```',
                    '',
                    'After fence: {{value:cell_1.total}}',
                ].join('\n'),
            }),
        ];

        const html = exportNotebookToHtml('Test', cells);
        expect(html).toContain('Prose total: 42');
        expect(html).toContain('After fence: 42');
        // Two literal fenced occurrences remain untouched
        const literalMatches = html.match(/\{\{value:cell_1\.total\}\}/g) ?? [];
        expect(literalMatches).toHaveLength(2);
    });
});
