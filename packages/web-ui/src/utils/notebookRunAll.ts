import type {QueryResult} from '@/types/editor';
import type {NotebookCell, NotebookRunMode, RunAllResult} from '@/types/notebook';
import {
    sameNotebookCellInput,
    type NotebookExecutionPlan,
    type PlannedCell,
} from './notebookExecutionPlan';
import {extractCellReferences} from './notebookVariables';

const activeNotebooks = new Set<string>();

export function isNotebookRunActive(notebookId: string): boolean {
    return activeNotebooks.has(notebookId);
}

/** A confirmation dialog or in-flight query owns the notebook until it settles. */
export function acquireNotebookRun(notebookId: string): (() => void) | undefined {
    if (activeNotebooks.has(notebookId)) return;
    activeNotebooks.add(notebookId);
    return () => {
        activeNotebooks.delete(notebookId);
    };
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
    const pending = [sql];
    while (pending.length) {
        const text = pending.pop()!;
        for (const {cellIndex} of extractCellReferences(text)) {
            const target = cells[cellIndex];
            if (!target || target.type !== 'sql') continue;
            if (target.isDisabled) {
                disabled.add(cellIndex);
                continue;
            }
            if (visited.has(cellIndex)) continue;
            visited.add(cellIndex);
            if (!target.result || target.error) pending.push(prepare(target.content.trim()));
        }
    }
    return Array.from(disabled).sort((a, b) => a - b);
}

export function createRunAllResult(
    mode: NotebookRunMode,
    total: number,
    skipped = 0,
): RunAllResult {
    return {
        mode,
        total,
        executed: 0,
        succeeded: 0,
        failed: 0,
        skipped,
        blocked: 0,
        preflightErrors: [],
        errors: [],
        blockedCells: [],
        changedCells: [],
    };
}

export type CellRunOutcome =
    | {kind: 'success'; result: QueryResult}
    | {kind: 'failed'; error: string; sent: boolean}
    | {kind: 'changed'; sent?: boolean}
    | {kind: 'blocked'; prerequisite: number};

/** Check executable fields and the full positional binding chain. */
export function checkNotebookInputs(
    {cells, nodes}: NotebookExecutionPlan,
    node: PlannedCell,
    live: NotebookCell[],
    {
        unavailable,
        allowDisabledCell = false,
    }: {
        unavailable?: ReadonlySet<number>;
        allowDisabledCell?: boolean;
    } = {},
): Extract<CellRunOutcome, {kind: 'changed' | 'blocked'}> | undefined {
    const current =
        live[node.index]?.id === node.cell.id
            ? live[node.index]
            : live.find((cell) => cell.id === node.cell.id);
    if (
        !current ||
        (!allowDisabledCell && current.isDisabled) ||
        !sameNotebookCellInput(node.cell, current)
    ) {
        return {kind: 'changed'};
    }
    // A move of the executing cell is fine, but moves in the binding chain
    // must not silently bind the same positional reference to another cell.
    const checked = new Set<number>();
    for (const prerequisite of node.prerequisites) {
        const pending = [prerequisite];
        while (pending.length) {
            const index = pending.pop()!;
            if (checked.has(index)) continue;
            checked.add(index);
            const bound = live[index];
            if (
                unavailable?.has(index) ||
                !bound ||
                bound.isDisabled ||
                !sameNotebookCellInput(cells[index], bound)
            )
                return {kind: 'blocked', prerequisite};
            for (const dependency of nodes.get(index)!.prerequisites) pending.push(dependency);
        }
    }
}

/**
 * A batch may only contain independent, opted-in reads in different lanes.
 * Batches are consumed in plan order; a write always runs alone within the plan.
 */
export async function executeNotebookPlan(
    plan: NotebookExecutionPlan,
    {
        stopOnError,
        readCells,
        execute,
    }: {
        stopOnError: boolean;
        readCells: () => NotebookCell[];
        execute: (
            node: PlannedCell,
            inputs: NotebookCell[],
            checkBeforeSend: () =>
                Extract<CellRunOutcome, {kind: 'changed' | 'blocked'}> | undefined,
        ) => Promise<CellRunOutcome>;
    },
): Promise<RunAllResult> {
    const {cells, steps} = plan;
    const summary = createRunAllResult(plan.mode, steps.length + plan.skipped, plan.skipped);
    const inputs = [...cells];
    const unavailable = new Set<number>();
    const stopped = new Set<string>();
    const location = (index: number) => ({cellId: cells[index].id, cellIndex: index});

    for (let cursor = 0; cursor < steps.length;) {
        const first = steps[cursor++];
        const batch = [first];
        if (first.canRunInParallel) {
            const lanes = new Set([first.databaseLane]);
            const indices = new Set([first.index]);
            for (; cursor < steps.length; cursor++) {
                const next = steps[cursor];
                const lane = next.databaseLane;
                if (
                    !next.canRunInParallel ||
                    lanes.has(lane) ||
                    next.prerequisites.some((index) => indices.has(index))
                )
                    break;
                lanes.add(lane);
                indices.add(next.index);
                batch.push(next);
            }
        }

        const outcomes = await Promise.all(
            batch.map(async (node) => {
                const check = () => checkNotebookInputs(plan, node, readCells(), {unavailable});
                const issue = check();
                if (issue) return issue;
                if (stopped.has(node.databaseLane)) return {kind: 'stopped'} as const;
                return execute(node, inputs, check);
            }),
        );

        for (const [i, outcome] of outcomes.entries()) {
            const node = batch[i];
            if (outcome.kind === 'success') {
                summary.executed++;
                summary.succeeded++;
                inputs[node.index] = {...node.cell, result: outcome.result, error: undefined};
                continue;
            }

            unavailable.add(node.index);
            switch (outcome.kind) {
                case 'failed':
                    if (outcome.sent) summary.executed++;
                    summary.failed++;
                    summary.errors.push({...location(node.index), error: outcome.error});
                    if (stopOnError) stopped.add(node.databaseLane);
                    break;
                case 'blocked':
                    summary.blocked++;
                    summary.blockedCells.push({
                        ...location(node.index),
                        prerequisite: location(outcome.prerequisite),
                    });
                    break;
                case 'changed':
                    if (outcome.sent) summary.executed++;
                    summary.changedCells.push(location(node.index));
                    summary.skipped++;
                    break;
                case 'stopped':
                    summary.skipped++;
                    break;
            }
        }
    }

    for (const list of [summary.errors, summary.blockedCells, summary.changedCells]) {
        list.sort((a, b) => a.cellIndex - b.cellIndex);
    }
    return summary;
}
