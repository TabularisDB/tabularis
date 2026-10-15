import { describe, it, expect } from "vitest";
import type { QueryHistoryEntry } from "../../src/types/queryHistory";
import {
  filterQueryHistoryEntries,
  isQueryHistoryFilterActive,
} from "../../src/utils/queryHistoryFilter";

const NOW = new Date("2026-04-15T14:00:00.000Z");

function entry(
  overrides: Partial<QueryHistoryEntry> & Pick<QueryHistoryEntry, "id" | "sql">,
): QueryHistoryEntry {
  return {
    executedAt: "2026-04-15T13:30:00.000Z",
    executionTimeMs: 10,
    status: "success",
    rowsAffected: 1,
    error: null,
    database: null,
    ...overrides,
  };
}

const SAMPLE: QueryHistoryEntry[] = [
  entry({
    id: "ok-recent",
    sql: "SELECT * FROM users",
    executedAt: "2026-04-15T13:45:00.000Z",
    status: "success",
  }),
  entry({
    id: "fail-recent",
    sql: "SELECT * FROM missing",
    executedAt: "2026-04-15T13:50:00.000Z",
    status: "error",
    error: "relation missing does not exist",
  }),
  entry({
    id: "ok-yesterday",
    sql: "SELECT id FROM users",
    executedAt: "2026-04-14T12:00:00.000Z",
    status: "success",
  }),
  entry({
    id: "fail-week",
    sql: "DELETE FROM users WHERE id = 1",
    executedAt: "2026-04-10T10:00:00.000Z",
    status: "error",
  }),
  entry({
    id: "ok-mid",
    sql: "ANALYZE",
    executedAt: "2026-03-25T10:00:00.000Z",
    status: "success",
  }),
  entry({
    id: "ok-old",
    sql: "VACUUM",
    executedAt: "2026-03-01T10:00:00.000Z",
    status: "success",
  }),
];

describe("queryHistoryFilter", () => {
  describe("isQueryHistoryFilterActive", () => {
    it("is false when everything is default", () => {
      expect(isQueryHistoryFilterActive({})).toBe(false);
      expect(
        isQueryHistoryFilterActive({
          search: "  ",
          outcome: "any",
          timeRange: "all",
        }),
      ).toBe(false);
    });

    it("is true when search, outcome, or time range is set", () => {
      expect(isQueryHistoryFilterActive({ search: "select" })).toBe(true);
      expect(isQueryHistoryFilterActive({ outcome: "failed" })).toBe(true);
      expect(isQueryHistoryFilterActive({ timeRange: "today" })).toBe(true);
    });
  });

  describe("filterQueryHistoryEntries", () => {
    it("returns the same array when no filter is active", () => {
      const result = filterQueryHistoryEntries(SAMPLE, { now: NOW });
      expect(result).toBe(SAMPLE);
    });

    it("filters by case-insensitive SQL search", () => {
      const result = filterQueryHistoryEntries(SAMPLE, {
        search: "from users",
        now: NOW,
      });
      expect(result.map((e) => e.id)).toEqual([
        "ok-recent",
        "ok-yesterday",
        "fail-week",
      ]);
    });

    it("filters by outcome", () => {
      expect(
        filterQueryHistoryEntries(SAMPLE, {
          outcome: "succeeded",
          now: NOW,
        }).map((e) => e.id),
      ).toEqual(["ok-recent", "ok-yesterday", "ok-mid", "ok-old"]);

      expect(
        filterQueryHistoryEntries(SAMPLE, {
          outcome: "failed",
          now: NOW,
        }).map((e) => e.id),
      ).toEqual(["fail-recent", "fail-week"]);
    });

    it("filters by last hour as a rolling window", () => {
      const result = filterQueryHistoryEntries(SAMPLE, {
        timeRange: "lastHour",
        now: NOW,
      });
      expect(result.map((e) => e.id)).toEqual(["ok-recent", "fail-recent"]);
    });

    it("filters by today using the display timezone calendar day", () => {
      // 2026-04-14T16:00Z is already 2026-04-15 in Tokyo, still the 14th in UTC.
      const tokyoEdge = entry({
        id: "tokyo-edge",
        sql: "SELECT 1",
        executedAt: "2026-04-14T16:00:00.000Z",
      });
      const entries = [...SAMPLE, tokyoEdge];

      expect(
        filterQueryHistoryEntries(entries, {
          timeRange: "today",
          now: NOW,
          timeZone: "UTC",
        }).map((e) => e.id),
      ).toEqual(["ok-recent", "fail-recent"]);

      expect(
        filterQueryHistoryEntries(entries, {
          timeRange: "today",
          now: NOW,
          timeZone: "Asia/Tokyo",
        }).map((e) => e.id),
      ).toEqual(["ok-recent", "fail-recent", "tokyo-edge"]);
    });

    it("filters by last 7 and 30 days as rolling windows", () => {
      expect(
        filterQueryHistoryEntries(SAMPLE, {
          timeRange: "last7Days",
          now: NOW,
        }).map((e) => e.id),
      ).toEqual(["ok-recent", "fail-recent", "ok-yesterday", "fail-week"]);

      expect(
        filterQueryHistoryEntries(SAMPLE, {
          timeRange: "last30Days",
          now: NOW,
        }).map((e) => e.id),
      ).toEqual([
        "ok-recent",
        "fail-recent",
        "ok-yesterday",
        "fail-week",
        "ok-mid",
      ]);
    });

    it("combines search, outcome, and time range with AND", () => {
      const result = filterQueryHistoryEntries(SAMPLE, {
        search: "users",
        outcome: "failed",
        timeRange: "last7Days",
        now: NOW,
      });
      expect(result.map((e) => e.id)).toEqual(["fail-week"]);
    });

    it("excludes future timestamps from relative ranges", () => {
      const future = entry({
        id: "future",
        sql: "SELECT 1",
        executedAt: "2026-04-15T15:00:00.000Z",
      });
      expect(
        filterQueryHistoryEntries([future], {
          timeRange: "lastHour",
          now: NOW,
        }),
      ).toEqual([]);
    });

    it("excludes invalid executedAt from time filters", () => {
      const bad = entry({
        id: "bad-date",
        sql: "SELECT 1",
        executedAt: "not-a-date",
      });
      expect(
        filterQueryHistoryEntries([bad], {
          timeRange: "today",
          now: NOW,
          timeZone: "UTC",
        }),
      ).toEqual([]);
      expect(
        filterQueryHistoryEntries([bad], {
          search: "SELECT",
          now: NOW,
        }).map((e) => e.id),
      ).toEqual(["bad-date"]);
    });
  });
});
