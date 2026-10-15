import { describe, it, expect } from "vitest";
import type { QueryHistoryEntry } from "../../src/types/queryHistory";
import {
  formatHistoryEntryDetails,
  formatHistoryTimestamp,
} from "../../src/utils/queryHistoryDetails";

const labels = {
  database: "Database",
  executed: "Executed",
  duration: "Duration",
  rowsAffected: "Rows affected",
  status: "Status",
  success: "success",
  error: "error",
};

const base: QueryHistoryEntry = {
  id: "1",
  sql: "SELECT * FROM orders;",
  executedAt: "2026-10-12T12:03:22.000Z",
  executionTimeMs: 1240,
  status: "success",
  rowsAffected: 3,
  error: null,
  database: "shop",
};

describe("formatHistoryTimestamp", () => {
  it("renders the instant in the given timezone", () => {
    expect(formatHistoryTimestamp(base.executedAt, "UTC")).toBe("2026-10-12 12:03:22");
    expect(formatHistoryTimestamp(base.executedAt, "Europe/Rome")).toBe("2026-10-12 14:03:22");
  });

  it("returns unparseable values unchanged", () => {
    expect(formatHistoryTimestamp("not a date", "UTC")).toBe("not a date");
  });
});

describe("formatHistoryEntryDetails", () => {
  it("summarises a successful entry", () => {
    expect(formatHistoryEntryDetails(base, labels, "UTC")).toBe(
      [
        "Database: shop",
        "Executed: 2026-10-12 12:03:22",
        "Duration: 1.24 s",
        "Rows affected: 3",
        "Status: success",
        "",
        "SELECT * FROM orders;",
      ].join("\n"),
    );
  });

  it("includes the error message of a failed entry", () => {
    const entry: QueryHistoryEntry = {
      ...base,
      sql: "SELECT * FROM orders2;",
      status: "error",
      rowsAffected: null,
      error: 'relation "orders2" does not exist',
    };
    expect(formatHistoryEntryDetails(entry, labels, "Europe/Rome")).toBe(
      [
        "Database: shop",
        "Executed: 2026-10-12 14:03:22",
        "Duration: 1.24 s",
        'Status: error: relation "orders2" does not exist',
        "",
        "SELECT * FROM orders2;",
      ].join("\n"),
    );
  });

  it("omits values that were not recorded", () => {
    const entry: QueryHistoryEntry = {
      ...base,
      status: "error",
      executionTimeMs: null,
      rowsAffected: null,
      error: null,
      database: null,
    };
    const text = formatHistoryEntryDetails(entry, labels, "UTC");
    expect(text).toBe(
      ["Executed: 2026-10-12 12:03:22", "Status: error", "", "SELECT * FROM orders;"].join("\n"),
    );
    expect(text).not.toContain("null");
  });
});
