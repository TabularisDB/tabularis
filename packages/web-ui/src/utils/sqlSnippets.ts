import {scanNonCodeSpans, type DialectInput} from './sqlSplitter';

export type SqlDialectScope =
    'all' | 'postgres' | 'mysql' | 'sqlite' | 'oracle' | 'mssql' | `driver:${string}`;

export interface SqlSnippet {
    id: string;
    name: string;
    prefix: string;
    body: string;
    description?: string;
    dialect?: SqlDialectScope;
    createdAt: string;
    updatedAt: string;
}

export interface SqlSnippetsStorage {
    version: number;
    snippets: SqlSnippet[];
}

export const SQL_SNIPPETS_STORAGE_KEY = 'tabularis.sql_snippets.v1';
export const CURRENT_STORAGE_VERSION = 1;

/**
 * Built-in default snippets to provide out-of-the-box productivity.
 */
export const DEFAULT_SQL_SNIPPETS: SqlSnippet[] = [
    {
        id: 'default-select-from',
        name: 'Select From',
        prefix: 'sel',
        body: 'SELECT ${1:*} FROM ${2:table_name} WHERE ${3:condition};',
        description: 'Standard SELECT query with WHERE clause',
        dialect: 'all',
        createdAt: '2026-11-07T00:00:00.000Z',
        updatedAt: '2026-11-07T00:00:00.000Z',
    },
    {
        id: 'default-join',
        name: 'Inner Join',
        prefix: 'join',
        body: 'INNER JOIN ${1:other_table} ON ${1:other_table}.${2:id} = ${3:base_table}.${2:id}',
        description: 'Standard INNER JOIN clause with table equality',
        dialect: 'all',
        createdAt: '2026-11-07T00:00:00.000Z',
        updatedAt: '2026-11-07T00:00:00.000Z',
    },
    {
        id: 'default-insert-into',
        name: 'Insert Into',
        prefix: 'ins',
        body: 'INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values});',
        description: 'Standard INSERT statement',
        dialect: 'all',
        createdAt: '2026-11-07T00:00:00.000Z',
        updatedAt: '2026-11-07T00:00:00.000Z',
    },
    {
        id: 'default-cte',
        name: 'Common Table Expression (CTE)',
        prefix: 'with',
        body: 'WITH ${1:cte_name} AS (\n    SELECT ${2:*}\n    FROM ${3:table_name}\n)\nSELECT * FROM ${1:cte_name};',
        description: 'WITH cte_name AS (...) query skeleton',
        dialect: 'all',
        createdAt: '2026-11-07T00:00:00.000Z',
        updatedAt: '2026-11-07T00:00:00.000Z',
    },
];

/**
 * Validate a snippet trigger prefix: non-empty, alphanumeric with underscores/hyphens.
 */
export function validateSnippetPrefix(prefix: string): {valid: boolean; reason?: string} {
    const trimmed = (prefix ?? '').trim();
    if (!trimmed) {
        return {valid: false, reason: 'Prefix cannot be empty'};
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return {
            valid: false,
            reason: 'Prefix must contain only letters, numbers, underscores, and hyphens',
        };
    }
    return {valid: true};
}

/**
 * Validate a snippet body: non-empty string.
 */
export function validateSnippetBody(body: string): {valid: boolean; reason?: string} {
    if (!body || body.trim().length === 0) {
        return {valid: false, reason: 'Snippet body cannot be empty'};
    }
    return {valid: true};
}

/**
 * Normalizes driver/dialect/capabilities to standard snippet dialect scope.
 */
export function normalizeDriverToDialect(driverOrCapabilities: unknown): SqlDialectScope {
    if (!driverOrCapabilities) return 'all';
    let raw = '';
    if (typeof driverOrCapabilities === 'string') {
        raw = driverOrCapabilities;
    } else if (typeof driverOrCapabilities === 'object') {
        const obj = driverOrCapabilities as Record<string, unknown>;
        const caps = (
            obj.capabilities && typeof obj.capabilities === 'object' ? obj.capabilities : obj
        ) as Record<string, unknown>;

        const syntax = (
            caps.sql_syntax && typeof caps.sql_syntax === 'object' ? caps.sql_syntax : undefined
        ) as Record<string, unknown> | undefined;

        if (typeof syntax?.extends === 'string') {
            raw = syntax.extends;
        } else if (typeof caps.sql_dialect === 'string') {
            raw = caps.sql_dialect;
        } else if (typeof obj.driver === 'string') {
            raw = obj.driver;
        } else if (typeof obj.dialect === 'string') {
            raw = obj.dialect;
        }
    }
    const str = raw.toLowerCase().trim();
    if (
        str.includes('postgres') ||
        str === 'pg' ||
        str.startsWith('pg_') ||
        str.startsWith('pg-')
    ) {
        return 'postgres';
    }
    if (str.includes('mysql') || str.includes('mariadb')) {
        return 'mysql';
    }
    if (str.includes('sqlite')) {
        return 'sqlite';
    }
    if (str === 'oracle') return 'oracle';
    if (str === 'mssql') return 'mssql';
    return 'all';
}

