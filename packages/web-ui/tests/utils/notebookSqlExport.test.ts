import {describe, expect, it} from 'vitest';
import type {NotebookCell} from '@/types/notebook';
import {formatNotebookAsSql} from '@/utils/notebookSqlExport';

function sql(id: string, content: string, partial: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'sql', content, ...partial};
}

function markdown(id: string, content: string): NotebookCell {
    return {id, type: 'markdown', content};
}

describe('notebookSqlExport', () => {
    describe('formatNotebookAsSql', () => {
        it('writes SQL cells in notebook order and leaves Markdown out', () => {
            const out = formatNotebookAsSql('Revenue', [
                sql('a', 'SELECT 1', {name: 'First'}),
                markdown('m', '# Not SQL\nSELECT 99'),
                sql('b', 'SELECT 2'),
            ]);

            expect(out).not.toBeNull();
            expect(out).toContain('-- Tabularis notebook: Revenue');
            expect(out).toContain('-- Cell 1: First\nSELECT 1\n');
            expect(out).toContain('-- Cell 3\nSELECT 2\n');
            expect(out!.indexOf('SELECT 1')).toBeLessThan(out!.indexOf('SELECT 2'));
            expect(out).not.toContain('Not SQL');
            expect(out).not.toContain('SELECT 99');
        });

        it('keeps each source verbatim, with no delimiter appended', () => {
            const source = "SELECT 'ünïcödé 😀', '  spaced  '  \n  FROM t -- no semicolon  ";
            const out = formatNotebookAsSql('T', [sql('a', source), sql('b', 'SELECT 2;\n')]);

            expect(out).toContain(`-- Cell 1\n${source}\n\n-- Cell 2\nSELECT 2;\n`);
            // Only the source's own semicolon appears: none is added anywhere.
            expect(out!.match(/;/g)).toHaveLength(1);
        });

        it('leaves parameters and cell references as written and keeps values out', () => {
            const out = formatNotebookAsSql('T', [
                sql('a', 'SELECT * FROM @source WHERE id >= ${minimum} AND x IN {{cell_1}}'),
            ]);

            expect(out).toContain(
                'SELECT * FROM @source WHERE id >= ${minimum} AND x IN {{cell_1}}',
            );
            expect(out).toContain('Not a runnable script');
            expect(out).toContain('parameters (@name, ${name}) and cell references ({{name}})');
            expect(out).toContain('connection and database context');
        });

        it('names the per-cell database without expanding it', () => {
            const out = formatNotebookAsSql('T', [
                sql('a', 'SELECT 1', {schema: 'analytics'}),
                sql('b', 'SELECT 2'),
            ]);

            expect(out).toContain('-- Cell 1\n-- Database: analytics\nSELECT 1\n');
            expect(out).toContain('-- Cell 2\nSELECT 2\n');
        });

        it('exports nothing but source: no results, charts or errors', () => {
            const out = formatNotebookAsSql('T', [
                sql('a', 'SELECT 1', {
                    result: {columns: ['secret'], rows: [['hunter2']], affected_rows: 0},
                    error: 'boom',
                    chartConfig: {type: 'bar', labelColumn: 'secret', valueColumns: ['secret']},
                    history: [
                        {query: 'SELECT hidden', result: null, executionTime: 1, timestamp: 1},
                    ],
                }),
            ]);

            expect(out).not.toContain('hunter2');
            expect(out).not.toContain('secret');
            expect(out).not.toContain('boom');
            expect(out).not.toContain('hidden');
        });

        it('keeps cell names and the title on one comment line', () => {
            const out = formatNotebookAsSql('Title\nDROP TABLE t', [
                sql('a', 'SELECT 1', {name: 'Name\r\nDELETE FROM t; */ \u2028SELECT 2'}),
                sql('b', 'SELECT 3', {schema: 'db\nDROP TABLE x'}),
            ]);

            // Every header line still starts with the comment marker.
            const headers = out!.split('\n').filter((line) => /DROP|DELETE|\*\//.test(line));
            expect(headers.length).toBeGreaterThan(0);
            for (const line of headers) expect(line.startsWith('-- ')).toBe(true);
            expect(out).toContain('-- Cell 1: Name DELETE FROM t; */ SELECT 2\nSELECT 1\n');
            expect(out).toContain('-- Database: db DROP TABLE x\nSELECT 3\n');
            expect(out).toContain('-- Tabularis notebook: Title DROP TABLE t\n');
        });

        it('skips blank SQL cells and reports an empty notebook as null', () => {
            expect(formatNotebookAsSql('T', [])).toBeNull();
            expect(formatNotebookAsSql('T', [markdown('m', '# Only prose')])).toBeNull();
            expect(formatNotebookAsSql('T', [sql('a', ''), sql('b', '   \n')])).toBeNull();

            const out = formatNotebookAsSql('T', [sql('a', '  '), sql('b', 'SELECT 1')]);
            expect(out).toContain('-- Cell 2\nSELECT 1\n');
            expect(out).not.toContain('-- Cell 1');
        });

        it('falls back to a generic title when the title is blank', () => {
            expect(formatNotebookAsSql('   ', [sql('a', 'SELECT 1')])).toContain(
                '-- Tabularis notebook: Notebook',
            );
        });
    });
});
