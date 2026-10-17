import { describe, it, expect } from "vitest";
import {
  getSavedQueryExcerpt,
  matchesSavedQuery,
  EXCERPT_MAX_LENGTH,
} from "../../src/utils/savedQuerySearch";

describe("matchesSavedQuery", () => {
  const query = { name: "Monthly Report", sql: "SELECT *\nFROM Orders" };

  it("matches everything when the search is empty or blank", () => {
    expect(matchesSavedQuery(query, "")).toBe(true);
    expect(matchesSavedQuery(query, "   ")).toBe(true);
  });

  it("matches the name and the SQL body case-insensitively", () => {
    expect(matchesSavedQuery(query, "monthly")).toBe(true);
    expect(matchesSavedQuery(query, "ORDERS")).toBe(true);
    expect(matchesSavedQuery(query, "missing")).toBe(false);
  });

  it("treats regex characters literally", () => {
    expect(matchesSavedQuery({ name: "a", sql: "SELECT 1" }, ".*")).toBe(false);
    expect(matchesSavedQuery({ name: "a", sql: "WHERE x (y)" }, "(y)")).toBe(true);
  });
});

describe("getSavedQueryExcerpt", () => {
  it("returns null without a search or without a SQL match", () => {
    expect(getSavedQueryExcerpt("SELECT 1", "")).toBeNull();
    expect(getSavedQueryExcerpt("SELECT 1", "  ")).toBeNull();
    expect(getSavedQueryExcerpt("SELECT 1", "orders")).toBeNull();
  });

  it("returns the line of a match beyond the first line, keeping original casing", () => {
    const sql = "SELECT id\n  FROM Orders\nWHERE x = 1";
    expect(getSavedQueryExcerpt(sql, "orders")).toEqual({
      before: "FROM ",
      match: "Orders",
      after: "",
      truncatedStart: false,
      truncatedEnd: false,
    });
  });

  it("only uses the first match", () => {
    const result = getSavedQueryExcerpt("a foo b\nfoo c", "foo");
    expect(result?.before).toBe("a ");
    expect(result?.after).toBe(" b");
  });

  it("handles matches on the first line and CRLF endings", () => {
    const result = getSavedQueryExcerpt("SELECT 1\r\nFROM t", "select");
    expect(result).toMatchObject({ before: "", match: "SELECT", after: " 1" });
  });

  it("trims a long line to a window around the match with ellipses", () => {
    const sql = `${"a".repeat(200)} NEEDLE ${"b".repeat(200)}`;
    const result = getSavedQueryExcerpt(sql, "needle")!;
    expect(result.match).toBe("NEEDLE");
    expect(result.truncatedStart).toBe(true);
    expect(result.truncatedEnd).toBe(true);
    expect(result.before.length + result.match.length + result.after.length).toBe(
      EXCERPT_MAX_LENGTH,
    );
  });

  it("does not truncate the start when the match is near the beginning", () => {
    const result = getSavedQueryExcerpt(`id, ${"x".repeat(200)}`, "id")!;
    expect(result.truncatedStart).toBe(false);
    expect(result.truncatedEnd).toBe(true);
  });

  it("keeps the whole match even when it exceeds the window", () => {
    const term = "z".repeat(120);
    const result = getSavedQueryExcerpt(`select ${term} from t`, term)!;
    expect(result.match).toBe(term);
  });

  it("keeps markup and special characters verbatim", () => {
    const result = getSavedQueryExcerpt("WHERE a = '<b>x</b>' AND c", "<b>")!;
    expect(result.match).toBe("<b>");
    expect(result.after).toBe("x</b>' AND c");
  });

  it("is not thrown off by characters whose case mapping changes length", () => {
    const result = getSavedQueryExcerpt("İİİ select x", "select")!;
    expect(result.before).toBe("İİİ ");
    expect(result.match).toBe("select");
  });
});