/**
 * Check whether a snippet matches the current active database dialect.
 * Generic snippets ('all' or undefined) match every dialect.
 * Database-specific snippets ('postgres', 'mysql', 'sqlite') require an exact match,
 * so unknown/generic dialects ('all') do NOT offer database-specific snippets.
 */
export function isSnippetDialectCompatible(
    snippetDialect: SqlDialectScope | undefined,
    currentDialect: SqlDialectScope,
    driverId?: string | null,
): boolean {
    if (snippetDialect?.startsWith('driver:')) return snippetDialect === `driver:${driverId}`;
    if (!snippetDialect || snippetDialect === 'all') return true;
    return snippetDialect === currentDialect;
}

/**
 * Checks if a given text offset falls within a string literal or comment.
 */
export function isOffsetInCommentOrString(
    sqlText: string,
    offset: number,
    dialect?: DialectInput | null,
): boolean {
    if (offset < 0 || offset > sqlText.length) return false;
    const effectiveDialect: DialectInput = dialect || 'generic';
    const spans = scanNonCodeSpans(sqlText, effectiveDialect);
    for (const span of spans) {
        if (offset >= span.start && offset < span.end) {
            return true;
        }
    }
    return false;
}

/**
 * Validates a snippet item loaded from persistence or external source.
 */
export function isValidSqlSnippet(candidate: unknown): candidate is SqlSnippet {
    if (!candidate || typeof candidate !== 'object') return false;
    const c = candidate as Record<string, unknown>;
    return (
        typeof c.id === 'string' &&
        c.id.length > 0 &&
        typeof c.name === 'string' &&
        typeof c.prefix === 'string' &&
        validateSnippetPrefix(c.prefix).valid &&
        typeof c.body === 'string' &&
        validateSnippetBody(c.body).valid
    );
}

let cachedRawSnippets: string | null = null;
let cachedParsedSnippets: SqlSnippet[] | null = null;

export function resetSqlSnippetsCache(): void {
    cachedRawSnippets = null;
    cachedParsedSnippets = null;
}

/**
 * Load snippets from localStorage. Initializes with defaults if none exist.
 * Caches the parsed array keyed by the raw serialized payload to avoid
 * repeated JSON parsing on every keystroke in autocomplete.
 */
export function loadSqlSnippets(): SqlSnippet[] {
    try {
        const raw = localStorage.getItem(SQL_SNIPPETS_STORAGE_KEY);
        if (!raw) {
            saveSqlSnippets(DEFAULT_SQL_SNIPPETS);
            return DEFAULT_SQL_SNIPPETS.map((s) => ({...s}));
        }
        if (raw === cachedRawSnippets && cachedParsedSnippets) {
            return cachedParsedSnippets.map((s) => ({...s}));
        }
        const parsed = JSON.parse(raw) as SqlSnippetsStorage;
        if (
            parsed &&
            typeof parsed === 'object' &&
            parsed.version === CURRENT_STORAGE_VERSION &&
            Array.isArray(parsed.snippets)
        ) {
            const valid = parsed.snippets.filter(isValidSqlSnippet);
            cachedRawSnippets = raw;
            cachedParsedSnippets = valid.map((s) => ({...s}));
            return cachedParsedSnippets.map((s) => ({...s}));
        }
        return DEFAULT_SQL_SNIPPETS.map((s) => ({...s}));
    } catch (e) {
        console.warn('Failed to load SQL snippets from storage, falling back to defaults', e);
        return DEFAULT_SQL_SNIPPETS.map((s) => ({...s}));
    }
}

/**
 * Save snippets to localStorage.
 */
export function saveSqlSnippets(snippets: SqlSnippet[]): void {
    try {
        const payload: SqlSnippetsStorage = {
            version: CURRENT_STORAGE_VERSION,
            snippets,
        };
        const serialized = JSON.stringify(payload);
        localStorage.setItem(SQL_SNIPPETS_STORAGE_KEY, serialized);
        cachedRawSnippets = serialized;
        cachedParsedSnippets = snippets.map((s) => ({...s}));
    } catch (e) {
        console.error('Failed to save SQL snippets to storage', e);
    }
}

/**
 * Adds or updates a snippet.
 */
export function upsertSqlSnippet(
    snippet: Omit<SqlSnippet, 'id' | 'createdAt' | 'updatedAt'> & {id?: string},
): SqlSnippet {
    const list = loadSqlSnippets();
    const now = new Date().toISOString();

    if (snippet.id) {
        const idx = list.findIndex((s) => s.id === snippet.id);
        if (idx !== -1) {
            const updated: SqlSnippet = {
                ...list[idx],
                ...snippet,
                id: snippet.id,
                updatedAt: now,
            };
            list[idx] = updated;
            saveSqlSnippets(list);
            return updated;
        }
    }

    const created: SqlSnippet = {
        ...snippet,
        id: snippet.id || `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now,
        updatedAt: now,
    };
    list.push(created);
    saveSqlSnippets(list);
    return created;
}

/**
 * Deletes a snippet by id.
 */
export function deleteSqlSnippet(id: string): void {
    const list = loadSqlSnippets();
    const filtered = list.filter((s) => s.id !== id);
    saveSqlSnippets(filtered);
}
