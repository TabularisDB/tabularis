const INVALID_FILE_NAME_CHARS = /[/\\:*?"<>|]/g;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_BASE_NAME_LENGTH = 100;

export interface ExportFileNameOptions {
    tableName?: string | null;
    extension: string;
    date?: Date;
}

const pad = (value: number) => String(value).padStart(2, '0');

const formatLocalDate = (date: Date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatLocalTime = (date: Date) => `${pad(date.getHours())}${pad(date.getMinutes())}`;

/**
 * Makes a table name safe to use as a file name on Windows, macOS and Linux.
 * Returns an empty string when nothing usable is left.
 */
export function sanitizeFileNamePart(name: string): string {
    let safe = Array.from(name, (char) => (char.charCodeAt(0) < 0x20 ? '_' : char))
        .join('')
        .replace(INVALID_FILE_NAME_CHARS, '_')
        .trim()
        .replace(/[. ]+$/, '')
        .slice(0, MAX_BASE_NAME_LENGTH)
        .replace(/[. ]+$/, '');
    if (/^_*$/.test(safe)) return '';
    if (WINDOWS_RESERVED_NAMES.test(safe)) safe = `${safe}_`;
    return safe;
}

/**
 * Default file name for an exported result: `<table>_<YYYY-MM-DD>.<ext>` for
 * a table tab, `result_<YYYY-MM-DD>_<HHMM>.<ext>` otherwise (local time).
 */
export function buildExportFileName({
    tableName,
    extension,
    date = new Date(),
}: ExportFileNameOptions): string {
    const table = tableName ? sanitizeFileNamePart(tableName) : '';
    if (table) return `${table}_${formatLocalDate(date)}.${extension}`;
    return `result_${formatLocalDate(date)}_${formatLocalTime(date)}.${extension}`;
}
