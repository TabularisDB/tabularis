import type {NotebookCell, NotebookParam} from '@/types/notebook';
import {extractCellReferences} from './notebookVariables';
import {extractParamReferences} from './notebookParams';
import type {DialectInput} from './sqlSplitter';

/**
 * Dependency inspection for notebook cells. It only reads notebook syntax
 * through the shared reference extractors (`extractCellReferences`,
 * `extractParamReferences`), so it works without a live connection and never
 * interprets dependency syntax on its own. Only positional `{{cell_N}}`
 * references exist today; when named aliases arrive they belong in those
 * extractors, and this module picks them up.
 */

export interface CellIdentity {
    cellId: string;
    /** Zero-based position in the notebook. */
    cellIndex: number;
    /** Display name, when the cell has one. */
    name?: string;
}

/**
 * Why an existing referenced cell cannot provide a result (a position with no
 * cell at all is a separate `missing` dependency):
 * - `markdown`: the position holds a Markdown cell, which has no result.
 * - `self`: the cell references itself.
 */
export type InvalidTargetReason = 'markdown' | 'self';

export type CellDependency =
    | {kind: 'cell'; target: CellIdentity; disabled: boolean; occurrences: number}
    | {kind: 'missing'; position: number; occurrences: number}
    | {kind: 'invalid'; target: CellIdentity; reason: InvalidTargetReason; occurrences: number};

export interface ParamDependency {
    name: string;
    /** False when the notebook defines no parameter with this name. */
    defined: boolean;
    occurrences: number;
}

export interface CellDependencies {
    cell: CellIdentity;
    /** Direct cell references, in order of first appearance in the SQL. */
    uses: CellDependency[];
    /** Referenced notebook parameters, in order of first appearance. */
    params: ParamDependency[];
    /** SQL cells that reference this cell directly, in notebook order. */
    usedBy: CellIdentity[];
    /**
     * A reference cycle reachable from this cell, as the cells along it with the
     * first cell repeated at the end, or null. A cycle means the chain can never
     * be fully resolved, so the inspector reports it rather than a valid chain.
     */
    cycle: CellIdentity[] | null;
}

function identity(cells: NotebookCell[], index: number): CellIdentity {
    const cell = cells[index];
    return {cellId: cell.id, cellIndex: index, ...(cell.name ? {name: cell.name} : {})};
}

/** Distinct referenced positions of a SQL cell, with their counts, in order of first appearance. */
function referencedPositions(cell: NotebookCell): Map<number, number> {
    const positions = new Map<number, number>();
    if (cell.type !== 'sql') return positions;
    for (const ref of extractCellReferences(cell.content)) {
        positions.set(ref.cellIndex, (positions.get(ref.cellIndex) ?? 0) + 1);
    }
    return positions;
}

/** Positions of valid SQL targets a cell depends on (graph edges). */
function validEdges(cells: NotebookCell[], index: number): number[] {
    return [...referencedPositions(cells[index]).keys()].filter(
        (target) => target !== index && cells[target]?.type === 'sql',
    );
}

/**
 * First reference cycle reachable from `start`, following valid edges
 * depth-first in reference order. Self-references are reported as invalid
 * targets instead, so they are not treated as cycles here.
 */
function findCycle(cells: NotebookCell[], start: number): number[] | null {
    const state = new Map<number, 'active' | 'done'>();
    const path: number[] = [];

    const visit = (index: number): number[] | null => {
        state.set(index, 'active');
        path.push(index);
        for (const next of validEdges(cells, index)) {
            const seen = state.get(next);
            if (seen === 'active') {
                return [...path.slice(path.indexOf(next)), next];
            }
            if (seen === undefined) {
                const cycle = visit(next);
                if (cycle) return cycle;
            }
        }
        path.pop();
        state.set(index, 'done');
        return null;
    };

    return visit(start);
}

/**
 * Direct incoming and outgoing dependencies of the SQL cell `cellId`, or null
 * when no SQL cell has that id.
 */
export function inspectCellDependencies(
    cells: NotebookCell[],
    cellId: string,
    params: NotebookParam[] = [],
    dialect?: DialectInput,
): CellDependencies | null {
    const index = cells.findIndex((c) => c.id === cellId);
    if (index === -1 || cells[index].type !== 'sql') return null;
    const cell = cells[index];

    const uses: CellDependency[] = [];
    for (const [position, occurrences] of referencedPositions(cell)) {
        const target = cells[position];
        if (!target) {
            uses.push({kind: 'missing', position: position + 1, occurrences});
        } else if (position === index) {
            uses.push({
                kind: 'invalid',
                target: identity(cells, position),
                reason: 'self',
                occurrences,
            });
        } else if (target.type !== 'sql') {
            uses.push({
                kind: 'invalid',
                target: identity(cells, position),
                reason: 'markdown',
                occurrences,
            });
        } else {
            uses.push({
                kind: 'cell',
                target: identity(cells, position),
                disabled: !!target.isDisabled,
                occurrences,
            });
        }
    }

    const defined = new Set(params.map((p) => p.name));
    const paramCounts = new Map<string, number>();
    for (const ref of extractParamReferences(cell.content, dialect)) {
        paramCounts.set(ref.name, (paramCounts.get(ref.name) ?? 0) + 1);
    }
    const paramDeps = [...paramCounts].map(([name, occurrences]) => ({
        name,
        defined: defined.has(name),
        occurrences,
    }));

    const usedBy: CellIdentity[] = [];
    cells.forEach((other, otherIndex) => {
        if (otherIndex !== index && referencedPositions(other).has(index)) {
            usedBy.push(identity(cells, otherIndex));
        }
    });

    const cycle = findCycle(cells, index);

    return {
        cell: identity(cells, index),
        uses,
        params: paramDeps,
        usedBy,
        cycle: cycle ? cycle.map((i) => identity(cells, i)) : null,
    };
}
