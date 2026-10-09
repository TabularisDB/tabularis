import { describe, it, expect } from "vitest";
import {
  filterQueryHistory,
  hasActiveHistoryFilters,
  matchesHistoryTime,
  DEFAULT_HISTORY_FILTERS,
} from "../../src/utils/queryHistoryFilter";
import type { QueryHistoryEntry } from "../../src/types/queryHistory";

const NOW = new Date("2026-04-15T14:00:00.000Z");
const TZ = "UTC";

function entry(partial: Partial<QueryHistoryEntry> & { id: string }): QueryHistoryEntry {
  return {
    sql: "SELECT 1",
    executedAt: NOW.toISOString(),
    executionTimeMs: 1,
    status: "success",
    rowsAffected: null,
    error: null,
    database: null,
    ...partial,
  };
}

const ENTRIES: QueryHistoryEntry[] = [
  entry({ id: "now-ok", executedAt: "2026-04-15T13:50:00.000Z" }),
  entry({ id: "now-err", executedAt: "2026-04-15T13:30:00.000Z", status: "error", sql: "DROP x" }),
  entry({ id: "today-early", executedAt: "2026-04-15T01:00:00.000Z" }),
  entry({ id: "yesterday", executedAt: "2026-04-14T23:30:00.000Z", status: "error" }),
  entry({ id: "6d", executedAt: "2026-04-09T14:00:00.000Z" }),
  entry({ id: "20d", executedAt: "2026-03-26T14:00:00.000Z", status: "error" }),
  entry({ id: "40d", executedAt: "2026-03-06T14:00:00.000Z" }),
];

const ids = (list: QueryHistoryEntry[]) => list.map((e) => e.id);

describe("queryHistoryFilter", () => {
  describe("matchesHistoryTime", () => {
    it("accepts everything for all", () => {
      expect(matchesHistoryTime("2001-01-01T00:00:00.000Z", "all", NOW, TZ)).toBe(true);
    });

    it("rejects unparsable dates once a range is selected", () => {
      expect(matchesHistoryTime("not a date", "hour", NOW, TZ)).toBe(false);
      expect(matchesHistoryTime("not a date", "all", NOW, TZ)).toBe(true);
    });

    it("today is a calendar day in the display timezone, not a 24h window", () => {
      // 23:30 UTC on the 14th is yesterday in UTC but already the 15th in Paris.
      expect(matchesHistoryTime("2026-04-14T23:30:00.000Z", "today", NOW, "UTC")).toBe(false);
      expect(matchesHistoryTime("2026-04-14T23:30:00.000Z", "today", NOW, "Europe/Paris")).toBe(
        true,
      );
    });

    it("falls back to the local zone when the timezone name is invalid", () => {
      expect(() => matchesHistoryTime(NOW.toISOString(), "today", NOW, "Not/AZone")).not.toThrow();
    });
  });

  describe("filterQueryHistory", () => {
    it("returns all entries with default filters", () => {
      expect(filterQueryHistory(ENTRIES, DEFAULT_HISTORY_FILTERS, NOW, TZ)).toHaveLength(
        ENTRIES.length,
      );
    });

    it("filters by outcome", () => {
      const failed = filterQueryHistory(
        ENTRIES,
        { ...DEFAULT_HISTORY_FILTERS, outcome: "error" },
        NOW,
        TZ,
      );
      expect(ids(failed)).toEqual(["now-err", "yesterday", "20d"]);
    });

    it("filters by each time range", () => {
      const run = (time: "hour" | "today" | "7d" | "30d") =>
        ids(filterQueryHistory(ENTRIES, { ...DEFAULT_HISTORY_FILTERS, time }, NOW, TZ));
      expect(run("hour")).toEqual(["now-ok", "now-err"]);
      expect(run("today")).toEqual(["now-ok", "now-err", "today-early"]);
      expect(run("7d")).toEqual(["now-ok", "now-err", "today-early", "yesterday", "6d"]);
      expect(run("30d")).toEqual(["now-ok", "now-err", "today-early", "yesterday", "6d", "20d"]);
    });

    it("combines search, outcome and time range", () => {
      const result = filterQueryHistory(
        ENTRIES,
        { search: "drop", outcome: "error", time: "today" },
        NOW,
        TZ,
      );
      expect(ids(result)).toEqual(["now-err"]);
      const none = filterQueryHistory(
        ENTRIES,
        { search: "drop", outcome: "success", time: "today" },
        NOW,
        TZ,
      );
      expect(none).toEqual([]);
    });

    it("search is case-insensitive and ignores surrounding whitespace", () => {
      const result = filterQueryHistory(
        ENTRIES,
        { ...DEFAULT_HISTORY_FILTERS, search: "  DrOp " },
        NOW,
        TZ,
      );
      expect(ids(result)).toEqual(["now-err"]);
    });
  });

  describe("hasActiveHistoryFilters", () => {
    it("is false for defaults and whitespace-only search", () => {
      expect(hasActiveHistoryFilters(DEFAULT_HISTORY_FILTERS)).toBe(false);
      expect(hasActiveHistoryFilters({ ...DEFAULT_HISTORY_FILTERS, search: "   " })).toBe(false);
    });

    it("is true when any filter is set", () => {
      expect(hasActiveHistoryFilters({ ...DEFAULT_HISTORY_FILTERS, search: "x" })).toBe(true);
      expect(hasActiveHistoryFilters({ ...DEFAULT_HISTORY_FILTERS, outcome: "error" })).toBe(true);
      expect(hasActiveHistoryFilters({ ...DEFAULT_HISTORY_FILTERS, time: "7d" })).toBe(true);
    });
  });
});
