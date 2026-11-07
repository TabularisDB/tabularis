import {scanNonCodeSpans, type DialectInput} from './sqlSplitter';

export type SqlDialectScope = 'all' | 'postgres' | 'mysql' | 'sqlite';

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
 * Normalizes driver/dialect string to standard scope.
 */
export function normalizeDriverToDialect(driverOrDialect: unknown): SqlDialectScope {
    if (!driverOrDialect) return 'all';
    let str = '';
    if (typeof driverOrDialect === 'string') {
        str = driverOrDialect.toLowerCase();
    } else if (typeof driverOrDialect === 'object') {
        const obj = driverOrDialect as Record<string, unknown>;
        if (typeof obj.driver === 'string') {
            str = obj.driver.toLowerCase();
        } else if (typeof obj.dialect === 'string') {
            str = obj.dialect.toLowerCase();
        }
    }
    if (str.includes('postgres') || str === 'pg' || str.startsWith('pg_') || str.startsWith('pg-'))
        return 'postgres';
    if (str.includes('mysql') || str.includes('mariadb')) return 'mysql';
    if (str.includes('sqlite')) return 'sqlite';
    return 'all';
}

/**
 * Check whether a snippet matches the current active database dialect.
 */
export function isSnippetDialectCompatible(
    snippetDialect: SqlDialectScope | undefined,
    currentDialect: SqlDialectScope,
): boolean {
    if (!snippetDialect || snippetDialect === 'all') return true;
    if (currentDialect === 'all') return true;
    return snippetDialect === currentDialect;
}

/**
 * Checks if a given text offset falls within a string literal or comment.
 */
export function isOffsetInCommentOrString(
    sqlText: string,
    offset: number,
    dialect?: DialectInput,
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

/**
 * Load snippets from localStorage. Initializes with defaults if none exist.
 */
export function loadSqlSnippets(): SqlSnippet[] {
    try {
        const raw = localStorage.getItem(SQL_SNIPPETS_STORAGE_KEY);
        if (!raw) {
            saveSqlSnippets(DEFAULT_SQL_SNIPPETS);
            return DEFAULT_SQL_SNIPPETS.map((s) => ({...s}));
        }
        const parsed = JSON.parse(raw) as SqlSnippetsStorage;
        if (
            parsed &&
            typeof parsed === 'object' &&
            parsed.version === CURRENT_STORAGE_VERSION &&
            Array.isArray(parsed.snippets)
        ) {
            const valid = parsed.snippets.filter(isValidSqlSnippet);
            if (valid.length > 0) {
                return valid.map((s) => ({...s}));
            }
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
        localStorage.setItem(SQL_SNIPPETS_STORAGE_KEY, JSON.stringify(payload));
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
