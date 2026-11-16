import type {
    QueryHistoryEntry,
    QueryHistoryInsightsResponse,
    QueryHistoryInsightsWindowPreset,
    QueryHistoryRegressionStatus,
    QueryHistoryShapeInsight,
} from '@/types/queryHistory';

export type {QueryHistoryInsightsWindowPreset};
export type QueryHistoryInsightsSortField =
    'regressionsFirst' | 'totalDuration' | 'avgDuration' | 'callCount';

/**
 * Minimum timed executions required in BOTH the current and prior periods
 * before a query shape can be flagged as a performance regression.
 */
export const MIN_REGRESSION_SAMPLES = 3;

/**
 * Minimum absolute increase in average recorded duration (milliseconds)
 * required before flagging a regression.
 */
export const MIN_REGRESSION_DELTA_MS = 10;

/**
 * Minimum relative increase in average recorded duration (+25%)
 * required before flagging a regression.
 */
export const MIN_REGRESSION_RATIO = 0.25;

export const QUERY_HISTORY_INSIGHTS_WINDOW_OPTIONS: readonly QueryHistoryInsightsWindowPreset[] = [
    'last24Hours',
    'last7Days',
    'last30Days',
] as const;

export const QUERY_HISTORY_INSIGHTS_SORT_OPTIONS: readonly QueryHistoryInsightsSortField[] = [
    'regressionsFirst',
    'totalDuration',
    'avgDuration',
    'callCount',
] as const;

export function windowHoursForPreset(preset: QueryHistoryInsightsWindowPreset): number {
    switch (preset) {
        case 'last24Hours':
            return 24;
        case 'last7Days':
            return 168;
        case 'last30Days':
            return 720;
    }
}

type InsightsDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'oracle' | 'generic';

function resolveDialect(raw?: string | null): InsightsDialect {
    const name = raw?.trim().toLowerCase() ?? '';
    if (!name) return 'postgres';
    if (['mysql', 'mariadb', 'tidb', 'singlestoredb'].includes(name)) return 'mysql';
    if (name === 'sqlite' || name === 'sqlite3') return 'sqlite';
    if (['mssql', 'sqlserver', 'transactsql'].includes(name)) return 'mssql';
    if (name === 'oracle' || name === 'plsql') return 'oracle';
    if (name === 'generic' || name === 'sql') return 'generic';
    return 'postgres';
}

const SQL_KEYWORDS = new Set([
    'SELECT',
    'FROM',
    'WHERE',
    'JOIN',
    'LEFT',
    'RIGHT',
    'INNER',
    'OUTER',
    'FULL',
    'CROSS',
    'NATURAL',
    'ON',
    'USING',
    'AND',
    'OR',
    'NOT',
    'IN',
    'EXISTS',
    'BETWEEN',
    'LIKE',
    'ILIKE',
    'SIMILAR',
    'IS',
    'NULL',
    'AS',
    'DISTINCT',
    'ALL',
    'GROUP',
    'BY',
    'HAVING',
    'ORDER',
    'ASC',
    'DESC',
    'NULLS',
    'FIRST',
    'LAST',
    'LIMIT',
    'OFFSET',
    'FETCH',
    'NEXT',
    'ROWS',
    'ONLY',
    'INSERT',
    'INTO',
    'VALUES',
    'DEFAULT',
    'UPDATE',
    'SET',
    'DELETE',
    'RETURNING',
    'WITH',
    'RECURSIVE',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'CAST',
    'OVER',
    'PARTITION',
    'WINDOW',
    'FILTER',
    'CREATE',
    'ALTER',
    'DROP',
    'TABLE',
    'VIEW',
    'INDEX',
    'TRIGGER',
    'EXPLAIN',
    'ANALYZE',
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'TRANSACTION',
    'PRAGMA',
    'SHOW',
    'DESCRIBE',
    'USE',
    'CONFLICT',
    'DO',
    'NOTHING',
    'FOR',
    'SHARE',
    'NOWAIT',
    'SKIP',
    'LOCKED',
    'TOP',
]);

type SqlToken =
    | {kind: 'keyword'; text: string}
    | {kind: 'identifier'; text: string}
    | {kind: 'literal'; text: string}
    | {kind: 'operator'; text: string}
    | {kind: 'lparen'}
    | {kind: 'rparen'}
    | {kind: 'comma'}
    | {kind: 'dot'}
    | {kind: 'semicolon'};

