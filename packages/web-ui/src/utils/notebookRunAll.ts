import type {NotebookCell, RunAllResult} from '@/types/notebook';
import {extractCellReferences} from './notebookVariables';

function isNonEmptySql(cell: NotebookCell): boolean {
    return cell.type === 'sql' && cell.content.trim() !== '';
}

/** Non-empty SQL cells that Run All executes: disabled cells are left out. */
export function getExecutableCells(
    cells: NotebookCell[],
): Array<{cell: NotebookCell; index: number}> {
    return cells
        .map((cell, index) => ({cell, index}))
        .filter(({cell}) => isNonEmptySql(cell) && !cell.isDisabled);
}

/** Non-empty SQL cells that are disabled: Run All counts them as skipped. */
export function getDisabledCells(
    cells: NotebookCell[],
): Array<{cell: NotebookCell; index: number}> {
    return cells
        .map((cell, index) => ({cell, index}))
        .filter(({cell}) => isNonEmptySql(cell) && !!cell.isDisabled);
}

/**
 * The disabled SQL cells (0-based indices, ascending) that stop `sql` from
 * running: referenced directly, or through referenced cells that would have
 * to run first because they have no current result. `prepare` turns a cell's
 * source into the SQL whose references count (notebook parameters resolved).
 */
export function findDisabledPrerequisites(
    sql: string,
    cells: NotebookCell[],
    prepare: (source: string) => string = (source) => source,
): number[] {
    const disabled = new Set<number>();
    const visited = new Set<number>();
    const visit = (text: string) => {
        for (const {cellIndex} of extractCellReferences(text)) {
            const target = cells[cellIndex];
            if (!target || target.type !== 'sql') continue;
            if (target.isDisabled) {
                disabled.add(cellIndex);
                continue;
            }
            if (visited.has(cellIndex)) continue;
            visited.add(cellIndex);
            if (!target.result || target.error) visit(prepare(target.content.trim()));
        }
    };
    visit(sql);
    return Array.from(disabled).sort((a, b) => a - b);
}

export function createRunAllResult(): RunAllResult {
    return {
        total: 0,
        executed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        blocked: 0,
        errors: [],
        blockedCells: [],
    };
}

export function addSuccess(result: RunAllResult): RunAllResult {
    return {
        ...result,
        executed: result.executed + 1,
        succeeded: result.succeeded + 1,
    };
}

export function addFailure(
    result: RunAllResult,
    cellId: string,
    cellIndex: number,
    error: string,
): RunAllResult {
    return {
        ...result,
        executed: result.executed + 1,
        failed: result.failed + 1,
        errors: [...result.errors, {cellId, cellIndex, error}],
    };
}

export function addSkipped(result: RunAllResult, count: number): RunAllResult {
    return {
        ...result,
        skipped: result.skipped + count,
    };
}

/** Record a cell that was not run because `disabledCells` are disabled. */
export function addBlocked(
    result: RunAllResult,
    cellId: string,
    cellIndex: number,
    disabledCells: Array<{cellId: string; cellIndex: number}>,
): RunAllResult {
    return {
        ...result,
        blocked: result.blocked + 1,
        blockedCells: [...result.blockedCells, {cellId, cellIndex, disabledCells}],
    };
}

export function formatRunAllSummary(result: RunAllResult): string {
    const parts: string[] = [];
    if (result.succeeded > 0) parts.push(`${result.succeeded} succeeded`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);
    if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
    if (result.blocked > 0) parts.push(`${result.blocked} blocked`);
    return parts.join(', ');
}
