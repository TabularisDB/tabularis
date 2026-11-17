/**
 * Qualified identity of a documented table or column. `database` and
 * `schema` are left out when the driver has no such level, so tables named
 * alike in different schemas keep separate notes.
 */
export interface SchemaNoteTarget {
    database?: string;
    schema?: string;
    table: string;
    column?: string;
}

/** A local business note; `domain` groups tables and only exists on table notes. */
export interface SchemaNote extends SchemaNoteTarget {
    domain?: string;
    note: string;
}

/** What the backend stores for one connection. */
export interface SchemaNotesState {
    projectNote: string;
    notes: SchemaNote[];
    /** Off unless the user turns it on for this connection; never exported or imported. */
    includeInAiContext: boolean;
}
