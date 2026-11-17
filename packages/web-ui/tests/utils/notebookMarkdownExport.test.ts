import {fromMarkdown} from 'mdast-util-from-markdown';
import {describe, expect, it} from 'vitest';
import type {NotebookCell} from '@/types/notebook';
import {
    chooseCodeFence,
    exportNotebookToMarkdown,
    findUnclosedFence,
} from '@/utils/notebookMarkdownExport';

function sql(id: string, content: string, extra: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'sql', content, ...extra};
}

function markdown(id: string, content: string, extra: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'markdown', content, ...extra};
}

/** Minimal CommonMark fence scan: the body of each backtick-fenced block, in order. */
function fencedBlocks(text: string): {info: string; body: string}[] {
    const blocks: {info: string; body: string}[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const open = /^(`{3,})([^`]*)$/.exec(lines[i]);
        if (!open) continue;
        const fence = open[1];
        const body: string[] = [];
        let j = i + 1;
        // A closing fence is at least as long as the opening one, with nothing else on the line.
        while (j < lines.length && !new RegExp(`^ {0,3}${fence}\`*\\s*$`).test(lines[j])) {
            body.push(lines[j]);
            j++;
        }
        blocks.push({info: open[2], body: body.join('\n')});
        i = j;
    }
    return blocks;
}

