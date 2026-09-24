import { describe, it, expect } from "vitest";
import {
  validateDumpOptions,
  toggleTableSelection,
  selectAllTables,
} from "../../src/utils/dumpUtils";

describe("Dump Utils", () => {
  describe("validateDumpOptions", () => {
    it("should return valid when options and tables are selected", () => {
      const result = validateDumpOptions(true, true, new Set(["table1"]));
      expect(result.isValid).toBe(true);
      expect(result.errorKey).toBeUndefined();
    });

    it("should return error when neither structure nor data is selected", () => {
      const result = validateDumpOptions(false, false, new Set(["table1"]));
      expect(result.isValid).toBe(false);
      expect(result.errorKey).toBe("dump.errorNoOption");
    });

    it("should return error when no tables are selected", () => {
      const result = validateDumpOptions(true, true, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errorKey).toBe("dump.errorNoTables");
    });

    it("should be valid with only structure", () => {
      const result = validateDumpOptions(true, false, new Set(["table1"]));
      expect(result.isValid).toBe(true);
    });

    it("should be valid with only data", () => {
      const result = validateDumpOptions(false, true, new Set(["table1"]));
      expect(result.isValid).toBe(true);
    });
  });

  describe("toggleTableSelection", () => {
    it("should add table if not present", () => {
      const initial = new Set(["t1"]);
      const result = toggleTableSelection(initial, "t2");
      expect(result.has("t1")).toBe(true);
      expect(result.has("t2")).toBe(true);
      expect(result.size).toBe(2);
    });

    it("should remove table if present", () => {
      const initial = new Set(["t1", "t2"]);
      const result = toggleTableSelection(initial, "t1");
      expect(result.has("t1")).toBe(false);
      expect(result.has("t2")).toBe(true);
      expect(result.size).toBe(1);
    });
  });

  describe("selectAllTables", () => {
    it("should select all tables if not all are currently selected", () => {
      const initial = new Set(["t1"]);
      const all = ["t1", "t2", "t3"];
      const result = selectAllTables(initial, all);
      expect(result.size).toBe(3);
      expect(result.has("t1")).toBe(true);
      expect(result.has("t2")).toBe(true);
      expect(result.has("t3")).toBe(true);
    });

    it("should deselect all tables if all are currently selected", () => {
      const initial = new Set(["t1", "t2", "t3"]);
      const all = ["t1", "t2", "t3"];
      const result = selectAllTables(initial, all);
      expect(result.size).toBe(0);
    });
  });
});
