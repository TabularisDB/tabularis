import type {NotebookCell} from '@/types/notebook';

const BACKTICK_RUNS = /`+/g;
const MIN_FENCE_LENGTH = 3;

/**
 * Returns a backtick fence longer than any run of backticks in `source`, so
 * no line of the source can close the fenced block early.
 */
export function chooseCodeFence(source: string): string {
    let longest = 0;
    for (const run of source.match(BACKTICK_RUNS) ?? []) {
        longest = Math.max(longest, run.length);
    }
    return '`'.repeat(Math.max(MIN_FENCE_LENGTH, longest + 1));
}

// CommonMark fences: 3+ backticks or tildes, indented at most 3 spaces. A
// backtick opener's info string cannot contain a backtick; a closer has none.
const FENCE_OPENER = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Returns the line that closes a code block still open at the end of
 * `markdown` (its fence, indented like the opening one so it stays in the
 * same list item), or `null` when every fenced block it opens is closed. In
 * the notebook each Markdown cell renders on its own, so an open block ends
 * with its cell; in one document it would swallow the cells that follow.
 */
export function findUnclosedFence(markdown: string): string | null {
    let open: {indent: string; fence: string} | null = null;
    for (const line of markdown.split(LINE_BREAK)) {
        if (open === null) {
            const opener = FENCE_OPENER.exec(line);
            if (opener && !(opener[2][0] === '`' && opener[3].includes('`'))) {
                open = {indent: opener[1], fence: opener[2]};
            }
        } else {
            const closer = FENCE_CLOSER.exec(line);
            if (closer && closer[1][0] === open.fence[0] && closer[1].length >= open.fence.length) {
                open = null;
            }
        }
    }
    return open ? `${open.indent}${open.fence}` : null;
}

function withTrailingLineBreak(text: string): string {
    return /[\r\n]$/.test(text) ? text : `${text}\n`;
}

/**
 * Builds a Markdown document from the cell source, in notebook order:
 * Markdown cells are copied as they are, except that a code block left open
 * at the end of a cell is closed there, as the notebook renders it. SQL cells
 * are wrapped in fenced `sql` code blocks. The source is copied verbatim:
 * placeholders, parameters and cell references are not expanded. Results,
 * charts, errors, history, per-cell databases and parameter values are left
 * out.
 *
 * Returns `null` when the notebook has no source to export.
 */
export function exportNotebookToMarkdown(cells: readonly NotebookCell[]): string | null {
    const sections: string[] = [];
    for (const cell of cells) {
        if (cell.content.trim() === '') continue;
        if (cell.type === 'sql') {
            const fence = chooseCodeFence(cell.content);
            sections.push(`${fence}sql\n${withTrailingLineBreak(cell.content)}${fence}\n`);
        } else {
            const openFence = findUnclosedFence(cell.content);
            const source = withTrailingLineBreak(cell.content);
            sections.push(openFence ? `${source}${openFence}\n` : source);
        }
    }
    if (sections.length === 0) return null;
    return sections.join('\n');
}
