import type { QueryHistoryEntry } from "../types/queryHistory";

export type HistoryOutcomeFilter = "any" | "success" | "error";
export type HistoryTimeFilter = "all" | "hour" | "today" | "7d" | "30d";

export const HISTORY_OUTCOME_FILTERS: HistoryOutcomeFilter[] = ["any", "success", "error"];
export const HISTORY_TIME_FILTERS: HistoryTimeFilter[] = ["all", "hour", "today", "7d", "30d"];

export interface QueryHistoryFilters {
  search: string;
  outcome: HistoryOutcomeFilter;
  time: HistoryTimeFilter;
}

export const DEFAULT_HISTORY_FILTERS: QueryHistoryFilters = {
  search: "",
  outcome: "any",
  time: "all",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Calendar day (YYYY-MM-DD) of an instant as seen in the given timezone. */
function zonedDay(date: Date, timeZone?: string): string {
  const zone = timeZone && timeZone !== "auto" ? timeZone : undefined;
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: zone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", opts).format(date);
  }
}

/** Whether any filter differs from its default (the text search counts too). */
export function hasActiveHistoryFilters(filters: QueryHistoryFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.outcome !== DEFAULT_HISTORY_FILTERS.outcome ||
    filters.time !== DEFAULT_HISTORY_FILTERS.time
  );
}

/**
 * Whether an entry executed inside the selected time range.
 * "today" is a calendar day in the display timezone; the other ranges are
 * sliding windows measured back from `now`.
 */
export function matchesHistoryTime(
  executedAt: string,
  time: HistoryTimeFilter,
  now: Date = new Date(),
  timeZone?: string,
): boolean {
  if (time === "all") return true;
  const ts = new Date(executedAt).getTime();
  if (Number.isNaN(ts)) return false;
  switch (time) {
    case "hour":
      return now.getTime() - ts <= HOUR_MS;
    case "today":
      return zonedDay(new Date(ts), timeZone) === zonedDay(now, timeZone);
    case "7d":
      return now.getTime() - ts <= 7 * DAY_MS;
    case "30d":
      return now.getTime() - ts <= 30 * DAY_MS;
  }
}

/** Apply the text search, outcome and time range filters together. */
export function filterQueryHistory(
  entries: QueryHistoryEntry[],
  filters: QueryHistoryFilters,
  now: Date = new Date(),
  timeZone?: string,
): QueryHistoryEntry[] {
  const lower = filters.search.trim().toLowerCase();
  return entries.filter((e) => {
    if (lower && !e.sql.toLowerCase().includes(lower)) return false;
    if (filters.outcome !== "any" && e.status !== filters.outcome) return false;
    return matchesHistoryTime(e.executedAt, filters.time, now, timeZone);
  });
}
