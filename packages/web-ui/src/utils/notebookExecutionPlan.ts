import type {NotebookCell, NotebookRunMode} from '@/types/notebook';
import type {ParamError, resolveParams} from './notebookParams';
import {extractCellReferences} from './notebookVariables';

export type NotebookRunRequest = {mode: 'all'} | {mode: 'cell' | 'affected'; cellId: string};

export interface PlannedCell {
    cell: NotebookCell;
    index: number;
    sql: string;
    paramErrors: ParamError[];
    schema: string | null | undefined;
    prerequisites: number[];
}

export type PlanIssue =
    | {kind: 'self'; index: number}
    | {kind: 'cycle'; path: number[]}
    | {kind: 'missing' | 'disabled'; index: number; reference: string};

export interface NotebookExecutionPlan {
    mode: NotebookRunMode;
    cells: NotebookCell[];
    nodes: ReadonlyMap<number, PlannedCell>;
    steps: PlannedCell[];
    skipped: number;
}

type PlanResult =
    | {kind: 'invalid'; issues: PlanIssue[]; targetCount: number}
    | {kind: 'ready'; plan: NotebookExecutionPlan};

function isSqlCell(cell: NotebookCell): boolean {
    return cell.type === 'sql' && cell.content.trim() !== '';
}

/** Validate the requested subgraph, even through prerequisites with usable output. */
export function buildNotebookExecutionPlan({
    cells,
    request,
    prepare,
    fallbackSchema,
    canReuse = () => true,
}: {
    cells: NotebookCell[];
    request: NotebookRunRequest;
    prepare: (sql: string) => Pick<ReturnType<typeof resolveParams>, 'sql' | 'errors'>;
    fallbackSchema?: string | null;
    canReuse?: (node: PlannedCell, cells: NotebookCell[]) => boolean;
}): PlanResult {
    const snapshot = cells.map((cell) => ({...cell}));
    const nodes = new Map<number, PlannedCell>();
    const references = new Map<number, ReturnType<typeof extractCellReferences>>();
    const consumers = new Map<number, number[]>();

    snapshot.forEach((cell, index) => {
        if (!isSqlCell(cell)) return;
        const {sql, errors} = prepare(cell.content.trim());
        const refs = extractCellReferences(sql);
        const prerequisites = [...new Set(refs.map((ref) => ref.cellIndex))];
        nodes.set(index, {
            cell,
            index,
            sql,
            paramErrors: errors,
            schema: cell.schema || fallbackSchema,
            prerequisites,
        });
        references.set(index, refs);
        for (const prerequisite of prerequisites) {
            const list = consumers.get(prerequisite) ?? [];
            list.push(index);
            consumers.set(prerequisite, list);
        }
    });

    const targets = new Set<number>();
    if (request.mode === 'all') {
        for (const index of nodes.keys()) targets.add(index);
    } else {
        const index = snapshot.findIndex((cell) => cell.id === request.cellId);
        if (nodes.has(index) && !snapshot[index].isDisabled) {
            targets.add(index);
            if (request.mode === 'affected') {
                // Set iteration also visits newly added consumers, once each.
                for (const target of targets) {
                    for (const consumer of consumers.get(target) ?? []) targets.add(consumer);
                }
            }
        }
    }

    const issues: PlanIssue[] = [];
    const visited = new Set<number>();
    const visiting = new Set<number>();
    const path: number[] = [];
    const dependencyOrder: number[] = [];
    let skipped = 0;

    function visit(index: number) {
        if (visited.has(index)) return;
        const node = nodes.get(index);
        if (!node || node.cell.isDisabled) return;
        visiting.add(index);
        path.push(index);
        const seen = new Set<number>();
        for (const {cellIndex: prerequisite, match} of references.get(index) ?? []) {
            if (seen.has(prerequisite)) continue;
            seen.add(prerequisite);
            const target = nodes.get(prerequisite);
            if (prerequisite === index) issues.push({kind: 'self', index});
            else if (target?.cell.isDisabled)
                issues.push({kind: 'disabled', index, reference: match});
            else if (!target) issues.push({kind: 'missing', index, reference: match});
            else if (visiting.has(prerequisite))
                issues.push({
                    kind: 'cycle',
                    path: [...path.slice(path.indexOf(prerequisite)), prerequisite],
                });
            else visit(prerequisite);
        }
        path.pop();
        visiting.delete(index);
        visited.add(index);
        dependencyOrder.push(index);
    }

    for (const index of targets) {
        if (snapshot[index].isDisabled) skipped++;
        else visit(index);
    }
    if (issues.length > 0) return {kind: 'invalid', issues, targetCount: targets.size};

    const required = new Set<number>();
    for (const index of dependencyOrder) {
        const node = nodes.get(index)!;
        if (
            targets.has(index) ||
            !node.cell.result ||
            node.cell.error ||
            node.paramErrors.length > 0 ||
            !canReuse(node, snapshot) ||
            node.prerequisites.some((prerequisite) => required.has(prerequisite))
        ) {
            required.add(index);
        }
    }

    // Topological order, with the earliest document position winning among ready cells.
    const steps: PlannedCell[] = [];
    const pending = new Set([...required].sort((a, b) => a - b));
    while (pending.size > 0) {
        for (const index of pending) {
            const node = nodes.get(index)!;
            if (node.prerequisites.some((prerequisite) => pending.has(prerequisite))) continue;
            steps.push(node);
            pending.delete(index);
            break;
        }
    }
    return {kind: 'ready', plan: {mode: request.mode, cells: snapshot, nodes, steps, skipped}};
}

/** Compare executable inputs, not presentation settings or runtime output. */
export function sameNotebookCellInput(a: NotebookCell, b: NotebookCell): boolean {
    return a.id === b.id && a.type === b.type && a.content === b.content && a.schema === b.schema;
}
