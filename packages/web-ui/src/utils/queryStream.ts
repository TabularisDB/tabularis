import type {TabularisClient} from '@/api/client';
import type {CommandCallOptions} from '@/api/contract';
import type {QueryChunk, StreamQueryRequest} from '@/api/queryStream';
import type {QueryResult} from '@/types/editor';

interface ResultSet {
    columns: string[];
    rows: unknown[][];
}

/**
 * Runs `request` as a stream and returns its rows as one result; each later
 * result set goes to `additional_results`.
 *
 * `onProgress` gets the row count after every chunk, and a new result after
 * the first rows and whenever the rows not yet shown reach the rows shown, so
 * the grid rebuilds its rows a logarithmic number of times.
 *
 * Once `isLive()` is false, chunks are dropped; if the stream then fails, the
 * result last shown is returned, marked truncated.
 */
export async function streamQueryResult(
    client: Pick<TabularisClient, 'streamQuery'>,
    request: StreamQueryRequest,
    options: CommandCallOptions,
    onProgress: (result: QueryResult | null, rowCount: number) => void,
    isLive: () => boolean,
): Promise<QueryResult> {
    const sets: ResultSet[] = [];
    let received = 0;
    let shown: QueryResult | null = null;
    let shownRows = 0;

    const snapshot = (): QueryResult => {
        const [first = {columns: [], rows: []}, ...rest] = sets;
        const result: QueryResult = {
            columns: first.columns,
            rows: first.rows.slice(),
            affected_rows: 0,
        };
        if (rest.length > 0) {
            result.additional_results = rest.map((set) => ({
                columns: set.columns,
                rows: set.rows.slice(),
                affected_rows: 0,
            }));
        }
        return result;
    };

    const onChunk = (chunk: QueryChunk) => {
        if (!isLive()) return;
        if ('columns' in chunk) {
            sets.push({columns: chunk.columns, rows: []});
            return;
        }
        if (sets.length === 0) sets.push({columns: [], rows: []});
        const target = sets[sets.length - 1].rows;
        // A driver without streaming sends every row in one chunk: too many to spread.
        for (const row of chunk.rows) target.push(row);
        received += chunk.rows.length;
        if (received - shownRows >= shownRows) {
            shown = snapshot();
            shownRows = received;
            onProgress(shown, received);
        } else {
            onProgress(null, received);
        }
    };

    try {
        const reply = await client.streamQuery(request, onChunk, options);
        return {
            ...snapshot(),
            affected_rows: reply.affected_rows,
            truncated: reply.truncated,
            server_time_ms: reply.server_time_ms ?? undefined,
            fetch_time_ms: reply.fetch_time_ms ?? undefined,
        };
    } catch (error) {
        if (isLive() || !shown) throw error;
        return {...(shown as QueryResult), truncated: true};
    }
}
