import { describe, it, expect } from "vitest";
import { isJsonColumn, isHstoreColumn } from "./json";

describe("isJsonColumn", () => {
  it("recognizes JSON and JSONB regardless of case", () => {
    expect(isJsonColumn("json")).toBe(true);
    expect(isJsonColumn("JSON")).toBe(true);
    expect(isJsonColumn("jsonb")).toBe(true);
    expect(isJsonColumn("JSONB")).toBe(true);
  });

  it("rejects non-JSON types and empty input", () => {
    expect(isJsonColumn("text")).toBe(false);
    expect(isJsonColumn("USER-DEFINED")).toBe(false);
    expect(isJsonColumn("")).toBe(false);
  });
});

describe("isHstoreColumn", () => {
  it("recognizes hstore regardless of case", () => {
    expect(isHstoreColumn("hstore")).toBe(true);
    expect(isHstoreColumn("HSTORE")).toBe(true);
  });

  it("rejects other user-defined type names", () => {
    expect(isHstoreColumn("citext")).toBe(false);
    expect(isHstoreColumn("mood")).toBe(false);
    expect(isHstoreColumn("text")).toBe(false);
  });

  it("returns false for missing type", () => {
    expect(isHstoreColumn(undefined)).toBe(false);
    expect(isHstoreColumn(null)).toBe(false);
    expect(isHstoreColumn("")).toBe(false);
  });
});