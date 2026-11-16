import type {QueryResult} from '@/types/editor';

/**
 * Rows captured per statement of a Run All batch.
 *
 * A batch result is a snapshot of what the statement returned while the
 * batch's session state was live. Re-running the statement to load another
 * page would read whatever state the connection holds afterwards (#205), so
 * pages are cut from this snapshot instead. Larger result sets keep the
 * first rows only; running the statement alone pages through all of it.
 */
export const BATCH_SNAPSHOT_ROW_CAP = 1000;

/**
 * Row limit to request for each batch statement.
 * Undefined when pagination is off (page size "All"), which already returns
 * every row in one go.
 */
export function batchSnapshotLimit(pageSize: number | undefined): number | undefined {
    if (pageSize === undefined || !Number.isFinite(pageSize) || pageSize <= 0) return undefined;
    return Math.max(pageSize, BATCH_SNAPSHOT_ROW_CAP);
}

/** Whether a batch statement result should be paged locally from its rows. */
export function isSnapshotResult(result: QueryResult | null | undefined): result is QueryResult {
    return !!result && !!result.pagination && result.columns.length > 0;
}

/**
 * One page of a batch snapshot, shaped like a server-paged result.
 * `truncated` is set when the statement produced more rows than were captured.
 */
export function snapshotPage(snapshot: QueryResult, page: number, pageSize: number): QueryResult {
    const totalRows = snapshot.rows.length;
    const size = pageSize > 0 ? pageSize : Math.max(totalRows, 1);
    const lastPage = Math.max(1, Math.ceil(totalRows / size));
    const current = Math.min(Math.max(1, Math.floor(page) || 1), lastPage);
    const start = (current - 1) * size;
    return {
        ...snapshot,
        rows: snapshot.rows.slice(start, start + size),
        truncated: snapshot.truncated || !!snapshot.pagination?.has_more,
        pagination: {
            page: current,
            page_size: size,
            total_rows: totalRows,
            has_more: start + size < totalRows,
        },
    };
}
