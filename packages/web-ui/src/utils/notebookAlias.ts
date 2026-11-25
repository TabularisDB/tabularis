import type {NotebookCell, NotebookParam} from '@/types/notebook';

/**
 * A result alias names an SQL cell's result for other cells (`{{sales}}`),
 * independently of the cell's position. It becomes a CTE name, so it is kept
 * to a plain identifier.
 */
const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** `{{cell_N}}` stays the position-based reference, so no alias may look like one. */
const RESERVED_ALIAS_PATTERN = /^cell_\d+$/i;

/** PostgreSQL's identifier limit, the shortest of the supported engines. */
export const MAX_CELL_ALIAS_LENGTH = 63;

export type CellAliasIssue = 'invalid' | 'tooLong' | 'reserved' | 'duplicate' | 'notSql';

/** What is wrong with `alias` taken on its own (format, length, reserved names). */
export function checkAliasFormat(alias: string): CellAliasIssue | null {
    if (alias.length > MAX_CELL_ALIAS_LENGTH) return 'tooLong';
    if (!ALIAS_PATTERN.test(alias)) return 'invalid';
    if (RESERVED_ALIAS_PATTERN.test(alias)) return 'reserved';
    return null;
}

/**
 * Aliases are compared without case: engines fold unquoted CTE names, so
 * `sales` and `SALES` would read as the same name to anyone writing SQL.
 */
