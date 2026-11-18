import type {
    CellImage,
    NonRestorableReason,
    RecordedSaveResponse,
    RestorePlanStatus,
    SaveHistoryStatus,
} from '@/types/saveHistory';
import {serializePkKey} from './dataGrid';

export interface PendingCellUpdate {
    pkVal: Record<string, unknown>;
    colName: string;
    newVal: unknown;
}

export interface RowUpdate {
    pkMap: Record<string, unknown>;
    changes: Record<string, unknown>;
}

/** Groups cell updates into one entry per row, keyed by its identity. */
export function groupUpdatesByRow(updates: readonly PendingCellUpdate[]): RowUpdate[] {
    const rows = new Map<string, RowUpdate>();
    for (const update of updates) {
        const rowKey = serializePkKey(update.pkVal);
        const row = rows.get(rowKey) ?? {pkMap: update.pkVal, changes: {}};
        row.changes[update.colName] = update.newVal;
        rows.set(rowKey, row);
    }
    return [...rows.values()];
}

/**
 * Row saves go through the recording path only when the connection records
 * saves and rows are addressed by a real key. Keyless tables keep the
 * sequential path that threads applied values into each WHERE clause.
 */
export function shouldRecordSaves(
    status: SaveHistoryStatus | null | undefined,
    isKeyless: boolean,
): boolean {
    return !!status && status.supported && status.enabled && !isKeyless;
}

export interface CellImageView {
    kind: CellImage['kind'];
    text: string;
}

export const DEFAULT_CELL_PREVIEW_LENGTH = 200;

/** Display form of a captured value; long text is cut and marked. */
export function describeCellImage(
    image: CellImage | null | undefined,
    labels: {nullLabel: string; omittedLabel: string; missingLabel: string},
    maxLength = DEFAULT_CELL_PREVIEW_LENGTH,
): CellImageView {
    if (!image) return {kind: 'omitted', text: labels.missingLabel};
    switch (image.kind) {
        case 'null':
            return {kind: 'null', text: labels.nullLabel};
        case 'omitted':
            return {kind: 'omitted', text: labels.omittedLabel};
        case 'text': {
            const text =
                image.value.length > maxLength
                    ? `${image.value.slice(0, maxLength)}…`
                    : image.value;
            return {kind: 'text', text};
        }
    }
}

/** `id = 7, tenant = "a"` */
export function formatRecordKey(key: Record<string, unknown>): string {
    return Object.entries(key)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => `${name} = ${JSON.stringify(value)}`)
        .join(', ');
}

export function nonRestorableReasonKey(reason: NonRestorableReason | null): string {
    switch (reason) {
        case 'key_changed':
            return 'saveHistory.reason.keyChanged';
        case 'table_has_triggers':
            return 'saveHistory.reason.tableHasTriggers';
        case 'generated_column':
            return 'saveHistory.reason.generatedColumn';
        case 'value_not_captured':
            return 'saveHistory.reason.valueNotCaptured';
        default:
            return 'saveHistory.reason.unknown';
    }
}

export function planStatusKey(status: RestorePlanStatus): string {
    switch (status) {
        case 'ready':
            return 'saveHistory.status.ready';
        case 'conflict':
            return 'saveHistory.status.conflict';
        case 'row_missing':
            return 'saveHistory.status.rowMissing';
        case 'not_restorable':
            return 'saveHistory.status.notRestorable';
        case 'already_restored':
            return 'saveHistory.status.alreadyRestored';
        case 'restored':
            return 'saveHistory.status.restored';
    }
}

export function canApplyRestore(status: RestorePlanStatus | null | undefined): boolean {
    return status === 'ready';
}

/** The save went through but its record could not be written. */
export function recordingFailed(response: RecordedSaveResponse): boolean {
    return response.skippedReason === 'storage_error';
}
