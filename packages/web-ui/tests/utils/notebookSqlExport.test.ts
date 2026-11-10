import {describe, expect, it} from 'vitest';
import type {NotebookCell} from '@/types/notebook';
import {exportNotebookToSql, sanitizeSqlCommentText} from '@/utils/notebookSqlExport';

function sql(id: string, content: string, extra: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'sql', content, ...extra};
}

function markdown(id: string, content: string): NotebookCell {
    return {id, type: 'markdown', content};
}

/** Lines that are not comments or blank, i.e. what a SQL client would run. */
function executableLines(sqlText: string): string[] {
    return sqlText.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('--'));
}

describe('notebookSqlExport', () => {
    describe('exportNotebookToSql', () => {
        it('writes SQL cells in notebook order and leaves Markdown out', () => {
            const out = exportNotebookToSql('Revenue', [
                sql('a', 'SELECT 1', {name: 'First'}),
                markdown('b', '# Explanation that must not leak'),
                sql('c', 'SELECT 2'),
            ]);

            expect(out).not.toBeNull();
            const text = out as string;
            expect(text.startsWith('-- Tabularis notebook: Revenue\n')).toBe(true);
            expect(text).not.toContain('Explanation that must not leak');
            expect(text.indexOf('-- ---- Cell 1: First ----\nSELECT 1\n')).toBeGreaterThan(0);
            expect(text.indexOf('-- ---- Cell 3 ----\nSELECT 2\n')).toBeGreaterThan(
                text.indexOf('SELECT 1'),
            );
            expect(executableLines(text)).toEqual(['SELECT 1', 'SELECT 2']);
        });

        it('keeps source verbatim without adding delimiters or expanding placeholders', () => {
            const source =
                'SELECT *\n  FROM {{cell_1}}\n WHERE region = @region\n   AND y = ${year}  ';
            const text = exportNotebookToSql('N', [sql('a', 'SELECT 1;'), sql('b', source)]) ?? '';

            expect(text).toContain(`-- ---- Cell 2 ----\n${source}\n`);
            expect(text).toContain('-- ---- Cell 1 ----\nSELECT 1;\n');
            expect(text).not.toContain('SELECT 1;;');
            expect(text).not.toMatch(/\$\{year\}\s*;/);
        });

        it('does not add a line break to source that already ends with one', () => {
            const text =
                exportNotebookToSql('N', [sql('a', 'SELECT 1\n\n'), sql('b', 'SELECT 2\r\n')]) ??
                '';
            expect(text).toContain('-- ---- Cell 1 ----\nSELECT 1\n\n\n-- ---- Cell 2 ----\n');
            expect(text.endsWith('SELECT 2\r\n')).toBe(true);
        });

        it('keeps a trailing line comment from swallowing the next header', () => {
            const text =
                exportNotebookToSql('N', [sql('a', 'SELECT 1 -- note'), sql('b', 'SELECT 2')]) ??
                '';
            expect(text).toContain('SELECT 1 -- note\n\n-- ---- Cell 2 ----\nSELECT 2\n');
        });

        it('warns that placeholders and per-cell context are not expanded', () => {
            const text = exportNotebookToSql('N', [sql('a', 'SELECT 1')]) ?? '';
            expect(text).toContain('not a runnable script');
            expect(text).toContain('@name');
            expect(text).toContain('{{cell_N}}');
            expect(text).toContain('connection and database');
        });

        it('leaves out results, errors, history and the per-cell database', () => {
            const text =
                exportNotebookToSql('N', [
                    sql('a', 'SELECT 1', {
                        schema: 'secret_schema',
                        result: {
                            columns: ['answer'],
                            rows: [['result-value-42']],
                            affected_rows: 0,
                        },
                        error: 'error-text',
                        history: [
                            {
                                query: 'SELECT history_query',
                                result: null,
                                executionTime: 1,
                                timestamp: 1,
                            },
                        ],
                    }),
                ]) ?? '';
            for (const leaked of [
                'secret_schema',
                'result-value-42',
                'error-text',
                'history_query',
            ]) {
                expect(text).not.toContain(leaked);
            }
        });

        it('preserves Unicode source and names', () => {
            const text =
                exportNotebookToSql('Ventes été 東京', [
                    sql('a', "SELECT '日本語 😀' AS ñ", {name: 'Résumé 😀'}),
                ]) ?? '';
            expect(text).toContain('-- Tabularis notebook: Ventes été 東京');
            expect(text).toContain("-- ---- Cell 1: Résumé 😀 ----\nSELECT '日本語 😀' AS ñ\n");
        });

        it.each([
            ['line feed', 'x\nDROP TABLE users;'],
            ['carriage return', 'x\rDROP TABLE users;'],
            ['CRLF', 'x\r\nDROP TABLE users;'],
            ['next line', 'x\u0085DROP TABLE users;'],
            ['line separator', 'x\u2028DROP TABLE users;'],
            ['paragraph separator', 'x\u2029DROP TABLE users;'],
            ['vertical tab and form feed', 'x\u000b\u000cDROP TABLE users;'],
            ['block comment close', 'x */ DROP TABLE users; /* y'],
        ])('keeps a cell name with a %s inside its header comment', (_label, name) => {
            const text = exportNotebookToSql(name, [sql('a', 'SELECT 1', {name: name})]) ?? '';
            expect(executableLines(text)).toEqual(['SELECT 1']);
            expect(text).not.toMatch(/\/\*|\*\//);
            expect(text.split(/\r\n|[\n\r\u0085\u2028\u2029]/)).toEqual(text.split('\n'));
        });

        it.each([
            ['no cells', []],
            ['only Markdown cells', [markdown('a', 'SELECT 1 in prose')]],
            ['only blank SQL cells', [sql('a', ''), sql('b', '  \n\t')]],
        ])('returns null for %s', (_label, cells) => {
            expect(exportNotebookToSql('N', cells as NotebookCell[])).toBeNull();
        });

        it('skips blank SQL cells but keeps the notebook numbering', () => {
            const text = exportNotebookToSql('N', [sql('a', '   '), sql('b', 'SELECT 2')]) ?? '';
            expect(text).not.toContain('Cell 1');
            expect(text).toContain('-- ---- Cell 2 ----\nSELECT 2\n');
        });

        it('omits an empty or whitespace-only title and name', () => {
            const text = exportNotebookToSql(' \n ', [sql('a', 'SELECT 1', {name: '\n'})]) ?? '';
            expect(text.startsWith('-- Tabularis notebook\n')).toBe(true);
            expect(text).toContain('-- ---- Cell 1 ----\n');
        });
    });

    describe('sanitizeSqlCommentText', () => {
        it('collapses line breaks and splits block comment delimiters', () => {
            expect(sanitizeSqlCommentText('  a\r\n b\u2028c */ d /* e  ')).toBe(
                'a b c * / d / * e',
            );
        });

        it('leaves ordinary text alone', () => {
            expect(sanitizeSqlCommentText('Revenue -- 2026 (EU)')).toBe('Revenue -- 2026 (EU)');
        });
    });
});
