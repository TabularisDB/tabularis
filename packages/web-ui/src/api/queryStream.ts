import type {ExecuteQueryRequest} from './contract';

/** One piece of a streamed result. A later `columns` starts the next result set. */
export type QueryChunk = {columns: string[]} | {rows: unknown[][]};

export type StreamQueryRequest = Omit<ExecuteQueryRequest, 'limit' | 'page'>;

/** The `stream_query` reply. Mirrors `application::queries::StreamedQuery`. */
export interface StreamedQuery {
    affected_rows: number;
    server_time_ms: number | null;
    fetch_time_ms: number | null;
    in_transaction: boolean;
    chunks: number;
    truncated: boolean;
}

/**
 * Wraps `onChunk` so a transport can wait for every chunk of a stream: the
 * chunks and the reply travel separately, so the reply can arrive first.
 */
export function countChunks(onChunk: (chunk: QueryChunk) => void) {
    let received = 0;
    let waiting: {count: number; resolve: () => void} | undefined;
    return {
        deliver(chunk: QueryChunk) {
            onChunk(chunk);
            received += 1;
            if (waiting && received >= waiting.count) waiting.resolve();
        },
        until(count: number): Promise<void> {
            if (received >= count) return Promise.resolve();
            return new Promise((resolve) => {
                waiting = {count, resolve};
            });
        },
    };
}
