import type {NotebookCell, NotebookRunMode} from '@/types/notebook';
import type {ParamError, resolveParams} from './notebookParams';
import {extractCellReferences, type CellReferenceToken} from './notebookVariables';
import type {SqlSyntax} from './sqlSyntax';

export type NotebookRunRequest = {mode: 'all'} | {mode: 'cell' | 'affected'; cellId: string};

export interface PlannedCell {
    cell: NotebookCell;
    index: number;
    sql: string;
    paramErrors: ParamError[];
    schema: string | null | undefined;
    databaseLane: string;
    canRunInParallel: boolean;
    references: CellReferenceToken[];
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

// Only numeric literals with optional aliases. Even a plain projection may
// evaluate a sequence, a view, a virtual table, or a server-side policy.
const projection = '[0-9]+(?:\\.[0-9]+)?(?:\\s+AS\\s+[a-z_][a-z_0-9]*)?';
const constantSelect = new RegExp(
    `^SELECT\\s+${projection}(?:\\s*,\\s*${projection})*\\s*;?$`,
    'i',
);

export function isEffectFreeNotebookQuery(sql: string, syntax?: SqlSyntax): boolean {
    return (
        !!syntax &&
        !syntax.declared &&
        (syntax.dialect === 'postgres' ||
            syntax.dialect === 'mysql' ||
            syntax.dialect === 'sqlite' ||
            syntax.dialect === 'mssql' ||
            syntax.dialect === 'oracle') &&
        constantSelect.test(sql.trim())
    );
}

/** Validate the requested subgraph, even through prerequisites with usable output. */
export function buildNotebookExecutionPlan({
    cells,
    request,
    prepare,
    fallbackSchema,
    connectionId = '',
    schemaIsDatabase = false,
    syntax,
    canReuse = () => false,
}: {
    cells: NotebookCell[];
    request: NotebookRunRequest;
    prepare: (sql: string) => Pick<ReturnType<typeof resolveParams>, 'sql' | 'errors'>;
    fallbackSchema?: string | null;
    connectionId?: string;
    schemaIsDatabase?: boolean;
    syntax?: SqlSyntax;
    canReuse?: (node: PlannedCell, cells: NotebookCell[]) => boolean;
}): PlanResult {
    const snapshot = cells.map((cell) => ({...cell}));
    const nodes = new Map<number, PlannedCell>();
    // With an unresolved default database, an unqualified query could share
    // any explicit target. Keep the whole connection in one lane in that case.
    const useDatabaseLanes =
        schemaIsDatabase &&
        (!!fallbackSchema || snapshot.every((cell) => !isSqlCell(cell) || !!cell.schema));
    const consumers = new Map<number, number[]>();

    snapshot.forEach((cell, index) => {
        if (!isSqlCell(cell)) return;
        const {sql, errors} = prepare(cell.content.trim());
        const references = extractCellReferences(sql, syntax);
        const prerequisites = [...new Set(references.map((ref) => ref.cellIndex))];
        const schema = cell.schema || fallbackSchema || undefined;
        nodes.set(index, {
            cell,
            index,
            sql,
            paramErrors: errors,
            schema,
            // Some servers fold database names. Case variants never grant
            // permission to overlap when the server's case rules are unknown.
            databaseLane: JSON.stringify([
                connectionId,
                useDatabaseLanes ? schema?.toLowerCase() : null,
            ]),
            canRunInParallel: !!cell.isParallel && isEffectFreeNotebookQuery(sql, syntax),
            references,
            prerequisites,
        });
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
    const visiting = new Map<number, number>();
    const stack: Array<{node: PlannedCell; cursor: number; seen: Set<number>}> = [];
    const dependencyOrder: number[] = [];
    let skipped = 0;

    function push(node: PlannedCell) {
        visiting.set(node.index, stack.length);
        stack.push({node, cursor: 0, seen: new Set()});
    }

    for (const index of targets) {
        if (snapshot[index].isDisabled) {
            skipped++;
            continue;
        }
        if (visited.has(index)) continue;
        push(nodes.get(index)!);
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const source = frame.node.index;
            const ref = frame.node.references[frame.cursor++];
            if (!ref) {
                stack.pop();
                visiting.delete(source);
                visited.add(source);
                dependencyOrder.push(source);
                continue;
            }
            const {cellIndex: prerequisite, match} = ref;
            if (frame.seen.has(prerequisite)) continue;
            frame.seen.add(prerequisite);
            const target = nodes.get(prerequisite);
            const cycleStart = visiting.get(prerequisite);
            if (prerequisite === source) issues.push({kind: 'self', index: source});
            else if (target?.cell.isDisabled)
                issues.push({kind: 'disabled', index: source, reference: match});
            else if (!target) issues.push({kind: 'missing', index: source, reference: match});
            else if (cycleStart !== undefined)
                issues.push({
                    kind: 'cycle',
                    path: [...stack.slice(cycleStart).map(({node}) => node.index), prerequisite],
                });
            else if (!visited.has(prerequisite)) push(target);
        }
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
    const ready: number[] = [];
    const unmet = new Map<number, number>();
    const enqueue = (index: number) => {
        let child = ready.length;
        while (child > 0) {
            const parent = Math.floor((child - 1) / 2);
            if (ready[parent] <= index) break;
            ready[child] = ready[parent];
            child = parent;
        }
        ready[child] = index;
    };
    const takeFirst = () => {
        const index = ready[0];
        const last = ready.pop()!;
        if (ready.length === 0) return index;
        let parent = 0;
        for (;;) {
            let child = 2 * parent + 1;
            if (child >= ready.length) break;
            if (child + 1 < ready.length && ready[child + 1] < ready[child]) child++;
            if (last <= ready[child]) break;
            ready[parent] = ready[child];
            parent = child;
        }
        ready[parent] = last;
        return index;
    };

    for (const index of required) {
        const count = nodes.get(index)!.prerequisites.filter((ref) => required.has(ref)).length;
        unmet.set(index, count);
        if (count === 0) enqueue(index);
    }
    while (ready.length) {
        const index = takeFirst();
        steps.push(nodes.get(index)!);
        for (const consumer of consumers.get(index) ?? []) {
            const count = unmet.get(consumer);
            if (count === undefined) continue;
            unmet.set(consumer, count - 1);
            if (count === 1) enqueue(consumer);
        }
    }
    return {kind: 'ready', plan: {mode: request.mode, cells: snapshot, nodes, steps, skipped}};
}

/** Compare executable inputs, not presentation settings or runtime output. */
export function sameNotebookCellInput(a: NotebookCell, b: NotebookCell): boolean {
    return a.id === b.id && a.type === b.type && a.content === b.content && a.schema === b.schema;
}
