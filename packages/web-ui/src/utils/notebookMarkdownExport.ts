import {fromMarkdown} from 'mdast-util-from-markdown';
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

// A line that opens a fenced code block: 3+ backticks or tildes, indented at
// most 3 spaces.
const FENCE_OPENER = /^( {0,3})(`{3,}|~{3,})/;
const LINE_BREAK = /\r\n|\r|\n/;
// A paragraph appended to a cell to see whether the cell swallows what follows.
const PROBE = 'tabularis-markdown-export-probe';

/**
 * Returns the fence that closes a code block still open at the end of
 * `markdown`, or `null` when nothing in it would swallow the content that
 * follows. In the notebook each Markdown cell renders on its own, so an open
 * block ends with its cell; in one document it would swallow the next cells.
 *
 * The cell is parsed with a probe paragraph after it, so fence-like lines
 * inside HTML blocks, closed blocks and blocks ended by their list item are
 * left alone: only a fenced block that takes in the probe is closed, with the
 * fence and indentation of its opening line.
 */
export function findUnclosedFence(markdown: string): string | null {
    const root = fromMarkdown(`${withTrailingLineBreak(markdown)}\n${PROBE}\n`);
    const last = root.children[root.children.length - 1];
    if (last?.type !== 'code' || !last.position || !last.value.includes(PROBE)) {
        return null;
    }
    const openingLine = markdown.split(LINE_BREAK)[last.position.start.line - 1] ?? '';
    const opener = FENCE_OPENER.exec(openingLine);
    return opener ? `${opener[1]}${opener[2]}` : null;
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