function isAsciiWhitespace(code: number): boolean {
    return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function isAsciiAlpha(code: number): boolean {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(code: number): boolean {
    return code >= 48 && code <= 57;
}

function isAsciiHexDigit(code: number): boolean {
    return isAsciiDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function isAsciiAlnum(code: number): boolean {
    return isAsciiAlpha(code) || isAsciiDigit(code);
}

function matchDollarQuoteTag(sql: string, start: number): number | null {
    if (sql.charCodeAt(start) !== 36 /* $ */) return null;
    let i = start + 1;
    if (i < sql.length && sql.charCodeAt(i) === 36) return 2;
    if (i >= sql.length) return null;
    const first = sql.charCodeAt(i);
    if (!isAsciiAlpha(first) && first !== 95 /* _ */) return null;
    i += 1;
    while (i < sql.length) {
        const c = sql.charCodeAt(i);
        if (!isAsciiAlnum(c) && c !== 95) break;
        i += 1;
    }
    return i < sql.length && sql.charCodeAt(i) === 36 ? i + 1 - start : null;
}

/**
 * Normalizes a SQL statement into a canonical query shape fingerprint using a
 * documented dialect-aware policy:
 * - Strips line comments (`--`, plus `#` in MySQL; respects MySQL `-- ` whitespace rule)
 *   and block comments (`/* ... * /`, with nested block comments in Postgres/MSSQL).
 * - Replaces string literals (`'...'`, Postgres `E'...'` and `$$...$$`, MySQL `"..."`)
 *   with `'?'` and numeric/hex/bit/boolean literals with `?`.
 * - Preserves SQL structure, statement verbs (`SELECT` vs `UPDATE` vs `DELETE`),
 *   table/column identifiers, and dialect-quoted identifiers (`"..."` outside MySQL,
 *   `` `...` `` in MySQL/SQLite, `[...]` in MSSQL/SQLite).
 * - Collapses literal-only `IN (?, ?, ...)` lists to `IN (?+)`.
 */
export function normalizeSqlForInsights(sql: string, dialect?: string | null): string {
    const resolvedDialect = resolveDialect(dialect);
    const len = sql.length;
    let i = 0;
    const rawTokens: SqlToken[] = [];

    while (i < len) {
        const code = sql.charCodeAt(i);

        // 1. Whitespace
        if (isAsciiWhitespace(code)) {
            i += 1;
            continue;
        }

        // 2. Line comments: `--`
        if (code === 45 /* - */ && i + 1 < len && sql.charCodeAt(i + 1) === 45) {
            const isComment =
                resolvedDialect === 'mysql'
                    ? i + 2 >= len ||
                      isAsciiWhitespace(sql.charCodeAt(i + 2)) ||
                      sql.charCodeAt(i + 2) < 32
                    : true;
            if (isComment) {
                i += 2;
                while (i < len && sql.charCodeAt(i) !== 10 && sql.charCodeAt(i) !== 13) {
                    i += 1;
                }
                continue;
            }
        }

        // 3. MySQL `#` line comment
        if (code === 35 /* # */ && resolvedDialect === 'mysql') {
            i += 1;
            while (i < len && sql.charCodeAt(i) !== 10) {
                i += 1;
            }
            continue;
        }

        // 4. Block comments `/* ... */`
        if (code === 47 /* / */ && i + 1 < len && sql.charCodeAt(i + 1) === 42 /* * */) {
            const nested = resolvedDialect === 'postgres' || resolvedDialect === 'mssql';
            i += 2;
            let depth = 1;
            while (i < len && depth > 0) {
                if (
                    nested &&
                    i + 1 < len &&
                    sql.charCodeAt(i) === 47 &&
                    sql.charCodeAt(i + 1) === 42
                ) {
                    depth += 1;
                    i += 2;
                } else if (
                    i + 1 < len &&
                    sql.charCodeAt(i) === 42 &&
                    sql.charCodeAt(i + 1) === 47
                ) {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        // 5. Postgres dollar-quoted strings and `$1` positional parameters
        if (code === 36 /* $ */ && resolvedDialect === 'postgres') {
            const tagLen = matchDollarQuoteTag(sql, i);
            if (tagLen !== null) {
                const tag = sql.slice(i, i + tagLen);
                i += tagLen;
                const closeIdx = sql.indexOf(tag, i);
                i = closeIdx >= 0 ? closeIdx + tagLen : len;
                rawTokens.push({kind: 'literal', text: "'?'"});
                continue;
            }
            if (i + 1 < len && isAsciiDigit(sql.charCodeAt(i + 1))) {
                const start = i;
                i += 1;
                while (i < len && isAsciiDigit(sql.charCodeAt(i))) {
                    i += 1;
                }
                rawTokens.push({kind: 'identifier', text: sql.slice(start, i)});
                continue;
            }
        }

        // 6. Prefixed string or hex/bit literals: E'...', N'...', X'...', B'...'
        const lowerChar = code | 32;
        if (
            (lowerChar === 101 /* e */ ||
                lowerChar === 110 /* n */ ||
                lowerChar === 120 /* x */ ||
                lowerChar === 98) /* b */ &&
            i + 1 < len &&
            sql.charCodeAt(i + 1) === 39 /* ' */ &&
            (i === 0 || !(isAsciiAlnum(sql.charCodeAt(i - 1)) || sql.charCodeAt(i - 1) === 95))
        ) {
            const backslashEscape =
                (lowerChar === 101 && resolvedDialect === 'postgres') ||
                resolvedDialect === 'mysql';
            i += 2;
            while (i < len) {
                if (backslashEscape && sql.charCodeAt(i) === 92 /* \ */) {
                    i = Math.min(len, i + 2);
                    continue;
                }
                if (sql.charCodeAt(i) === 39) {
                    if (i + 1 < len && sql.charCodeAt(i + 1) === 39) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            rawTokens.push({
                kind: 'literal',
                text: lowerChar === 120 || lowerChar === 98 ? '?' : "'?'",
            });
            continue;
        }

        // 7. Single-quoted string literal `'...'`
        if (code === 39 /* ' */) {
            const backslashEscape = resolvedDialect === 'mysql';
            i += 1;
            while (i < len) {
                if (backslashEscape && sql.charCodeAt(i) === 92) {
                    i = Math.min(len, i + 2);
                    continue;
                }
                if (sql.charCodeAt(i) === 39) {
                    if (i + 1 < len && sql.charCodeAt(i + 1) === 39) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            rawTokens.push({kind: 'literal', text: "'?'"});
            continue;
        }

        // 8. Double-quoted string (MySQL) or identifier (all other dialects)
        if (code === 34 /* " */) {
            const start = i;
            const isMysqlString = resolvedDialect === 'mysql';
            i += 1;
            while (i < len) {
                if (isMysqlString && sql.charCodeAt(i) === 92) {
                    i = Math.min(len, i + 2);
                    continue;
                }
                if (sql.charCodeAt(i) === 34) {
                    if (i + 1 < len && sql.charCodeAt(i + 1) === 34) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            if (isMysqlString) {
                rawTokens.push({kind: 'literal', text: "'?'"});
            } else {
                rawTokens.push({kind: 'identifier', text: sql.slice(start, i)});
            }
            continue;
        }

        // 9. Backtick-quoted identifier `` `...` ``
        if (code === 96 /* ` */) {
            const start = i;
            i += 1;
            while (i < len) {
                if (sql.charCodeAt(i) === 96) {
                    if (i + 1 < len && sql.charCodeAt(i + 1) === 96) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            rawTokens.push({kind: 'identifier', text: sql.slice(start, i)});
            continue;
        }

        // 10. Bracket-quoted identifier `[...]` (MSSQL / SQLite)
        if (code === 91 /* [ */ && (resolvedDialect === 'mssql' || resolvedDialect === 'sqlite')) {
            const start = i;
            i += 1;
            while (i < len) {
                if (sql.charCodeAt(i) === 93 /* ] */) {
                    if (
                        resolvedDialect === 'mssql' &&
                        i + 1 < len &&
                        sql.charCodeAt(i + 1) === 93
                    ) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            rawTokens.push({kind: 'identifier', text: sql.slice(start, i)});
            continue;
        }

        // 11. Numeric literals
        if (
            isAsciiDigit(code) ||
            (code === 46 /* . */ && i + 1 < len && isAsciiDigit(sql.charCodeAt(i + 1)))
        ) {
            if (
                code === 48 /* 0 */ &&
                i + 1 < len &&
                (sql.charCodeAt(i + 1) === 120 || sql.charCodeAt(i + 1) === 88)
            ) {
                i += 2;
                while (i < len && isAsciiHexDigit(sql.charCodeAt(i))) {
                    i += 1;
                }
                rawTokens.push({kind: 'literal', text: '?'});
                continue;
            }
            if (code === 46) {
                i += 1;
                while (i < len && isAsciiDigit(sql.charCodeAt(i))) {
                    i += 1;
                }
            } else {
                while (i < len && isAsciiDigit(sql.charCodeAt(i))) {
                    i += 1;
                }
                if (i < len && sql.charCodeAt(i) === 46) {
                    i += 1;
                    while (i < len && isAsciiDigit(sql.charCodeAt(i))) {
                        i += 1;
                    }
                }
            }
            if (i < len && (sql.charCodeAt(i) === 101 || sql.charCodeAt(i) === 69)) {
                let expI = i + 1;
                if (expI < len && (sql.charCodeAt(expI) === 43 || sql.charCodeAt(expI) === 45)) {
                    expI += 1;
                }
                if (expI < len && isAsciiDigit(sql.charCodeAt(expI))) {
                    i = expI + 1;
                    while (i < len && isAsciiDigit(sql.charCodeAt(i))) {
                        i += 1;
                    }
                }
            }
            rawTokens.push({kind: 'literal', text: '?'});
            continue;
        }

        // 12. Identifiers / Keywords / @variables
        if (isAsciiAlpha(code) || code === 95 /* _ */ || code === 64 /* @ */) {
            const start = i;
            i += 1;
            if (code === 64 && i < len && sql.charCodeAt(i) === 64) {
                i += 1;
            }
            while (i < len) {
                const c = sql.charCodeAt(i);
                if (!isAsciiAlnum(c) && c !== 95 && c !== 36) break;
                i += 1;
            }
            const word = sql.slice(start, i);
            if (code === 64) {
                rawTokens.push({kind: 'identifier', text: word.toLowerCase()});
            } else {
                const upper = word.toUpperCase();
                if (upper === 'TRUE' || upper === 'FALSE') {
                    rawTokens.push({kind: 'literal', text: '?'});
                } else if (SQL_KEYWORDS.has(upper)) {
                    rawTokens.push({kind: 'keyword', text: upper});
                } else {
                    rawTokens.push({kind: 'identifier', text: word.toLowerCase()});
                }
            }
            continue;
        }

        // 13. Punctuation & Operators
        if (code === 40 /* ( */) {
            rawTokens.push({kind: 'lparen'});
            i += 1;
        } else if (code === 41 /* ) */) {
            rawTokens.push({kind: 'rparen'});
            i += 1;
        } else if (code === 44 /* , */) {
            rawTokens.push({kind: 'comma'});
            i += 1;
        } else if (code === 46 /* . */) {
            rawTokens.push({kind: 'dot'});
            i += 1;
        } else if (code === 59 /* ; */) {
            rawTokens.push({kind: 'semicolon'});
            i += 1;
        } else if (code === 63 /* ? */) {
            rawTokens.push({kind: 'literal', text: '?'});
            i += 1;
        } else {
            const three = i + 2 < len ? sql.slice(i, i + 3) : '';
            const two = i + 1 < len ? sql.slice(i, i + 2) : '';
            if (three === '->>' || three === '#>>') {
                rawTokens.push({kind: 'operator', text: three});
                i += 3;
            } else if (['<=', '>=', '<>', '!=', '::', '||', '->', '#>', '@>', '<@'].includes(two)) {
                rawTokens.push({kind: 'operator', text: two});
                i += 2;
            } else {
                rawTokens.push({kind: 'operator', text: sql[i]});
                i += 1;
            }
        }
    }

    while (rawTokens.length > 0 && rawTokens[rawTokens.length - 1].kind === 'semicolon') {
        rawTokens.pop();
    }

    // Fold unary `+` / `-` before numeric `?` when preceded by an expression boundary
    const foldedTokens: SqlToken[] = [];
    let idx = 0;
    while (idx < rawTokens.length) {
        const cur = rawTokens[idx];
        const next = rawTokens[idx + 1];
        if (
            cur.kind === 'operator' &&
            (cur.text === '-' || cur.text === '+') &&
            next?.kind === 'literal' &&
            next.text === '?'
        ) {
            const prev = foldedTokens[foldedTokens.length - 1];
            const prevIsBoundary =
                !prev ||
                prev.kind === 'lparen' ||
                prev.kind === 'comma' ||
                prev.kind === 'semicolon' ||
                prev.kind === 'operator' ||
                (prev.kind === 'keyword' && prev.text !== 'END' && prev.text !== 'NULL');
            if (prevIsBoundary) {
                foldedTokens.push({kind: 'literal', text: '?'});
                idx += 2;
                continue;
            }
        }
        foldedTokens.push(cur);
        idx += 1;
    }

    // Collapse `IN (?, ?, ...)` literal-only lists into `IN (?+)`
    const tokens: SqlToken[] = [];
    let k = 0;
    while (k < foldedTokens.length) {
        const cur = foldedTokens[k];
        if (cur.kind === 'keyword' && cur.text === 'IN' && foldedTokens[k + 1]?.kind === 'lparen') {
            let cursor = k + 2;
            let literalCount = 0;
            let expectLiteral = true;
            let validList = false;
            while (cursor < foldedTokens.length) {
                const item = foldedTokens[cursor];
                if (
                    expectLiteral &&
                    item.kind === 'literal' &&
                    (item.text === '?' || item.text === "'?'")
                ) {
                    literalCount += 1;
                    expectLiteral = false;
                    cursor += 1;
                } else if (!expectLiteral && item.kind === 'comma') {
                    expectLiteral = true;
                    cursor += 1;
                } else if (!expectLiteral && literalCount > 0 && item.kind === 'rparen') {
                    validList = true;
                    break;
                } else {
                    break;
                }
            }
            if (validList) {
                tokens.push({kind: 'keyword', text: 'IN'});
                tokens.push({kind: 'lparen'});
                tokens.push({kind: 'literal', text: '?+'});
                tokens.push({kind: 'rparen'});
                k = cursor + 1;
                continue;
            }
        }
        tokens.push(cur);
        k += 1;
    }

    let out = '';
    for (let pos = 0; pos < tokens.length; pos++) {
        const tok = tokens[pos];
        const text =
            tok.kind === 'lparen'
                ? '('
                : tok.kind === 'rparen'
                  ? ')'
                  : tok.kind === 'comma'
                    ? ','
                    : tok.kind === 'dot'
                      ? '.'
                      : tok.kind === 'semicolon'
                        ? ';'
                        : tok.text;
        if (pos > 0) {
            const prev = tokens[pos - 1];
            const noSpaceBefore =
                tok.kind === 'comma' ||
                tok.kind === 'rparen' ||
                tok.kind === 'semicolon' ||
                tok.kind === 'dot' ||
                (tok.kind === 'operator' && tok.text === '::');
            const noSpaceAfter =
                prev.kind === 'lparen' ||
                prev.kind === 'dot' ||
                (prev.kind === 'operator' && prev.text === '::');
            if (!noSpaceBefore && !noSpaceAfter) {
                out += ' ';
            }
        }
        out += text;
    }

    return out;
}

export function extractStatementKind(normalizedSql: string): string {
    const first = normalizedSql
        .trim()
        .split(/\s+/)[0]
        ?.replace(/[^A-Za-z]/g, '')
        .toUpperCase();
    return first || 'OTHER';
}

export interface RegressionEvaluation {
    deltaAvgMs: number | null;
    relativeDeltaAvg: number | null;
    isRegressed: boolean;
    regressionStatus: QueryHistoryRegressionStatus;
}

export function evaluateQueryShapeRegression(
    currentTimedSamples: number,
    currentAvgMs: number | null,
    priorTimedSamples: number,
    priorAvgMs: number | null,
): RegressionEvaluation {
    if (currentAvgMs === null || priorAvgMs === null) {
        return {
            deltaAvgMs: null,
            relativeDeltaAvg: null,
            isRegressed: false,
            regressionStatus: 'insufficientSamples',
        };
    }

    const deltaAvgMs = currentAvgMs - priorAvgMs;
    const rawRel = priorAvgMs > 0 ? deltaAvgMs / priorAvgMs : deltaAvgMs > 0 ? Infinity : 0;
    const relativeDeltaAvg = Number.isFinite(rawRel) ? rawRel : null;

    if (
        currentTimedSamples < MIN_REGRESSION_SAMPLES ||
        priorTimedSamples < MIN_REGRESSION_SAMPLES
    ) {
        return {
            deltaAvgMs,
            relativeDeltaAvg,
            isRegressed: false,
            regressionStatus: 'insufficientSamples',
        };
    }

    if (deltaAvgMs >= MIN_REGRESSION_DELTA_MS && rawRel >= MIN_REGRESSION_RATIO) {
        return {
            deltaAvgMs,
            relativeDeltaAvg,
            isRegressed: true,
            regressionStatus: 'regressed',
        };
    }

    if (deltaAvgMs <= -MIN_REGRESSION_DELTA_MS && rawRel <= -MIN_REGRESSION_RATIO) {
        return {
            deltaAvgMs,
            relativeDeltaAvg,
            isRegressed: false,
            regressionStatus: 'improved',
        };
    }

    return {
        deltaAvgMs,
        relativeDeltaAvg,
        isRegressed: false,
        regressionStatus: 'stable',
    };
}

export interface ComputeQueryHistoryInsightsOptions {
    database?: string | null;
    windowHours?: number;
    dialect?: string | null;
    now?: Date | number | string;
    maxStoredExecutions?: number;
    maxGroups?: number;
    maxExecutionsPerGroup?: number;
}

function matchesDatabaseFilter(entryDb: string | null, filter?: string | null): boolean {
    const raw = filter?.trim() ?? '';
    if (!raw || raw === 'all') return true;
    const recorded = entryDb?.trim() ? entryDb.trim() : null;
    if (raw === 'none') return recorded === null;
    const expected = raw.startsWith('db:') ? raw.slice(3) : raw;
    return recorded === expected;
}

/**
 * Pure frontend counterpart of the backend insights aggregator, used for
 * deterministic unit tests and fallback/offline computation.
 */
export function computeQueryHistoryInsights(
    entries: readonly QueryHistoryEntry[],
    options: ComputeQueryHistoryInsightsOptions = {},
): QueryHistoryInsightsResponse {
    const {
        database = 'all',
        windowHours = 168,
        dialect = 'postgres',
        now = Date.now(),
        maxStoredExecutions = 500,
        maxGroups = 100,
        maxExecutionsPerGroup = 20,
    } = options;

    const nowMs =
        typeof now === 'number'
            ? now
            : typeof now === 'string'
              ? new Date(now).getTime()
              : now.getTime();
    const clampedHours = Math.max(1, Math.min(24 * 365, Math.trunc(windowHours)));
    const windowMs = clampedHours * 3600 * 1000;
    const currentStartMs = nowMs - windowMs;
    const priorStartMs = currentStartMs - windowMs;

    const totalStoredExecutions = entries.length;
    const retentionCapReached =
        maxStoredExecutions > 0 && totalStoredExecutions >= maxStoredExecutions;

    let oldestMs: number | null = null;
    for (const entry of entries) {
        const ts = new Date(entry.executedAt).getTime();
        if (!Number.isNaN(ts)) {
            oldestMs = oldestMs === null ? ts : Math.min(oldestMs, ts);
        }
    }
    const oldestRecordedAt = oldestMs !== null ? new Date(oldestMs).toISOString() : null;
    const priorWindowFullyCovered = retentionCapReached
        ? oldestMs !== null && oldestMs <= priorStartMs
        : true;

    let currentWindowExecutions = 0;
    let currentWindowMissingDurationCount = 0;
    let priorWindowExecutions = 0;
    let priorWindowMissingDurationCount = 0;

    interface PeriodAcc {
        callCount: number;
        timedSampleCount: number;
        missingDurationCount: number;
        totalDurationMs: number;
        maxDurationMs: number | null;
        failureCount: number;
    }

    interface GroupAcc {
        fingerprint: string;
        exampleSql: string;
        statementKind: string;
        databases: Set<string>;
        hasUnrecordedDatabase: boolean;
        lastExecutedAt: string;
        lastExecutedMs: number;
        current: PeriodAcc;
        prior: PeriodAcc;
        contributing: Array<{ts: number; entry: QueryHistoryEntry}>;
    }

    const makePeriod = (): PeriodAcc => ({
        callCount: 0,
        timedSampleCount: 0,
        missingDurationCount: 0,
        totalDurationMs: 0,
        maxDurationMs: null,
        failureCount: 0,
    });

    const recordPeriod = (acc: PeriodAcc, entry: QueryHistoryEntry) => {
        acc.callCount += 1;
        if (entry.status !== 'success') {
            acc.failureCount += 1;
        }
        const ms = entry.executionTimeMs;
        if (ms !== null && Number.isFinite(ms) && ms >= 0) {
            acc.timedSampleCount += 1;
            acc.totalDurationMs += ms;
            acc.maxDurationMs = acc.maxDurationMs === null ? ms : Math.max(acc.maxDurationMs, ms);
        } else {
            acc.missingDurationCount += 1;
        }
    };

    const groupsMap = new Map<string, GroupAcc>();

    for (const entry of entries) {
        if (!matchesDatabaseFilter(entry.database, database)) continue;
        const ts = new Date(entry.executedAt).getTime();
        if (Number.isNaN(ts) || ts > nowMs || ts < priorStartMs) continue;

        const inCurrent = ts >= currentStartMs;
        const fingerprint = normalizeSqlForInsights(entry.sql, dialect);
        if (!fingerprint) continue;

        const missingDuration = !(
            entry.executionTimeMs !== null &&
            Number.isFinite(entry.executionTimeMs) &&
            entry.executionTimeMs >= 0
        );

        if (inCurrent) {
            currentWindowExecutions += 1;
            if (missingDuration) currentWindowMissingDurationCount += 1;
        } else {
            priorWindowExecutions += 1;
            if (missingDuration) priorWindowMissingDurationCount += 1;
        }

        let group = groupsMap.get(fingerprint);
        if (!group) {
            group = {
                fingerprint,
                exampleSql: entry.sql,
                statementKind: extractStatementKind(fingerprint),
                databases: new Set<string>(),
                hasUnrecordedDatabase: false,
                lastExecutedAt: entry.executedAt,
                lastExecutedMs: ts,
                current: makePeriod(),
                prior: makePeriod(),
                contributing: [],
            };
            groupsMap.set(fingerprint, group);
        }

        if (ts > group.lastExecutedMs) {
            group.lastExecutedMs = ts;
            group.lastExecutedAt = entry.executedAt;
            group.exampleSql = entry.sql;
        }

        const db = entry.database?.trim();
        if (db) {
            group.databases.add(db);
        } else {
            group.hasUnrecordedDatabase = true;
        }

        if (inCurrent) {
            recordPeriod(group.current, entry);
            group.contributing.push({ts, entry});
        } else {
            recordPeriod(group.prior, entry);
        }
    }

    const groups: QueryHistoryShapeInsight[] = [];
    for (const g of groupsMap.values()) {
        if (g.current.callCount === 0) continue;
        g.contributing.sort((a, b) => b.ts - a.ts || a.entry.id.localeCompare(b.entry.id));

        const avgDurationMs =
            g.current.timedSampleCount > 0
                ? g.current.totalDurationMs / g.current.timedSampleCount
                : null;
        const priorAvgDurationMs =
            g.prior.timedSampleCount > 0
                ? g.prior.totalDurationMs / g.prior.timedSampleCount
                : null;

        const evalResult = evaluateQueryShapeRegression(
            g.current.timedSampleCount,
            avgDurationMs,
            g.prior.timedSampleCount,
            priorAvgDurationMs,
        );

        groups.push({
            fingerprint: g.fingerprint,
            exampleSql: g.exampleSql,
            statementKind: g.statementKind,
            databases: [...g.databases].sort((a, b) => a.localeCompare(b, 'en')),
            hasUnrecordedDatabase: g.hasUnrecordedDatabase,
            lastExecutedAt: g.lastExecutedAt,
            callCount: g.current.callCount,
            timedSampleCount: g.current.timedSampleCount,
            missingDurationCount: g.current.missingDurationCount,
            totalDurationMs: g.current.totalDurationMs,
            avgDurationMs,
            maxDurationMs: g.current.maxDurationMs,
            failureCount: g.current.failureCount,
            failureRate: g.current.callCount > 0 ? g.current.failureCount / g.current.callCount : 0,
            priorCallCount: g.prior.callCount,
            priorTimedSampleCount: g.prior.timedSampleCount,
            priorMissingDurationCount: g.prior.missingDurationCount,
            priorTotalDurationMs: g.prior.totalDurationMs,
            priorAvgDurationMs,
            priorFailureCount: g.prior.failureCount,
            priorFailureRate: g.prior.callCount > 0 ? g.prior.failureCount / g.prior.callCount : 0,
            deltaAvgMs: evalResult.deltaAvgMs,
            relativeDeltaAvg: evalResult.relativeDeltaAvg,
            isRegressed: evalResult.isRegressed,
            regressionStatus: evalResult.regressionStatus,
            contributingExecutions: g.contributing
                .slice(0, maxExecutionsPerGroup)
                .map((item) => item.entry),
        });
    }

    groups.sort(
        (a, b) =>
            Number(b.isRegressed) - Number(a.isRegressed) ||
            b.totalDurationMs - a.totalDurationMs ||
            b.callCount - a.callCount ||
            a.fingerprint.localeCompare(b.fingerprint),
    );

    return {
        groups: groups.slice(0, maxGroups),
        coverage: {
            currentWindowStart: new Date(currentStartMs).toISOString(),
            currentWindowEnd: new Date(nowMs).toISOString(),
            priorWindowStart: new Date(priorStartMs).toISOString(),
            priorWindowEnd: new Date(currentStartMs).toISOString(),
            totalStoredExecutions,
            maxStoredExecutions,
            retentionCapReached,
            oldestRecordedAt,
            priorWindowFullyCovered,
            currentWindowExecutions,
            currentWindowMissingDurationCount,
            priorWindowExecutions,
            priorWindowMissingDurationCount,
        },
        policy: {
            minRegressionSamples: MIN_REGRESSION_SAMPLES,
            minRegressionDeltaMs: MIN_REGRESSION_DELTA_MS,
            minRegressionRatio: MIN_REGRESSION_RATIO,
            timingSource: 'client-observed',
        },
    };
}

export function sortAndFilterInsightGroups(
    groups: readonly QueryHistoryShapeInsight[],
    options: {
        search?: string;
        regressionsOnly?: boolean;
        sortBy?: QueryHistoryInsightsSortField;
    } = {},
): QueryHistoryShapeInsight[] {
    const {search = '', regressionsOnly = false, sortBy = 'regressionsFirst'} = options;
    const trimmed = search.trim().toLowerCase();

    const filtered = groups.filter((group) => {
        if (regressionsOnly && !group.isRegressed) return false;
        if (!trimmed) return true;
        return (
            group.fingerprint.toLowerCase().includes(trimmed) ||
            group.exampleSql.toLowerCase().includes(trimmed)
        );
    });

    return [...filtered].sort((a, b) => {
        if (sortBy === 'totalDuration') {
            return (
                b.totalDurationMs - a.totalDurationMs ||
                b.callCount - a.callCount ||
                a.fingerprint.localeCompare(b.fingerprint)
            );
        }
        if (sortBy === 'avgDuration') {
            return (
                (b.avgDurationMs ?? -1) - (a.avgDurationMs ?? -1) ||
                b.callCount - a.callCount ||
                a.fingerprint.localeCompare(b.fingerprint)
            );
        }
        if (sortBy === 'callCount') {
            return (
                b.callCount - a.callCount ||
                b.totalDurationMs - a.totalDurationMs ||
                a.fingerprint.localeCompare(b.fingerprint)
            );
        }
        return (
            Number(b.isRegressed) - Number(a.isRegressed) ||
            (b.deltaAvgMs ?? -Infinity) - (a.deltaAvgMs ?? -Infinity) ||
            b.totalDurationMs - a.totalDurationMs ||
            a.fingerprint.localeCompare(b.fingerprint)
        );
    });
}
