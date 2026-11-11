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

export const CHUNK_WAIT_TIMEOUT_MS = 5_000;

/**
 * Wraps `onChunk` so a transport can wait for every chunk of a stream: the
 * chunks and the reply travel separately, so the reply can arrive first.
 * `until` rejects when no chunk arrives for `CHUNK_WAIT_TIMEOUT_MS`.
 */
export function countChunks(onChunk: (chunk: QueryChunk) => void) {
    let received = 0;
    let waiting: {count: number; resolve: () => void; restart: () => void} | undefined;
    return {
        deliver(chunk: QueryChunk) {
            onChunk(chunk);
            received += 1;
            if (!waiting) return;
            if (received >= waiting.count) waiting.resolve();
            else waiting.restart();
        },
        until(count: number): Promise<void> {
            if (received >= count) return Promise.resolve();
            return new Promise((resolve, reject) => {
                let timer: ReturnType<typeof setTimeout>;
                const restart = () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        waiting = undefined;
                        reject(
                            new Error(`Stream incomplete: received ${received} of ${count} chunks`),
                        );
                    }, CHUNK_WAIT_TIMEOUT_MS);
                };
                waiting = {
                    count,
                    resolve: () => {
                        clearTimeout(timer);
                        resolve();
                    },
                    restart,
                };
                restart();
            });
        },
    };
}
