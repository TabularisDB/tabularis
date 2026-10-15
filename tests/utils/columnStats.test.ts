import { describe, it, expect, vi } from "vitest";
import {
  COLUMN_STATS_TOP_VALUES_LIMIT,
  buildColumnStatsQuery,
  formatColumnStatValue,
  getColumnStatsSupport,
  isColumnStatsAbort,
  loadColumnStats,
  parseColumnStats,
  percentOf,
} from "../../src/utils/columnStats";
import type { ColumnStatsSupport } from "../../src/utils/columnStats";
import type { DriverCapabilities } from "../../src/types/plugins";

const ALL: ColumnStatsSupport = { distinct: true, minMax: true, topValues: true };
const COUNTS_ONLY: ColumnStatsSupport = { distinct: false, minMax: false, topValues: false };

describe("columnStats", () => {
  describe("getColumnStatsSupport", () => {
    it.each([
      "integer",
      "BIGINT",
      "numeric(10,2)",
      "double precision",
      "decimal(8,3)",
      "real",
      "date",
      "datetime(3)",
      "timestamp(6) with time zone",
      "timestamptz",
      "time",
    ])("computes min / max for %s", (type) => {
      expect(getColumnStatsSupport(type)).toEqual(ALL);
    });

    it.each(["varchar(255)", "text", "uuid", "boolean", "enum('a','b')", ""])(
      "skips min / max but lists top values for %s",
      (type) => {
        expect(getColumnStatsSupport(type)).toEqual({
          distinct: true,
          minMax: false,
          topValues: true,
        });
      },
    );

    it.each(["BLOB", "longblob", "bytea", "varbinary(70000)"])(
      "only counts rows, NULLs and distinct values for binary %s",
      (type) => {
        expect(getColumnStatsSupport(type)).toEqual({
          distinct: true,
          minMax: false,
          topValues: false,
        });
      },
    );

    it("keeps top values off for a short VARBINARY, like the value picker", () => {
      expect(
        getColumnStatsSupport("varbinary(16)", { characterMaximumLength: 16 }),
      ).toEqual({ distinct: true, minMax: false, topValues: false });
    });

    it.each([
      "json",
      "JSONB",
      "xml",
      "geometry",
      "POINT",
      "multipolygon",
      "geography(Point,4326)",
      "box",
      "circle",
      "line",
      "lseg",
      "path",
    ])("only counts rows and NULLs for %s", (type) => {
      expect(getColumnStatsSupport(type)).toEqual(COUNTS_ONLY);
    });

    it("never computes min / max or top values for a masked column", () => {
      expect(getColumnStatsSupport("integer", { masked: true })).toEqual({
        distinct: true,
        minMax: false,
        topValues: false,
      });
      expect(getColumnStatsSupport("varchar", { masked: true })).toEqual({
        distinct: true,
        minMax: false,
        topValues: false,
      });
    });
  });

  describe("buildColumnStatsQuery", () => {
    it("builds the aggregates for postgres with a schema", () => {
      expect(
        buildColumnStatsQuery({
          table: "orders",
          schema: "public",
          column: "Total",
          driver: "postgres",
          support: ALL,
        }),
      ).toBe(
        'SELECT COUNT(*), COUNT(*) - COUNT("Total"), COUNT(DISTINCT "Total"), ' +
          'MIN("Total"), MAX("Total") FROM "public"."orders"',
      );
    });

    it("uses backticks for mysql and mariadb", () => {
      for (const driver of ["mysql", "mariadb"]) {
        expect(
          buildColumnStatsQuery({
            table: "orders",
            column: "order",
            driver,
            support: ALL,
          }),
        ).toBe(
          "SELECT COUNT(*), COUNT(*) - COUNT(`order`), COUNT(DISTINCT `order`), " +
            "MIN(`order`), MAX(`order`) FROM `orders`",
        );
      }
    });

    it("uses double quotes for sqlite", () => {
      expect(
        buildColumnStatsQuery({
          table: "orders",
          column: "status",
          driver: "sqlite",
          support: { distinct: true, minMax: false, topValues: true },
        }),
      ).toBe(
        'SELECT COUNT(*), COUNT(*) - COUNT("status"), COUNT(DISTINCT "status") FROM "orders"',
      );
    });

    it("follows the identifier quote from driver capabilities", () => {
      const caps = { identifier_quote: "`", sql_dialect: "mysql" } as DriverCapabilities;
      expect(
        buildColumnStatsQuery({
          table: "t",
          schema: "db",
          column: "c",
          driver: caps,
          support: COUNTS_ONLY,
        }),
      ).toBe("SELECT COUNT(*), COUNT(*) - COUNT(`c`) FROM `db`.`t`");
    });

    it("escapes quote characters inside identifiers", () => {
      expect(
        buildColumnStatsQuery({ table: "t", column: 'we"ird', driver: "postgres", support: COUNTS_ONLY }),
      ).toBe('SELECT COUNT(*), COUNT(*) - COUNT("we""ird") FROM "t"');
      expect(
        buildColumnStatsQuery({ table: "t", column: "we`ird", driver: "mysql", support: COUNTS_ONLY }),
      ).toBe("SELECT COUNT(*), COUNT(*) - COUNT(`we``ird`) FROM `t`");
    });

    it("applies the current filter in parentheses", () => {
      expect(
        buildColumnStatsQuery({
          table: "orders",
          column: "status",
          driver: "sqlite",
          where: "  a = 1 OR b = 2 ",
          support: COUNTS_ONLY,
        }),
      ).toBe(
        'SELECT COUNT(*), COUNT(*) - COUNT("status") FROM "orders" WHERE (a = 1 OR b = 2)',
      );
    });

    it("ignores a blank filter", () => {
      expect(
        buildColumnStatsQuery({ table: "t", column: "c", driver: "sqlite", where: "   ", support: COUNTS_ONLY }),
      ).not.toContain("WHERE");
    });
  });

  describe("parseColumnStats", () => {
    it("reads the columns in the order they were built", () => {
      expect(parseColumnStats([[10, 2, 7, 1, 99]], ALL)).toEqual({
        rowCount: 10,
        nullCount: 2,
        distinctCount: 7,
        min: 1,
        max: 99,
      });
    });

    it("skips the columns that were not computed", () => {
      expect(parseColumnStats([[10, 2]], COUNTS_ONLY)).toEqual({
        rowCount: 10,
        nullCount: 2,
        distinctCount: null,
        min: null,
        max: null,
      });
      expect(
        parseColumnStats([[10, 2, 7]], { distinct: true, minMax: false, topValues: true }),
      ).toMatchObject({ distinctCount: 7, min: null, max: null });
    });

    it("accepts counts returned as strings (64-bit integers)", () => {
      expect(parseColumnStats([["9007199254740993", "0", "12"]], {
        distinct: true,
        minMax: false,
        topValues: false,
      })).toMatchObject({ rowCount: 9007199254740992, nullCount: 0, distinctCount: 12 });
    });

    it("keeps NULL min / max for a NULL-only column", () => {
      expect(parseColumnStats([[3, 3, 0, null, null]], ALL)).toEqual({
        rowCount: 3,
        nullCount: 3,
        distinctCount: 0,
        min: null,
        max: null,
      });
    });

    it("returns zeros when no row came back", () => {
      expect(parseColumnStats([], ALL)).toEqual({
        rowCount: 0,
        nullCount: 0,
        distinctCount: 0,
        min: null,
        max: null,
      });
    });
  });

  describe("loadColumnStats", () => {
    const options = {
      table: "orders",
      column: "status",
      driver: "postgres",
      support: { distinct: true, minMax: false, topValues: true },
    };

    it("runs the aggregates, then the top values with the same filter and a small limit", async () => {
      const run = vi
        .fn()
        .mockResolvedValueOnce({ rows: [[5, 1, 2]] })
        .mockResolvedValueOnce({ rows: [["open", 3], ["closed", 1]] });

      const stats = await loadColumnStats(run, { ...options, where: "id > 1" });

      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[0][0]).toBe(
        'SELECT COUNT(*), COUNT(*) - COUNT("status"), COUNT(DISTINCT "status") ' +
          'FROM "orders" WHERE (id > 1)',
      );
      expect(run.mock.calls[1][0]).toBe(
        'SELECT "status", COUNT(*) FROM "orders" WHERE "status" IS NOT NULL AND (id > 1) ' +
          `GROUP BY "status" ORDER BY 2 DESC, 1 LIMIT ${COLUMN_STATS_TOP_VALUES_LIMIT}`,
      );
      expect(stats).toEqual({
        rowCount: 5,
        nullCount: 1,
        distinctCount: 2,
        min: null,
        max: null,
        topValues: [
          { value: "open", count: 3 },
          { value: "closed", count: 1 },
        ],
        filtered: true,
      });
    });

    it("skips the top values query when every value is NULL or the table is empty", async () => {
      for (const row of [[4, 4, 0], [0, 0, 0]]) {
        const run = vi.fn().mockResolvedValue({ rows: [row] });
        const stats = await loadColumnStats(run, options);
        expect(run).toHaveBeenCalledTimes(1);
        expect(stats.topValues).toEqual([]);
        expect(stats.filtered).toBe(false);
      }
    });

    it("skips the top values query when the column doesn't support them", async () => {
      const run = vi.fn().mockResolvedValue({ rows: [[4, 0]] });
      const stats = await loadColumnStats(run, { ...options, support: COUNTS_ONLY });
      expect(run).toHaveBeenCalledTimes(1);
      expect(stats.topValues).toBeNull();
      expect(stats.distinctCount).toBeNull();
    });

    it("passes the signal to the runner and starts nothing once aborted", async () => {
      const controller = new AbortController();
      const run = vi.fn().mockImplementation(async () => {
        controller.abort();
        return { rows: [[5, 0, 5]] };
      });

      const result = loadColumnStats(run, options, controller.signal);

      await expect(result).rejects.toSatisfy(isColumnStatsAbort);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][1]).toBe(controller.signal);
    });

    it("does not run anything with an already aborted signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const run = vi.fn();
      await expect(loadColumnStats(run, options, controller.signal)).rejects.toSatisfy(
        isColumnStatsAbort,
      );
      expect(run).not.toHaveBeenCalled();
    });

    it("propagates query errors", async () => {
      const run = vi.fn().mockRejectedValue(new Error("permission denied"));
      await expect(loadColumnStats(run, options)).rejects.toThrow("permission denied");
      expect(isColumnStatsAbort(new Error("permission denied"))).toBe(false);
    });
  });

  describe("formatColumnStatValue", () => {
    it("formats numbers, strings and objects", () => {
      expect(formatColumnStatValue(42)).toBe("42");
      expect(formatColumnStatValue("2024-01-01")).toBe("2024-01-01");
      expect(formatColumnStatValue({ a: 1 })).toBe('{"a":1}');
      expect(formatColumnStatValue(null)).toBe("");
    });
  });

  describe("percentOf", () => {
    it("returns the share as a percentage and 0 for an empty total", () => {
      expect(percentOf(1, 4)).toBe(25);
      expect(percentOf(3, 0)).toBe(0);
    });
  });
});
