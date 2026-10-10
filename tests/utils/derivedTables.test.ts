import { describe, expect, it } from "vitest";
import { maskNestedSqlBodies, parseDerivedTables } from "../../src/utils/derivedTables";

const names = (sql: string, cursor = sql.length) =>
  parseDerivedTables(sql, cursor).map(t => [t.name, t.columns.map(c => c.name)]);

describe("derived table and CTE autocomplete scope", () => {
  it("derives a CTE's selected and aliased columns", () => {
    expect(names("WITH recent AS (SELECT id, occurred_at AS ts FROM events) SELECT recent. FROM recent"))
      .toEqual([["recent", ["id", "ts"]]]);
  });

  it("handles multiple and recursive CTEs in declaration order", () => {
    const sql = "WITH RECURSIVE a AS (SELECT id FROM t), b AS (SELECT id, id AS renamed FROM a) SELECT b. FROM b";
    expect(names(sql)).toEqual([
      ["a", ["id"]],
      ["b", ["id", "renamed"]],
    ]);
    const insideB = sql.indexOf("SELECT id, id AS renamed") + 12;
    expect(names(sql, insideB)).toEqual([["a", ["id"]]]);
  });

  it("prefers explicit CTE/derived alias column lists", () => {
    expect(names("WITH x(first, second) AS (SELECT id, name FROM t) SELECT x. FROM x"))
      .toEqual([["x", ["first", "second"]]]);
    expect(names("SELECT d. FROM (SELECT a, b FROM t) AS d(x, y)"))
      .toEqual([["d", ["x", "y"]]]);
  });

  it("resolves a derived alias even when its FROM clause follows the cursor", () => {
    const sql = "SELECT x. FROM (SELECT a, b FROM t) x";
    expect(names(sql, sql.indexOf("x.") + 2)).toEqual([["x", ["a", "b"]]]);
  });

  it("resolves LATERAL derived aliases in FROM and JOIN", () => {
    const from = "SELECT d. FROM LATERAL (SELECT id, name AS label FROM users) AS d";
    expect(names(from, from.indexOf("d.") + 2)).toEqual([
      ["d", ["id", "label"]],
    ]);
    const join = "SELECT x. FROM base b JOIN LATERAL (SELECT b.id AS match_id) x ON true";
    expect(names(join, join.indexOf("x.") + 2)).toEqual([
      ["x", ["match_id"]],
    ]);
    expect(maskNestedSqlBodies(join)).not.toContain("b.id");
  });

  it("handles bare aliases and quoted identifiers (double, backtick, bracket)", () => {
    expect(names('WITH "My CTE" AS (SELECT "Column", `field` AS [Other]) SELECT 1'))
      .toEqual([["My CTE", ["Column", "Other"]]]);
    expect(names("SELECT d. FROM (SELECT a, b FROM t) d"))
      .toEqual([["d", ["a", "b"]]]);
  });

  it("does not split on commas in strings, functions or nested expressions", () => {
    const sql = "WITH x AS (SELECT concat('a,b', coalesce(v, 1)) AS combined, id, (a+b) sum FROM t) SELECT x. FROM x";
    expect(names(sql)).toEqual([["x", ["combined", "id", "sum"]]]);
  });

  it("skips expressions with no name and star expansion", () => {
    expect(names("WITH x AS (SELECT count(*), *, a+b, id FROM t) SELECT x. FROM x"))
      .toEqual([["x", ["id"]]]);
  });

  it("keeps nested CTEs private to their containing query", () => {
    const sql = "WITH outer_t AS (WITH inner_t AS (SELECT id FROM t) SELECT id FROM inner_t) SELECT outer_t. FROM outer_t";
    expect(names(sql)).toEqual([["outer_t", ["id"]]]);
  });

  it("does not reveal declarations in another statement", () => {
    expect(names("WITH old AS (SELECT id FROM t) SELECT * FROM old; SELECT next."))
      .toEqual([]);
  });

  it("masks nested SELECTs to prevent inner physical tables leaking out", () => {
    const sql = "SELECT * FROM (SELECT id FROM inner_t) x WHERE ";
    const masked = maskNestedSqlBodies(sql);
    expect(masked).not.toContain("inner_t");
    expect(masked).toContain("FROM (");
    expect(masked).toContain(") x WHERE");
    expect(names(sql)).toEqual([["x", ["id"]]]);
  });

  it("leaves comments, literals and ordinary predicates intact", () => {
    const sql = "SELECT * FROM outer_t WHERE msg = 'FROM inner_t' AND x IN (1, 2)";
    expect(maskNestedSqlBodies(sql)).toBe(sql);
    expect(names(sql)).toEqual([]);
  });
});