describe('notebookMarkdownExport', () => {
    describe('exportNotebookToMarkdown', () => {
        it('keeps Markdown and SQL cells in notebook order', () => {
            const out = exportNotebookToMarkdown([
                markdown('a', '# Introduction\n\nWhy we look at revenue.'),
                sql('b', 'SELECT 1'),
                sql('c', 'SELECT 2'),
                markdown('d', '## Conclusion'),
            ]);

            expect(out).toBe(
                '# Introduction\n\nWhy we look at revenue.\n\n' +
                    '```sql\nSELECT 1\n```\n\n' +
                    '```sql\nSELECT 2\n```\n\n' +
                    '## Conclusion\n',
            );
        });

        it('exports a Markdown-only notebook as its Markdown', () => {
            expect(exportNotebookToMarkdown([markdown('a', '# A'), markdown('b', '- item')])).toBe(
                '# A\n\n- item\n',
            );
        });

        it('exports a SQL-only notebook as fenced sql blocks', () => {
            const out = exportNotebookToMarkdown([sql('a', 'SELECT 1'), sql('b', 'SELECT 2')]);
            expect(fencedBlocks(out ?? '')).toEqual([
                {info: 'sql', body: 'SELECT 1'},
                {info: 'sql', body: 'SELECT 2'},
            ]);
        });

        it('keeps source verbatim without expanding parameters or cell references', () => {
            const source =
                'SELECT *\n  FROM {{cell_1}}\n WHERE region = @region\n   AND y = ${year};';
            const out = exportNotebookToMarkdown([sql('a', source)]) ?? '';
            expect(fencedBlocks(out)).toEqual([{info: 'sql', body: source}]);
        });

        it('preserves Unicode and multiline text', () => {
            const notes = '# Ventes été 東京 😀\n\nLigne 1\nLigne 2';
            const query = "SELECT '日本語 😀' AS ñ\nFROM t";
            const out = exportNotebookToMarkdown([markdown('a', notes), sql('b', query)]);
            expect(out).toBe(`${notes}\n\n\`\`\`sql\n${query}\n\`\`\`\n`);
        });

        it('does not add a line break to source that already ends with one', () => {
            const out = exportNotebookToMarkdown([
                markdown('a', 'Notes\n'),
                sql('b', 'SELECT 1\r\n'),
            ]);
            expect(out).toBe('Notes\n\n```sql\nSELECT 1\r\n```\n');
        });

        it.each([
            ['a triple backtick line', 'SELECT 1\n```\nSELECT 2', '````'],
            ['a longer backtick run', 'SELECT `a`, ``b``\n`````\nx', '``````'],
            ['MySQL identifiers', 'SELECT `id` FROM `t`', '```'],
            ['an indented fence', 'SELECT 1\n   ````sql\nSELECT 2', '`````'],
        ])('uses a fence longer than %s in the source', (_label, source, fence) => {
            const out = exportNotebookToMarkdown([sql('a', source), markdown('b', 'After')]) ?? '';
            expect(out.startsWith(`${fence}sql\n`)).toBe(true);
            expect(fencedBlocks(out)).toEqual([{info: 'sql', body: source}]);
            expect(out.endsWith('\n\nAfter\n')).toBe(true);
        });

        it('includes collapsed cells and leaves out results, charts, errors, history and the per-cell database', () => {
            const text =
                exportNotebookToMarkdown([
                    markdown('m', 'Notes', {isCollapsed: true, isPreview: true}),
                    sql('a', 'SELECT 1', {
                        isCollapsed: true,
                        isQueryCollapsed: true,
                        schema: 'secret_schema',
                        name: 'cell-name',
                        result: {
                            columns: ['answer'],
                            rows: [['result-value-42']],
                            affected_rows: 0,
                        },
                        error: 'error-text',
                        executionTime: 123456,
                        chartConfig: {type: 'bar', labelColumn: 'chart-label', valueColumns: ['v']},
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
            expect(text).toBe('Notes\n\n```sql\nSELECT 1\n```\n');
            for (const leaked of [
                'secret_schema',
                'result-value-42',
                'error-text',
                '123456',
                'chart-label',
                'history_query',
            ]) {
                expect(text).not.toContain(leaked);
            }
        });

        it('closes a code block left open at the end of a Markdown cell', () => {
            const out = exportNotebookToMarkdown([
                markdown('a', 'Notes\n\n```sql\nSELECT 1'),
                markdown('b', '## Next section'),
                sql('c', 'SELECT 2'),
            ]);
            expect(out).toBe(
                'Notes\n\n```sql\nSELECT 1\n```\n\n' +
                    '## Next section\n\n' +
                    '```sql\nSELECT 2\n```\n',
            );
            expect(fencedBlocks(out ?? '')).toEqual([
                {info: 'sql', body: 'SELECT 1'},
                {info: 'sql', body: 'SELECT 2'},
            ]);
        });

        it('closes an open block with its own fence and indentation', () => {
            expect(
                exportNotebookToMarkdown([markdown('a', '  ~~~~\n  code'), markdown('b', 'After')]),
            ).toBe('  ~~~~\n  code\n  ~~~~\n\nAfter\n');
        });

        it.each([
            ['an HTML comment', '<!--\n```sql\nSELECT 1\n-->'],
            ['an HTML pre block', '<pre>\n```\ntext\n</pre>'],
            ['a list item ended by a paragraph', '- a\n\n  ```\n  code\n\nplain para'],
            ['a list item ended by the next cell', '- step\n\n  ```\n  code'],
            ['a sub-list nested 4 spaces deep', '- a\n  - b\n\n    ```\n    code'],
            ['a block quote', '> ```\n> code'],
        ])('adds no fence for a fence-like line inside %s', (_label, notes) => {
            const out =
                exportNotebookToMarkdown([
                    markdown('a', notes),
                    markdown('b', '## Next'),
                    sql('c', 'SELECT 2'),
                ]) ?? '';
            expect(out).toBe(`${notes}\n\n## Next\n\n\`\`\`sql\nSELECT 2\n\`\`\`\n`);
            const lastTwo = fromMarkdown(out).children.slice(-2);
            expect(lastTwo.map((node) => node.type)).toEqual(['heading', 'code']);
        });

        it('renders the cells after an open block as their own blocks', () => {
            const out =
                exportNotebookToMarkdown([
                    markdown('a', 'Notes\n\n~~~\ncode'),
                    markdown('b', '## Next'),
                    sql('c', 'SELECT 2'),
                ]) ?? '';
            const lastTwo = fromMarkdown(out).children.slice(-2);
            expect(lastTwo.map((node) => node.type)).toEqual(['heading', 'code']);
        });

        it('leaves Markdown cells with closed or no code blocks unchanged', () => {
            const notes = '```\na\n```\n\n~~~\nb\n~~~\n\n    ```\n    indented code';
            expect(exportNotebookToMarkdown([markdown('a', notes)])).toBe(`${notes}\n`);
        });

        it('skips empty and whitespace-only cells', () => {
            expect(
                exportNotebookToMarkdown([
                    markdown('a', ''),
                    sql('b', '  \n\t'),
                    sql('c', 'SELECT 1'),
                    markdown('d', '\n\n'),
                ]),
            ).toBe('```sql\nSELECT 1\n```\n');
        });

        it.each([
            ['no cells', []],
            ['only blank cells', [markdown('a', ' '), sql('b', '\n')]],
        ])('returns null for %s', (_label, cells) => {
            expect(exportNotebookToMarkdown(cells as NotebookCell[])).toBeNull();
        });
    });

    describe('findUnclosedFence', () => {
        it.each([
            ['no fence', 'Just text', null],
            ['a closed backtick block', '```sql\nSELECT 1\n```', null],
            ['a closed tilde block', '~~~\ncode\n~~~', null],
            ['an open backtick block', 'Notes\n```sql\nSELECT 1', '```'],
            ['an open tilde block', '~~~~\ncode', '~~~~'],
            ['an indented open block', '   ```\n   code', '   ```'],
            ['a list item block the next content ends', '- item\n\n  ```\n  code', null],
            ['an HTML comment', '<!--\n```\nx\n-->', null],
            ['an HTML pre block', '<pre>\n```\nx\n</pre>', null],
            ['a shorter closer', '`````\n```\ncode', '`````'],
            ['the other fence character', '```\n~~~\ncode', '```'],
            ['a closer with an info string', '```\ncode\n```sql', '```'],
            ['a longer closer', '```\ncode\n`````  ', null],
            ['a second block left open', '```\na\n```\n~~~\nb', '~~~'],
            ['CR and CRLF line endings', 'a\r```\r\ncode', '```'],
            ['four spaces of indentation', '    ```\n    code', null],
            ['a backtick in the info string', '``` a`b\ntext', null],
            ['a block quote', '> ```\n> code', null],
            ['an inline code span', 'Use ```x``` here', null],
        ])('handles %s', (_label, markdown, closer) => {
            expect(findUnclosedFence(markdown)).toBe(closer);
        });
    });

    describe('chooseCodeFence', () => {
        it.each([
            ['', '```'],
            ['SELECT 1', '```'],
            ['`a`', '```'],
            ['``a``', '```'],
            ['```', '````'],
            ['a ```` b ` c', '`````'],
        ])('picks a fence longer than any backtick run in %j', (source, fence) => {
            expect(chooseCodeFence(source)).toBe(fence);
        });
    });
});
