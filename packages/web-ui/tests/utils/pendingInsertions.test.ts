import { describe, it, expect } from "vitest";
import {
  generateTempId,
  initializeNewRow,
  validatePendingInsertion,
  insertionToBackendData,
  filterInsertionsBySelection,
} from "../../src/utils/pendingInsertions";
import type { TableColumn, PendingInsertion } from "../../src/types/editor";

describe("pendingInsertions", () => {
  describe("generateTempId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateTempId();
      const id2 = generateTempId();
      expect(id1).not.toBe(id2);
    });

    it("should start with 'temp_' prefix", () => {
      const id = generateTempId();
      expect(id).toMatch(/^temp_/);
    });

    it("should contain timestamp and random string", () => {
      const id = generateTempId();
      expect(id).toMatch(/^temp_\d+_[a-z0-9]+$/);
    });
  });

  describe("initializeNewRow", () => {
    it("should set NULL for auto-increment columns", () => {
      const columns: TableColumn[] = [
        {
          name: "id",
          data_type: "INTEGER",
          is_pk: true,
          is_nullable: false,
          is_auto_increment: true,
        },
        {
          name: "name",
          data_type: "TEXT",
          is_pk: false,
          is_nullable: false,
          is_auto_increment: false,
        },
      ];
      const data = initializeNewRow(columns);
      expect(data.id).toBe(null);
    });

    it("should set NULL for nullable columns", () => {
      const columns: TableColumn[] = [
        {
          name: "email",
          data_type: "TEXT",
          is_pk: false,
          is_nullable: true,
          is_auto_increment: false,
        },
      ];
      const data = initializeNewRow(columns);
      expect(data.email).toBe(null);
    });

    it("should set empty string for required columns", () => {
      const columns: TableColumn[] = [
        {
          name: "name",
          data_type: "TEXT",
          is_pk: false,
          is_nullable: false,
          is_auto_increment: false,
        },
      ];
      const data = initializeNewRow(columns);
      expect(data.name).toBe("");
    });

    it("should initialize all columns", () => {
      const columns: TableColumn[] = [
        {
          name: "id",
          data_type: "INTEGER",
          is_pk: true,
          is_nullable: false,
          is_auto_increment: true,
        },
        {
          name: "name",
          data_type: "TEXT",
          is_pk: false,
          is_nullable: false,
          is_auto_increment: false,
        },
        {
          name: "email",
          data_type: "TEXT",
          is_pk: false,
          is_nullable: true,
          is_auto_increment: false,
        },
      ];
      const data = initializeNewRow(columns);
      expect(Object.keys(data)).toHaveLength(3);
      expect(data.id).toBe(null);
      expect(data.name).toBe("");
      expect(data.email).toBe(null);
    });

    it("should handle empty columns array", () => {
      const data = initializeNewRow([]);
      expect(Object.keys(data)).toHaveLength(0);
    });
  });

  describe("validatePendingInsertion", () => {
    const columns: TableColumn[] = [
      {
        name: "id",
        data_type: "INTEGER",
        is_pk: true,
        is_nullable: false,
        is_auto_increment: true,
      },
      {
        name: "name",
        data_type: "TEXT",
        is_pk: false,
        is_nullable: false,
        is_auto_increment: false,
      },
      {
        name: "email",
        data_type: "TEXT",
        is_pk: false,
        is_nullable: true,
        is_auto_increment: false,
      },
    ];

    it("should return no errors for valid insertion", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "John", email: null },
        displayIndex: 0,
      };
      const errors = validatePendingInsertion(insertion, columns);
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it("should detect missing required field (null)", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: null, email: null },
        displayIndex: 0,
      };
      const errors = validatePendingInsertion(insertion, columns);
      expect(errors.name).toBe("Required field");
    });

    it("should detect missing required field (empty string)", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "", email: null },
        displayIndex: 0,
      };
      const errors = validatePendingInsertion(insertion, columns);
      expect(errors.name).toBe("Required field");
    });

    it("should detect missing required field (undefined)", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: undefined, email: null },
        displayIndex: 0,
      };
      const errors = validatePendingInsertion(insertion, columns);
      expect(errors.name).toBe("Required field");
    });

    it("should skip auto-increment columns in validation", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "John", email: null },
        displayIndex: 0,
      };
      const errors = validatePendingInsertion(insertion, columns);
      expect(errors.id).toBeUndefined();
    });

    it("should allow NULL for nullable columns", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "John", email: null },
        displayIndex: 0,
      };
      const errors = validatePendingInsertion(insertion, columns);
      expect(errors.email).toBeUndefined();
    });

    it("should detect multiple missing required fields", () => {
      const columnsWithMultipleRequired: TableColumn[] = [
        {
          name: "id",
          data_type: "INTEGER",
          is_pk: true,
          is_nullable: false,
          is_auto_increment: true,
        },
        {
          name: "name",
          data_type: "TEXT",
          is_pk: false,
          is_nullable: false,
          is_auto_increment: false,
        },
        {
          name: "age",
          data_type: "INTEGER",
          is_pk: false,
          is_nullable: false,
          is_auto_increment: false,
        },
      ];

      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "", age: null },
        displayIndex: 0,
      };
      const errors = validatePendingInsertion(insertion, columnsWithMultipleRequired);
      expect(errors.name).toBe("Required field");
      expect(errors.age).toBe("Required field");
      expect(Object.keys(errors)).toHaveLength(2);
    });
  });

  describe("insertionToBackendData", () => {
    const columns: TableColumn[] = [
      {
        name: "id",
        data_type: "INTEGER",
        is_pk: true,
        is_nullable: false,
        is_auto_increment: true,
      },
      {
        name: "name",
        data_type: "TEXT",
        is_pk: false,
        is_nullable: false,
        is_auto_increment: false,
      },
      {
        name: "email",
        data_type: "TEXT",
        is_pk: false,
        is_nullable: true,
        is_auto_increment: false,
      },
    ];

    it("should exclude auto-increment columns", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "John", email: "john@example.com" },
        displayIndex: 0,
      };
      const backendData = insertionToBackendData(insertion, columns);
      expect(backendData.id).toBeUndefined();
      expect(backendData.name).toBe("John");
      expect(backendData.email).toBe("john@example.com");
    });

    it("should include nullable columns with null values", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "John", email: null },
        displayIndex: 0,
      };
      const backendData = insertionToBackendData(insertion, columns);
      expect(backendData.email).toBe(null);
    });

    it("should handle empty data", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "", email: "" },
        displayIndex: 0,
      };
      const backendData = insertionToBackendData(insertion, columns);
      expect(backendData.name).toBe("");
      expect(backendData.email).toBe("");
    });

    it("should only include columns that exist in schema", () => {
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: { id: null, name: "John", email: "john@example.com" },
        displayIndex: 0,
      };
      const backendData = insertionToBackendData(insertion, columns);
      expect(Object.keys(backendData)).toHaveLength(2); // name + email (id excluded)
    });

    it("should exclude generated columns", () => {
      const columnsWithGenerated: TableColumn[] = [
        ...columns,
        {
          name: "display_name",
          data_type: "TEXT",
          is_pk: false,
          is_nullable: true,
          is_auto_increment: false,
          is_generated: true,
        },
      ];
      const insertion: PendingInsertion = {
        tempId: "temp_123",
        data: {
          id: null,
          name: "John",
          email: null,
          display_name: "John",
        },
        displayIndex: 0,
      };

      const backendData = insertionToBackendData(insertion, columnsWithGenerated);

      expect(backendData.display_name).toBeUndefined();
      expect(backendData.name).toBe("John");
    });
  });

  describe("filterInsertionsBySelection", () => {
    it("should filter by selected display indices", () => {
      const insertions: Record<string, PendingInsertion> = {
        temp_1: { tempId: "temp_1", data: {}, displayIndex: 0 },
        temp_2: { tempId: "temp_2", data: {}, displayIndex: 1 },
        temp_3: { tempId: "temp_3", data: {}, displayIndex: 2 },
      };
      const selected = new Set([0, 2]);
      const filtered = filterInsertionsBySelection(insertions, selected);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((i) => i.tempId)).toEqual(["temp_1", "temp_3"]);
    });

    it("should return empty array if no selection", () => {
      const insertions: Record<string, PendingInsertion> = {
        temp_1: { tempId: "temp_1", data: {}, displayIndex: 0 },
        temp_2: { tempId: "temp_2", data: {}, displayIndex: 1 },
      };
      const selected = new Set<number>();
      const filtered = filterInsertionsBySelection(insertions, selected);
      expect(filtered).toHaveLength(0);
    });

    it("should return all insertions if all are selected", () => {
      const insertions: Record<string, PendingInsertion> = {
        temp_1: { tempId: "temp_1", data: {}, displayIndex: 0 },
        temp_2: { tempId: "temp_2", data: {}, displayIndex: 1 },
        temp_3: { tempId: "temp_3", data: {}, displayIndex: 2 },
      };
      const selected = new Set([0, 1, 2]);
      const filtered = filterInsertionsBySelection(insertions, selected);
      expect(filtered).toHaveLength(3);
    });

    it("should handle empty insertions record", () => {
      const insertions: Record<string, PendingInsertion> = {};
      const selected = new Set([0, 1]);
      const filtered = filterInsertionsBySelection(insertions, selected);
      expect(filtered).toHaveLength(0);
    });

    it("should handle selection with non-existent indices", () => {
      const insertions: Record<string, PendingInsertion> = {
        temp_1: { tempId: "temp_1", data: {}, displayIndex: 0 },
        temp_2: { tempId: "temp_2", data: {}, displayIndex: 1 },
      };
      const selected = new Set([0, 5, 10]); // 5 and 10 don't exist
      const filtered = filterInsertionsBySelection(insertions, selected);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].tempId).toBe("temp_1");
    });
  });
});
