import type { QueryHistoryEntry } from "../types/queryHistory";
import { resolveZone, zonedYmd } from "./dateGroups";

/** Outcome filter for the Query History panel. */
export type QueryHistoryOutcomeFilter = "any" | "succeeded" | "failed";

/** Time-range filter for the Query History panel. */
export type QueryHistoryTimeRange =
  | "all"
  | "lastHour"
  | "today"
  | "last7Days"
  | "last30Days";

export const QUERY_HISTORY_OUTCOME_OPTIONS: readonly QueryHistoryOutcomeFilter[] =
  ["any", "succeeded", "failed"] as const;

export const QUERY_HISTORY_TIME_RANGE_OPTIONS: readonly QueryHistoryTimeRange[] =
  ["all", "lastHour", "today", "last7Days", "last30Days"] as const;

export interface QueryHistoryFilterOptions {
  search?: string;
  outcome?: QueryHistoryOutcomeFilter;
  timeRange?: QueryHistoryTimeRange;
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
}


const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function sameCalendarDay(a: Date, b: Date, zone: string | undefined): boolean {
  const left = zonedYmd(a, zone);
  const right = zonedYmd(b, zone);
  return left.y === right.y && left.m === right.m && left.d === right.d;
}

function matchesOutcome(
  entry: QueryHistoryEntry,
  outcome: QueryHistoryOutcomeFilter,
): boolean {
  if (outcome === "any") return true;
  if (outcome === "succeeded") return entry.status === "success";
  return entry.status === "error";
}

function matchesTimeRange(
  entry: QueryHistoryEntry,
  timeRange: QueryHistoryTimeRange,
  nowMs: number,
  zone: string | undefined,
): boolean {
  if (timeRange === "all") return true;

  const executed = new Date(entry.executedAt);
  if (Number.isNaN(executed.getTime())) return false;

  if (timeRange === "today") {
    return sameCalendarDay(executed, new Date(nowMs), zone);
  }

  const ageMs = nowMs - executed.getTime();
  if (timeRange === "lastHour") return ageMs >= 0 && ageMs <= HOUR_MS;
  if (timeRange === "last7Days") return ageMs >= 0 && ageMs <= 7 * DAY_MS;
  return ageMs >= 0 && ageMs <= 30 * DAY_MS;
}

function matchesSearch(entry: QueryHistoryEntry, search: string): boolean {
  const trimmed = search.trim();
  if (!trimmed) return true;
  return entry.sql.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * True when any Query History filter (text, outcome, or time range) is active.
 * Used to show the filtered/total counter.
 */
export function isQueryHistoryFilterActive(
  options: Pick<QueryHistoryFilterOptions, "search" | "outcome" | "timeRange">,
): boolean {
  const searchActive = Boolean(options.search?.trim());
  const outcomeActive = (options.outcome ?? "any") !== "any";
  const timeActive = (options.timeRange ?? "all") !== "all";
  return searchActive || outcomeActive || timeActive;
}

/**
 * Filter query-history entries by optional text search, outcome, and time range.
 * Filters combine with AND. Relative ranges are rolling windows from `now`;
 * `today` is the calendar day in `timeZone`.
 */
export function filterQueryHistoryEntries(
  entries: QueryHistoryEntry[],
  options: QueryHistoryFilterOptions = {},
): QueryHistoryEntry[] {
  const {
    search = "",
    outcome = "any",
    timeRange = "all",
    now = Date.now(),
    timeZone,
  } = options;

  if (!isQueryHistoryFilterActive({ search, outcome, timeRange })) {
    return entries;
  }

  const nowMs = typeof now === "number" ? now : now.getTime();
  const zone = resolveZone(timeZone);

  return entries.filter(
    (entry) =>
      matchesSearch(entry, search) &&
      matchesOutcome(entry, outcome) &&
      matchesTimeRange(entry, timeRange, nowMs, zone),
  );
}
