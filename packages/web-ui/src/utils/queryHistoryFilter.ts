import type {QueryHistoryEntry} from '@/types/queryHistory';
import {calendarDayNumber, parseCalendarDay, resolveZone, zonedYmd} from './dateGroups';

/** Outcome filter for the Query History panel. */
export type QueryHistoryOutcomeFilter = 'any' | 'succeeded' | 'failed';

/** Time-range filter for the Query History panel. */
export type QueryHistoryTimeRange =
    'all' | 'lastHour' | 'today' | 'last7Days' | 'last30Days' | 'custom';

/**
 * Database filter for the Query History panel: every entry (`"all"`), only
 * entries without a recorded database (`"none"`), or one database, stored as
 * `db:` plus its name so a database called "all" or "none" stays distinct.
 * The value doubles as the `<select>` option value.
 */
export type QueryHistoryDatabaseFilter = 'all' | 'none' | `db:${string}`;

/** Database choices built from the loaded history entries. */
export interface QueryHistoryDatabaseChoices {
    /** Distinct recorded database names, sorted. */
    databases: string[];
    /** True when at least one entry has no recorded database. */
    hasUnrecorded: boolean;
}

export const QUERY_HISTORY_OUTCOME_OPTIONS: readonly QueryHistoryOutcomeFilter[] = [
    'any',
    'succeeded',
    'failed',
] as const;

export const QUERY_HISTORY_TIME_RANGE_OPTIONS: readonly QueryHistoryTimeRange[] = [
    'all',
    'lastHour',
    'today',
    'last7Days',
    'last30Days',
    'custom',
] as const;

export interface QueryHistoryFilterOptions {
    search?: string;
    /**
     * When true, the text search also matches the recorded error message, so
     * an entry matches when its SQL or its error contains the text. Off by
     * default: the search looks at the SQL only.
     */
    searchErrors?: boolean;
    outcome?: QueryHistoryOutcomeFilter;
    timeRange?: QueryHistoryTimeRange;
    database?: QueryHistoryDatabaseFilter;
    /**
     * Instant used for relative ranges (`lastHour` / `last7Days` / `last30Days`)
     * and as the calendar "today" reference. Defaults to `Date.now()`. Inject in
     * tests for determinism.
     */
    now?: Date | number;
    /**
     * IANA timezone for the `today` calendar boundary (same convention as
     * `groupByDate`). When omitted, `"auto"`, or unrecognised, the OS local
     * timezone is used.
     */
    timeZone?: string;
    /**
     * Inclusive calendar-day lower bound as `YYYY-MM-DD`, compared in
     * `timeZone`. Empty or undefined means "no lower bound".
     */
    from?: string;
    /** Inclusive calendar-day upper bound as `YYYY-MM-DD`. */
    to?: string;
    /**
     * Minimum recorded execution time in milliseconds, as typed in the panel.
     * Empty or undefined means "no threshold"; `"0"` is a threshold of zero.
     */
    minDurationMs?: string;
}

/** Why the minimum-duration filter cannot be applied. */
export type QueryHistoryMinDurationError = 'invalid' | 'negative';

/** A plain decimal number: `500`, `0`, `2.5`, `.5`. */
const DECIMAL_NUMBER = /^(\d+\.?\d*|\.\d+)$/;

/**
 * Validates the minimum-duration field and returns `null` when it can be
 * applied, including when it is empty. Only plain decimal numbers count:
 * exponents, hex, `Infinity` and stray characters are rejected so a typo cannot
 * silently widen or narrow the list. A negative number gets its own reason.
 */
export function validateQueryHistoryMinDuration(raw?: string): QueryHistoryMinDurationError | null {
    const trimmed = raw?.trim() ?? '';
    if (!trimmed) return null;
    if (trimmed.startsWith('-') && DECIMAL_NUMBER.test(trimmed.slice(1))) return 'negative';
    if (!DECIMAL_NUMBER.test(trimmed)) return 'invalid';
    // A digit string too long for a double overflows to Infinity.
    if (!Number.isFinite(Number(trimmed))) return 'invalid';
    return null;
}

/** The threshold in milliseconds, or `null` when the field is empty or unusable. */
export function parseQueryHistoryMinDuration(raw?: string): number | null {
    const trimmed = raw?.trim() ?? '';
    if (!trimmed || validateQueryHistoryMinDuration(trimmed) !== null) return null;
    return Number(trimmed);
}

/** Why a custom `from` / `to` range cannot be applied. */
export type QueryHistoryDateRangeError = 'invalidFrom' | 'invalidTo' | 'inverted';

