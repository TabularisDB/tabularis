import type {QueryHistoryEntry} from '@/types/queryHistory';
import {formatHistoryTimestamp} from './queryHistoryDetails';
import {formatDuration} from './formatTime';

/** Serializes entries in the supplied order, trimming trailing SQL whitespace. */
export function formatQueryHistoryAsSql(
    entries: readonly QueryHistoryEntry[],
    timeZone?: string,
): string {
    const blocks = entries.map((entry) => {
        const timestamp = formatHistoryTimestamp(entry.executedAt, timeZone)
            .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ')
            .trim();
        const status = entry.status === 'error' ? 'failed' : 'success';
        const duration =
            entry.executionTimeMs === null ? '' : ` · ${formatDuration(entry.executionTimeMs)}`;
        const lines = [`-- ${timestamp} · ${status}${duration}`];
        if (entry.status === 'error' && entry.error) {
            const errorLines = entry.error.split(/\r\n|[\n\r\u0085\u2028\u2029]/u);
            lines.push(
                ...errorLines.map((line, index) => `-- ${index === 0 ? 'ERROR: ' : ''}${line}`),
            );
        }
        const sql = entry.sql.trimEnd();
        const lastLine = sql.slice(sql.lastIndexOf('\n') + 1);
        // Keep a trailing line comment from swallowing the statement terminator.
        const suffix =
            lastLine.includes('--') || lastLine.includes('#')
                ? '\n;'
                : sql.endsWith(';')
                  ? ''
                  : ';';
        lines.push(`${sql}${suffix}`);
        return lines.join('\n');
    });
    return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}