function sameAlias(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

/** 0-based indices of the cells whose alias is exactly `alias`. */
export function findCellsByAlias(cells: NotebookCell[], alias: string): number[] {
    const indices: number[] = [];
    cells.forEach((cell, index) => {
        if (cell.alias === alias) indices.push(index);
    });
    return indices;
}

/** `{{alias}}`: how another cell writes a reference to `alias`. */
export function aliasReference(alias: string): string {
    return `{{${alias}}}`;
}

/** Where a name is referenced as `{{name}}`: SQL cells (0-based) and raw parameters. */
export interface AliasUsage {
    cellIndices: number[];
    params: string[];
}

export function findAliasUsages(
    cells: NotebookCell[],
    params: NotebookParam[] | undefined,
    alias: string,
): AliasUsage {
    const reference = aliasReference(alias);
    const cellIndices: number[] = [];
    cells.forEach((cell, index) => {
        if (cell.type === 'sql' && cell.content.includes(reference)) cellIndices.push(index);
    });
    // A raw parameter's text is pasted into the SQL before references resolve.
    const paramNames = (params ?? [])
        .filter((p) => !p.type && p.value.includes(reference))
        .map((p) => p.name);
    return {cellIndices, params: paramNames};
}

export type AliasChangeCheck =
    | {ok: true; alias: string | undefined}
    | {ok: false; issue: CellAliasIssue; conflictIndex?: number}
    | {ok: false; issue: 'inUse'; usage: AliasUsage};

/**
 * Whether the cell `cellId` may take `nextAlias` (trimmed; empty removes it).
 * A new alias must be well formed and unique among all cells. Renaming or
 * removing an alias that is still referenced is refused with the places that
 * use it: changing it would leave those references pointing nowhere, or, if
 * another cell took the old name later, at a different result.
 */
export function checkAliasChange(
    cells: NotebookCell[],
    params: NotebookParam[] | undefined,
    cellId: string,
    nextAlias: string,
): AliasChangeCheck {
    const cell = cells.find((c) => c.id === cellId);
    if (!cell) return {ok: false, issue: 'invalid'};
    const alias = nextAlias.trim();
    const current = cell.alias ?? '';
    if (alias === current) return {ok: true, alias: alias || undefined};
    if (alias !== '') {
        if (cell.type !== 'sql') return {ok: false, issue: 'notSql'};
        const formatIssue = checkAliasFormat(alias);
        if (formatIssue) return {ok: false, issue: formatIssue};
        const conflictIndex = cells.findIndex(
            (c) => c.id !== cellId && !!c.alias && sameAlias(c.alias, alias),
        );
        if (conflictIndex >= 0) return {ok: false, issue: 'duplicate', conflictIndex};
    }
    if (current !== '') {
        const usage = findAliasUsages(cells, params, current);
        if (usage.cellIndices.length > 0 || usage.params.length > 0) {
            return {ok: false, issue: 'inUse', usage};
        }
    }
    return {ok: true, alias: alias || undefined};
}

/**
 * Problems with the aliases of a notebook read from a file, as readable
 * messages (empty when they are all fine). A file is rejected instead of
 * guessing which cell an ambiguous alias meant.
 */
export function findAliasProblems(cells: Array<{type: string; alias?: unknown}>): string[] {
    const problems: string[] = [];
    const seen = new Map<string, number>();
    cells.forEach((cell, index) => {
        if (cell.alias === undefined) return;
        const n = index + 1;
        if (typeof cell.alias !== 'string') {
            problems.push(`Cell ${n} has an alias that is not text`);
            return;
        }
        const alias = cell.alias;
        if (cell.type !== 'sql') {
            problems.push(`Cell ${n} is not an SQL cell and cannot have the alias "${alias}"`);
            return;
        }
        const issue = checkAliasFormat(alias);
        if (issue === 'reserved') {
            problems.push(
                `Cell ${n}: the alias "${alias}" is reserved for position-based references`,
            );
            return;
        }
        if (issue) {
            problems.push(`Cell ${n}: "${alias}" is not a valid alias`);
            return;
        }
        const key = alias.toLowerCase();
        const first = seen.get(key);
        if (first !== undefined) {
            problems.push(`Cells ${first} and ${n} both use the alias "${alias}"`);
            return;
        }
        seen.set(key, n);
    });
    return problems;
}

/** A `{{` reference the cursor is in, as columns of its line. */
export interface OpenReference {
    /** What is typed between `{{` and the cursor. */
    prefix: string;
    /** 0-based column just after `{{`. */
    start: number;
    /**
     * 0-based column the completion replaces up to: past the rest of the name
     * and a closing `}}` already there, so completing never doubles them.
     */
    end: number;
}

export function findOpenReference(line: string, cursor: number): OpenReference | null {
    const match = /\{\{([A-Za-z0-9_]*)$/.exec(line.slice(0, cursor));
    if (!match) return null;
    const rest = /^[A-Za-z0-9_]*\}{0,2}/.exec(line.slice(cursor))?.[0] ?? '';
    return {prefix: match[1], start: cursor - match[1].length, end: cursor + rest.length};
}

export interface ReferenceSuggestion {
    /** What goes between the braces: an alias or `cell_N`. */
    label: string;
    /** 0-based index of the target cell. */
    cellIndex: number;
    kind: 'alias' | 'position';
}

/**
 * What a `{{` in the cell `cellId` can refer to: every other SQL cell's alias
 * first, then the positional `cell_N` of every other SQL cell.
 */
export function referenceSuggestions(cells: NotebookCell[], cellId: string): ReferenceSuggestion[] {
    const others = cells
        .map((cell, index) => ({cell, index}))
        .filter(({cell}) => cell.type === 'sql' && cell.id !== cellId);
    return [
        ...others
            .filter(({cell}) => !!cell.alias)
            .map(({cell, index}) => ({
                label: cell.alias as string,
                cellIndex: index,
                kind: 'alias' as const,
            })),
        ...others.map(({index}) => ({
            label: `cell_${index + 1}`,
            cellIndex: index,
            kind: 'position' as const,
        })),
    ];
}

/** How messages name a cell: `{{alias}}` when it has one, else `{{cell_N}}`. */
export function cellReferenceLabel(cell: NotebookCell | undefined, index: number): string {
    return aliasReference(cell?.alias || `cell_${index + 1}`);
}