/**
 * Validates the optional custom date range and returns `null` when it can be
 * applied — including when one or both sides are empty. Callers should surface
 * the returned reason instead of silently widening the range.
 */
export function validateQueryHistoryDateRange(
    from?: string,
    to?: string,
): QueryHistoryDateRangeError | null {
    const fromRaw = from?.trim() ?? '';
    const toRaw = to?.trim() ?? '';

    const fromDay = fromRaw ? parseCalendarDay(fromRaw) : null;
    if (fromRaw && fromDay === null) return 'invalidFrom';

    const toDay = toRaw ? parseCalendarDay(toRaw) : null;
    if (toRaw && toDay === null) return 'invalidTo';

    if (fromDay !== null && toDay !== null && fromDay > toDay) return 'inverted';

    return null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function sameCalendarDay(a: Date, b: Date, zone: string | undefined): boolean {
    const left = zonedYmd(a, zone);
    const right = zonedYmd(b, zone);
    return left.y === right.y && left.m === right.m && left.d === right.d;
}

function matchesOutcome(entry: QueryHistoryEntry, outcome: QueryHistoryOutcomeFilter): boolean {
    if (outcome === 'any') return true;
    if (outcome === 'succeeded') return entry.status === 'success';
    return entry.status === 'error';
}

function matchesTimeRange(
    entry: QueryHistoryEntry,
    timeRange: QueryHistoryTimeRange,
    nowMs: number,
    zone: string | undefined,
): boolean {
    // "custom" has no rolling window of its own: the inclusive `from` / `to`
    // bounds are applied by `matchesDateRange`.
    if (timeRange === 'all' || timeRange === 'custom') return true;

    const executed = new Date(entry.executedAt);
    if (Number.isNaN(executed.getTime())) return false;

    if (timeRange === 'today') {
        return sameCalendarDay(executed, new Date(nowMs), zone);
    }

    const ageMs = nowMs - executed.getTime();
    if (timeRange === 'lastHour') return ageMs >= 0 && ageMs <= HOUR_MS;
    if (timeRange === 'last7Days') return ageMs >= 0 && ageMs <= 7 * DAY_MS;
    return ageMs >= 0 && ageMs <= 30 * DAY_MS;
}

/** Applies the optional custom range: both bounds are inclusive calendar days. */
function matchesDateRange(
    entry: QueryHistoryEntry,
    fromDay: number | null,
    toDay: number | null,
    zone: string | undefined,
): boolean {
    if (fromDay === null && toDay === null) return true;

    const executed = new Date(entry.executedAt);
    if (Number.isNaN(executed.getTime())) return false;

    const day = calendarDayNumber(executed, zone);
    if (fromDay !== null && day < fromDay) return false;
    if (toDay !== null && day > toDay) return false;
    return true;
}

/** The entry's recorded database, or null when none was recorded. */
function recordedDatabase(entry: QueryHistoryEntry): string | null {
    return entry.database ? entry.database : null;
}

/** Filter value that selects the entries recorded for `database`. */
export function queryHistoryDatabaseFilterFor(database: string): QueryHistoryDatabaseFilter {
    return `db:${database}`;
}

function matchesDatabase(entry: QueryHistoryEntry, database: QueryHistoryDatabaseFilter): boolean {
    if (database === 'all') return true;
    const recorded = recordedDatabase(entry);
    if (database === 'none') return recorded === null;
    return recorded !== null && database === queryHistoryDatabaseFilterFor(recorded);
}

/**
 * Database choices for the loaded entries: each recorded database once, sorted,
 * plus whether any entry lacks database metadata (e.g. legacy entries).
 */
export function getQueryHistoryDatabaseChoices(
    entries: QueryHistoryEntry[],
): QueryHistoryDatabaseChoices {
    const names = new Set<string>();
    let hasUnrecorded = false;
    for (const entry of entries) {
        const recorded = recordedDatabase(entry);
        if (recorded === null) hasUnrecorded = true;
        else names.add(recorded);
    }
    return {
        databases: [...names].sort((a, b) => a.localeCompare(b, 'en')),
        hasUnrecorded,
    };
}

/**
 * True when `database` can still be chosen among `choices`. `"all"` is always
 * available; the panel falls back to it when a selection disappears, e.g.
 * after switching to another connection's history.
 */
export function isQueryHistoryDatabaseFilterAvailable(
    database: QueryHistoryDatabaseFilter,
    choices: QueryHistoryDatabaseChoices,
): boolean {
    if (database === 'all') return true;
    if (database === 'none') return choices.hasUnrecorded;
    return choices.databases.some((name) => queryHistoryDatabaseFilterFor(name) === database);
}

/**
 * Applies the minimum-duration threshold. A missing duration is unknown, not
 * zero, so it never satisfies an active threshold; a recorded `0` does satisfy
 * a threshold of zero.
 */
function matchesMinDuration(entry: QueryHistoryEntry, minDurationMs: number | null): boolean {
    if (minDurationMs === null) return true;
    const recorded = entry.executionTimeMs;
    if (recorded === null || !Number.isFinite(recorded)) return false;
    return recorded >= minDurationMs;
}

function matchesSearch(entry: QueryHistoryEntry, search: string, searchErrors: boolean): boolean {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    if (entry.sql.toLowerCase().includes(needle)) return true;
    // Entries without a recorded error (successes, legacy entries) only match
    // through their SQL.
    return searchErrors && Boolean(entry.error?.toLowerCase().includes(needle));
}

/**
 * True when any Query History filter (text, outcome, time range, database,
 * custom date range, or minimum duration) is active. Used to show the
 * filtered/total counter.
 */
export function isQueryHistoryFilterActive(
    options: Pick<
        QueryHistoryFilterOptions,
        'search' | 'outcome' | 'timeRange' | 'database' | 'from' | 'to' | 'minDurationMs'
    >,
): boolean {
    const searchActive = Boolean(options.search?.trim());
    const outcomeActive = (options.outcome ?? 'any') !== 'any';
    // `custom` is a mode of the time-range select, not a range of its own:
    // picking it without dates filters nothing, and once a date is set
    // `rangeActive` already covers the filter.
    const timeActive = (options.timeRange ?? 'all') !== 'all' && options.timeRange !== 'custom';
    const databaseActive = (options.database ?? 'all') !== 'all';
    const rangeActive = Boolean(options.from?.trim()) || Boolean(options.to?.trim());
    // Anything typed counts, "0" included: a threshold of zero still hides the
    // entries that have no recorded duration.
    const durationActive = Boolean(options.minDurationMs?.trim());
    return (
        searchActive ||
        outcomeActive ||
        timeActive ||
        databaseActive ||
        rangeActive ||
        durationActive
    );
}

/**
 * Filter query-history entries by optional text search (SQL only, or SQL or
 * recorded error with `searchErrors`), outcome, time range,
 * database, custom `from` / `to` calendar dates, and minimum recorded duration.
 * Filters combine with AND. Relative ranges are rolling windows from `now`;
 * `today` and the custom range use the calendar day in `timeZone`, with both
 * boundaries inclusive. The duration threshold is inclusive too, and entries
 * without a recorded duration never match it.
 */
export function filterQueryHistoryEntries(
    entries: QueryHistoryEntry[],
    options: QueryHistoryFilterOptions = {},
): QueryHistoryEntry[] {
    const {
        search = '',
        searchErrors = false,
        outcome = 'any',
        timeRange = 'all',
        database = 'all',
        from = '',
        to = '',
        minDurationMs = '',
        now = Date.now(),
        timeZone,
    } = options;

    if (
        !isQueryHistoryFilterActive({search, outcome, timeRange, database, from, to, minDurationMs})
    ) {
        return entries;
    }

    // An unusable custom range (unparseable boundary, or `from` after `to`)
    // or an unusable duration matches nothing; the UI explains the reason
    // rather than widening it.
    if (
        validateQueryHistoryDateRange(from, to) !== null ||
        validateQueryHistoryMinDuration(minDurationMs) !== null
    ) {
        return [];
    }

    const fromRaw = from.trim();
    const toRaw = to.trim();
    const fromDay = fromRaw ? parseCalendarDay(fromRaw) : null;
    const toDay = toRaw ? parseCalendarDay(toRaw) : null;
    const minDuration = parseQueryHistoryMinDuration(minDurationMs);

    const nowMs = typeof now === 'number' ? now : now.getTime();
    const zone = resolveZone(timeZone);

    return entries.filter(
        (entry) =>
            matchesSearch(entry, search, searchErrors) &&
            matchesOutcome(entry, outcome) &&
            matchesDatabase(entry, database) &&
            matchesTimeRange(entry, timeRange, nowMs, zone) &&
            matchesDateRange(entry, fromDay, toDay, zone) &&
            matchesMinDuration(entry, minDuration),
    );
}
