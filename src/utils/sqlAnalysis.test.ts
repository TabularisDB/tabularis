import { describe, expect, it } from "vitest";
import { isReadOnlyQuery } from "./sqlAnalysis";

describe("isReadOnlyQuery", () => {
  it("accepts plain reads", () => {
    expect(isReadOnlyQuery("SELECT * FROM users")).toBe(true);
    expect(isReadOnlyQuery("  select 1;  ")).toBe(true);
    expect(isReadOnlyQuery("SHOW TABLES")).toBe(true);
    expect(isReadOnlyQuery("DESCRIBE users")).toBe(true);
    expect(isReadOnlyQuery("PRAGMA table_info(users)")).toBe(true);
    expect(isReadOnlyQuery("SELECT 1; SELECT 2;")).toBe(true);
    expect(isReadOnlyQuery("")).toBe(true);
  });

  it("flags writes and DDL", () => {
    expect(isReadOnlyQuery("INSERT INTO t VALUES (1)")).toBe(false);
    expect(isReadOnlyQuery("UPDATE t SET a = 1 WHERE id = 2")).toBe(false);
    expect(isReadOnlyQuery("DELETE FROM t WHERE id = 2")).toBe(false);
    expect(isReadOnlyQuery("DROP TABLE t")).toBe(false);
    expect(isReadOnlyQuery("TRUNCATE t")).toBe(false);
    expect(isReadOnlyQuery("ALTER TABLE t ADD COLUMN c int")).toBe(false);
    expect(isReadOnlyQuery("CREATE TABLE t (id int)")).toBe(false);
  });

  it("flags a write hidden in a multi-statement batch", () => {
    expect(isReadOnlyQuery("SELECT 1; DELETE FROM t; SELECT 2")).toBe(false);
  });

  it("treats unknown statement types as potential writes", () => {
    expect(isReadOnlyQuery("CALL cleanup_procedure()")).toBe(false);
    expect(isReadOnlyQuery("SET search_path TO app")).toBe(false);
    expect(isReadOnlyQuery("VACUUM")).toBe(false);
  });

  it("classifies EXPLAIN by its target statement", () => {
    expect(isReadOnlyQuery("EXPLAIN SELECT * FROM t")).toBe(true);
    expect(isReadOnlyQuery("EXPLAIN ANALYZE SELECT * FROM t")).toBe(true);
    // Postgres actually executes the target of EXPLAIN ANALYZE.
    expect(isReadOnlyQuery("EXPLAIN ANALYZE UPDATE t SET a = 1")).toBe(false);
    expect(isReadOnlyQuery("EXPLAIN (ANALYZE, BUFFERS) DELETE FROM t")).toBe(
      false,
    );
  });

  it("sees through data-modifying CTEs", () => {
    expect(isReadOnlyQuery("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
    expect(
      isReadOnlyQuery("WITH gone AS (SELECT id FROM t) DELETE FROM t"),
    ).toBe(false);
  });

  it("ignores keywords inside comments and string literals", () => {
    expect(isReadOnlyQuery("SELECT * FROM t -- DELETE FROM t")).toBe(true);
    expect(isReadOnlyQuery("SELECT 'DROP TABLE users' AS threat")).toBe(true);
    expect(isReadOnlyQuery("/* UPDATE t */ SELECT 1")).toBe(true);
    expect(isReadOnlyQuery("SELECT ';DELETE FROM t;' FROM dual")).toBe(true);
  });
});
