import type {NotebookCell} from '@/types/notebook';

// Characters that end a `--` line comment or could be shown as a line break:
// C0/C1 controls (CR, LF, NEL, ...), Unicode line/paragraph separators.
const HEADER_BREAKS = /[\p{Cc}\u2028\u2029]+/gu;
// Block comment delimiters could open or close a comment around the text
// that follows when a header is pasted into another tool.
const BLOCK_COMMENT_DELIMITERS = /\/\*|\*\//g;

/**
 * Makes text safe to embed in a single `--` comment line: no line breaks,
 * no block comment delimiters and no surrounding whitespace.
 */
export function sanitizeSqlCommentText(text: string): string {
    return text
        .replace(HEADER_BREAKS, ' ')
        .replace(BLOCK_COMMENT_DELIMITERS, (delimiter) => `${delimiter[0]} ${delimiter[1]}`)
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Builds a `.sql` document with the source of every non-empty SQL cell, in
 * notebook order, each preceded by a comment header. The source is copied
 * verbatim: placeholders, parameters and cell references are not expanded,
 * and no statement delimiters are added. Markdown cells, results and
 * parameter values are left out.
 *
 * Returns `null` when the notebook has no SQL source to export.
 */
export function exportNotebookToSql(title: string, cells: readonly NotebookCell[]): string | null {
    const sections: string[] = [];
    cells.forEach((cell, index) => {
        if (cell.type !== 'sql' || cell.content.trim() === '') return;
        const name = cell.name ? sanitizeSqlCommentText(cell.name) : '';
        const header = `-- ---- Cell ${index + 1}${name ? `: ${name}` : ''} ----`;
        // A trailing line break keeps the next header out of a source that
        // ends in a `--` comment; the source itself is left untouched.
        const source = /[\r\n]$/.test(cell.content) ? cell.content : `${cell.content}\n`;
        sections.push(`${header}\n${source}`);
    });
    if (sections.length === 0) return null;

    const safeTitle = sanitizeSqlCommentText(title);
    const preamble = [
        `-- Tabularis notebook${safeTitle ? `: ${safeTitle}` : ''}`,
        '-- SQL source of the notebook cells, in notebook order.',
        '-- WARNING: this is notebook source, not a runnable script.',
        '-- Notebook placeholders (@name, ${name}) and cell references ({{cell_N}})',
        '-- are not expanded, and each cell may run on its own connection and database.',
        '-- No statement delimiters were added between cells.',
        '',
    ].join('\n');
    return `${preamble}\n${sections.join('\n')}`;
}
