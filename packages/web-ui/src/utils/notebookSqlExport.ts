import type {NotebookCell} from '@/types/notebook';

/**
 * Characters that must not reach a `--` comment line: CR, LF, NEL (U+0085)
 * and the Unicode line and paragraph separators (U+2028, U+2029), which would
 * end the comment early, plus the remaining C0 and C1 control characters, tab
 * excepted.
 */
function breaksCommentLine(codePoint: number): boolean {
    if (codePoint < 0x20) return codePoint !== 0x09;
    if (codePoint >= 0x7f && codePoint <= 0x9f) return true;
    return codePoint === 0x2028 || codePoint === 0x2029;
}

/**
 * Makes user text safe inside a single `--` comment line. A line break in a
 * cell name would otherwise end the comment and turn the rest of the name
 * into executable text. Each run of such characters becomes one space.
 */
function commentText(text: string): string {
    let out = '';
    let pendingSpace = false;
    for (const character of text) {
        if (breaksCommentLine(character.codePointAt(0) ?? 0)) {
            pendingSpace = true;
            continue;
        }
        if (pendingSpace) {
            out += ' ';
            pendingSpace = false;
        }
        out += character;
    }
    return out.replace(/ {2,}/g, ' ').trim();
}

/**
 * Builds a `.sql` file holding the source of every SQL cell, in notebook
 * order, or returns `null` when the notebook has no SQL source to export.
 *
 * Only source goes out: Markdown bodies, results, charts, parameter values and
 * connection details stay behind. Each cell's source is copied verbatim
 * between `--` comment headers, with no delimiter appended, and the file says
 * up front that notebook parameters, cell references and per-cell database
 * context are left as written, so nobody mistakes it for a runnable script.
 * Cells are numbered by their position in the notebook, Markdown included, so
 * the headers match what the notebook shows.
 */
export function formatNotebookAsSql(title: string, cells: readonly NotebookCell[]): string | null {
    const sections: string[] = [];
    cells.forEach((cell, index) => {
        if (cell.type !== 'sql' || cell.content.trim() === '') return;
        const header = [`-- Cell ${index + 1}`];
        const name = commentText(cell.name ?? '');
        if (name) header[0] += `: ${name}`;
        const schema = commentText(cell.schema ?? '');
        if (schema) header.push(`-- Database: ${schema}`);
        const source = cell.content.endsWith('\n') ? cell.content : `${cell.content}\n`;
        sections.push(`${header.join('\n')}\n${source}`);
    });
    if (sections.length === 0) return null;

    const preamble = [
        `-- Tabularis notebook: ${commentText(title) || 'Notebook'}`,
        '-- SQL cell source in notebook order. Not a runnable script:',
        '-- notebook parameters (@name, ${name}) and cell references ({{name}})',
        "-- are left as written, and each cell's connection and database context",
        '-- is not included.',
    ].join('\n');

    return `${preamble}\n\n${sections.join('\n')}`;
}
