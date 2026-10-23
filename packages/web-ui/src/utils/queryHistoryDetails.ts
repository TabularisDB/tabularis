import type {QueryHistoryEntry} from '@/types/queryHistory';
import {resolveZone} from './dateGroups';
import {formatDuration} from './formatTime';

export interface HistoryEntryDetailsLabels {
    database: string;
    executed: string;
    duration: string;
    rowsAffected: string;
    status: string;
    success: string;
    error: string;
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/**
 * Formats an instant as `YYYY-MM-DD HH:mm:ss` in the given IANA timezone
 * ("auto" or undefined means the OS local zone). Returns the raw value if it
 * cannot be parsed.
 */
export function formatHistoryTimestamp(isoDate: string, timeZone?: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    const zone = resolveZone(timeZone);
    if (zone) {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: zone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hourCycle: 'h23',
            }).formatToParts(date);
            const get = (type: Intl.DateTimeFormatPartTypes) =>
                parts.find((p) => p.type === type)?.value ?? '';
            return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
        } catch {
            // Unrecognised IANA name: fall back to the OS local timezone.
        }
    }
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
}

/**
 * Plain-text summary of a history entry, for sharing a slow or failing query.
 * Values that were not recorded are left out instead of printed as "null".
 */
export function formatHistoryEntryDetails(
    entry: QueryHistoryEntry,
    labels: HistoryEntryDetailsLabels,
    timeZone?: string,
): string {
    const lines: string[] = [];
    if (entry.database) lines.push(`${labels.database}: ${entry.database}`);
    lines.push(`${labels.executed}: ${formatHistoryTimestamp(entry.executedAt, timeZone)}`);
    if (entry.executionTimeMs != null) {
        lines.push(`${labels.duration}: ${formatDuration(entry.executionTimeMs)}`);
    }
    if (entry.rowsAffected != null) {
        lines.push(`${labels.rowsAffected}: ${entry.rowsAffected}`);
    }
    const outcome =
        entry.status === 'error'
            ? entry.error
                ? `${labels.error}: ${entry.error}`
                : labels.error
            : labels.success;
    lines.push(`${labels.status}: ${outcome}`);
    return `${lines.join('\n')}\n\n${entry.sql}`;
}
