import type {SchemaNote, SchemaNoteTarget, SchemaNotesState} from '@/types/schemaNotes';

export const SCHEMA_NOTES_FILE_FILTER = [
    {name: 'Tabularis schema notes', extensions: ['json']},
] as const;

export const EMPTY_SCHEMA_NOTES: SchemaNotesState = {
    projectNote: '',
    notes: [],
    includeInAiContext: false,
};

/** Build a note identity; empty levels mean the driver has none. */
export function noteTarget(
    base: {database?: string | null; schema?: string | null; table: string},
    column?: string | null,
): SchemaNoteTarget {
    return {
        ...(base.database ? {database: base.database} : {}),
        ...(base.schema ? {schema: base.schema} : {}),
        table: base.table,
        ...(column ? {column} : {}),
    };
}

/** A stable key for one identity, safe for names containing dots or quotes. */
export function noteKey(target: SchemaNoteTarget): string {
    return JSON.stringify([
        target.database ?? null,
        target.schema ?? null,
        target.table,
        target.column ?? null,
    ]);
}

export function sameTarget(left: SchemaNoteTarget, right: SchemaNoteTarget): boolean {
    return noteKey(left) === noteKey(right);
}

export function findNote(
    state: SchemaNotesState,
    target: SchemaNoteTarget,
): SchemaNote | undefined {
    const key = noteKey(target);
    return state.notes.find((note) => noteKey(note) === key);
}

/** `orders.status` style label with every known level, for lists and titles. */
export function describeTarget(target: SchemaNoteTarget): string {
    return [target.database, target.schema, target.table, target.column]
        .filter((part): part is string => Boolean(part))
        .join('.');
}

export interface DomainGroup {
    /** Empty for tables without a domain. */
    domain: string;
    tables: {target: SchemaNoteTarget; columnCount: number}[];
}

/**
 * Group documented tables by business domain for browsing. A table that only
 * has column notes is listed without a domain. Order is deterministic: named
 * domains alphabetically, then ungrouped tables.
 */
export function groupNotesByDomain(state: SchemaNotesState): DomainGroup[] {
    const tables = new Map<
        string,
        {target: SchemaNoteTarget; domain: string; columnCount: number}
    >();
    for (const note of state.notes) {
        const table = noteTarget(note);
        const key = noteKey(table);
        const entry = tables.get(key) ?? {target: table, domain: '', columnCount: 0};
        if (note.column) entry.columnCount += 1;
        else entry.domain = note.domain?.trim() ?? '';
        tables.set(key, entry);
    }
    const groups = new Map<string, DomainGroup>();
    for (const {target, domain, columnCount} of tables.values()) {
        const group = groups.get(domain) ?? {domain, tables: []};
        group.tables.push({target, columnCount});
        groups.set(domain, group);
    }
    const byLabel = (left: SchemaNoteTarget, right: SchemaNoteTarget) =>
        describeTarget(left).localeCompare(describeTarget(right));
    return [...groups.values()]
        .map((group) => ({
            ...group,
            tables: group.tables.sort((left, right) => byLabel(left.target, right.target)),
        }))
        .sort((left, right) => {
            if (!left.domain) return 1;
            if (!right.domain) return -1;
            return left.domain.localeCompare(right.domain);
        });
}

/**
 * Columns to show for a table: the ones the database reports, in its order,
 * then documented columns it no longer reports (kept, marked as not found).
 */
export function columnsWithNotes(
    state: SchemaNotesState,
    table: SchemaNoteTarget,
    loadedColumns: readonly string[],
): {name: string; found: boolean}[] {
    const loaded = new Set(loadedColumns);
    const tableKey = noteKey(noteTarget(table));
    const missing = state.notes
        .filter((note) => note.column && !loaded.has(note.column))
        .filter((note) => noteKey(noteTarget(note)) === tableKey)
        .map((note) => note.column as string)
        .sort((left, right) => left.localeCompare(right));
    return [
        ...loadedColumns.map((name) => ({name, found: true})),
        ...missing.map((name) => ({name, found: false})),
    ];
}

/** File name for an exported sidecar, without characters file systems reject. */
export function schemaNotesFileName(connectionName: string): string {
    const base = connectionName.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return `${base || 'connection'}.tabularis-notes.json`;
}
