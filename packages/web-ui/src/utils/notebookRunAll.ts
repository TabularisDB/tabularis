import type {QueryResult} from '@/types/editor';
import type {NotebookCell, NotebookRunMode, RunAllResult} from '@/types/notebook';
import {
    sameNotebookCellInput,
    type NotebookExecutionPlan,
    type PlannedCell,
} from './notebookExecutionPlan';
import {extractCellReferences} from './notebookVariables';
import {isReadOnlyQuery} from './sqlAnalysis';

const activeNotebooks = new Set<string>();

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
    | {kind: 'changed'}
    | {kind: 'blocked'; prerequisite: number};

const laneKey = ({schema}: PlannedCell) => schema?.trim() ?? '';

function permitsParallelRead(node: PlannedCell): boolean {
    return !!node.cell.isParallel && isReadOnlyQuery(node.sql);
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
    const {cells, nodes, steps} = plan;
    const summary = createRunAllResult(plan.mode, steps.length + plan.skipped, plan.skipped);
    const inputs = [...cells];
    const unavailable = new Set<number>();
    const stopped = new Set<string>();
    const location = (index: number) => ({cellId: cells[index].id, cellIndex: index});

    function checkInput(node: PlannedCell) {
        const live = readCells();
        const byId = new Map(live.map((cell) => [cell.id, cell]));
        const unchanged = (original: NotebookCell) => {
            const current = byId.get(original.id);
            return current && !current.isDisabled && sameNotebookCellInput(original, current);
        };
        if (!unchanged(node.cell)) return {kind: 'changed'} as const;

        // Check bindings as well as input fields. A deletion or move must not
        // let the same positional reference silently point at another cell.
        const checked = new Set<number>();
        function validPrerequisite(index: number): boolean {
            if (checked.has(index)) return true;
            checked.add(index);
            return (
                !unavailable.has(index) &&
                live[index]?.id === cells[index].id &&
                !!unchanged(cells[index]) &&
                (nodes.get(index)?.prerequisites.every(validPrerequisite) ?? true)
            );
        }
        const prerequisite = node.prerequisites.find((index) => !validPrerequisite(index));
        if (prerequisite !== undefined) return {kind: 'blocked', prerequisite} as const;
    }

    for (let cursor = 0; cursor < steps.length;) {
        const first = steps[cursor++];
        const batch = [first];
        if (permitsParallelRead(first)) {
            const lanes = new Set([laneKey(first)]);
            const indices = new Set([first.index]);
            for (; cursor < steps.length; cursor++) {
                const next = steps[cursor];
                const lane = laneKey(next);
                if (
                    !permitsParallelRead(next) ||
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
                const check = () => checkInput(node);
                const issue = check();
                if (issue) return issue;
                if (stopped.has(laneKey(node))) return {kind: 'stopped'} as const;
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
                    if (stopOnError) stopped.add(laneKey(node));
                    break;
                case 'blocked':
                    summary.blocked++;
                    summary.blockedCells.push({
                        ...location(node.index),
                        prerequisite: location(outcome.prerequisite),
                    });
                    break;
                case 'changed':
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
