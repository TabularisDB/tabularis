import type {NotebookCell, RunAllResult} from '@/types/notebook';
import {extractCellReferences} from './notebookVariables';

function isNonEmptySql(cell: NotebookCell): boolean {
    return cell.type === 'sql' && cell.content.trim() !== '';
}

export interface ScheduledCell {
    cell: NotebookCell;
    index: number;
}

/** Non-empty SQL cells that Run All executes: disabled cells are left out. */
export function getExecutableCells(cells: NotebookCell[]): ScheduledCell[] {
    return cells
        .map((cell, index) => ({cell, index}))
        .filter(({cell}) => isNonEmptySql(cell) && !cell.isDisabled);
}

/**
 * How Run All orders work. Cells marked parallel still start together.
 * Every other cell stays in document order inside its database, and those
 * databases run at the same time. A cell with no database of its own uses
 * `fallbackDatabase` (the notebook tab's database), so cells that share a
 * database cannot pass each other.
 */
export function partitionRunAllCells(
    executable: ScheduledCell[],
    fallbackDatabase: string | null | undefined,
): {parallel: ScheduledCell[]; lanes: ScheduledCell[][]} {
    const parallel = executable.filter(({cell}) => cell.isParallel);
    const fallback = fallbackDatabase?.trim() ?? '';
    const lanes: ScheduledCell[][] = [];
    const laneIndex = new Map<string, number>();
    for (const item of executable) {
        if (item.cell.isParallel) continue;
        const key = item.cell.schema?.trim() || fallback;
        const existing = laneIndex.get(key);
        if (existing === undefined) {
            laneIndex.set(key, lanes.length);
            lanes.push([item]);
        } else {
            lanes[existing].push(item);
        }
    }
    return {parallel, lanes};
}

/**
 * Cells this SQL names that appear earlier in the notebook. A later cell on
 * another database waits for these before it starts, so it reads the result
 * this run just produced. Later references are left to the cell itself: waiting
 * for them would deadlock with the per-database order.
 */
export function earlierReferencedCellIds(
    cellIndex: number,
    sql: string,
    cells: NotebookCell[],
): string[] {
    const ids: string[] = [];
    for (const {cellIndex: referenced} of extractCellReferences(sql, cells)) {
        if (referenced >= cellIndex) continue;
        const target = cells[referenced];
        if (target) ids.push(target.id);
    }
    return ids;
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
        for (const {cellIndex} of extractCellReferences(text, cells)) {
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
