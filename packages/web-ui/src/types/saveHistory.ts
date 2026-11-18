/** A value as the database printed it. `omitted` means it was not captured. */
export type CellImage =
    {kind: 'null'} | {kind: 'text'; value: string} | {kind: 'omitted'; reason: string};

export type NonRestorableReason =
    'key_changed' | 'table_has_triggers' | 'generated_column' | 'value_not_captured';

export interface RecordedColumn {
    name: string;
    dataType: string;
    pre: CellImage;
    post: CellImage;
}

export interface SaveRecord {
    id: string;
    savedAt: string;
    database: string | null;
    schema: string | null;
    table: string;
    key: Record<string, unknown>;
    columns: RecordedColumn[];
    restorable: boolean;
    nonRestorableReason: NonRestorableReason | null;
    restoredAt: string | null;
}

export interface SaveHistoryStatus {
    supported: boolean;
    enabled: boolean;
}

export interface RecordedSaveResponse {
    affected: number;
    recordId: string | null;
    skippedReason: string | null;
}

export type RestorePlanStatus =
    'ready' | 'conflict' | 'row_missing' | 'not_restorable' | 'already_restored' | 'restored';

export interface RestorePlanColumn {
    name: string;
    dataType: string;
    /** What the original save wrote, which the row must still hold. */
    expected: CellImage;
    current: CellImage | null;
    /** What the row held before the original save. */
    restoreTo: CellImage;
    conflict: boolean;
}

export interface RestorePlan {
    recordId: string;
    status: RestorePlanStatus;
    reason: NonRestorableReason | null;
    columns: RestorePlanColumn[];
}
