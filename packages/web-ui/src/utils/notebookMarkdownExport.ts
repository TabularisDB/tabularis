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

function withTrailingLineBreak(text: string): string {
    return /[\r\n]$/.test(text) ? text : `${text}\n`;
}

/**
 * Builds a Markdown document from the cell source, in notebook order:
 * Markdown cells are copied as they are and SQL cells are wrapped in fenced
 * `sql` code blocks. The source is copied verbatim: placeholders, parameters
 * and cell references are not expanded. Results, charts, errors, history,
 * per-cell databases and parameter values are left out.
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
            sections.push(withTrailingLineBreak(cell.content));
        }
    }
    if (sections.length === 0) return null;
    return sections.join('\n');
}
