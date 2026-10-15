import { describe, it, expect } from "vitest";
import {
  buildRoutineCallArgs,
  isCallParameter,
  isNumericDataType,
  isOutputOnly,
  type RoutineArgInput,
  type RoutineParameterInfo,
} from "../../src/utils/routineCall";

function param(
  overrides: Partial<RoutineParameterInfo> = {},
): RoutineParameterInfo {
  return {
    name: "p_value",
    data_type: "varchar",
    mode: "IN",
    ordinal_position: 1,
    ...overrides,
  };
}

function input(overrides: Partial<RoutineArgInput> = {}): RoutineArgInput {
  return { value: "", isNull: false, isRaw: false, ...overrides };
}

describe("routineCall", () => {
  describe("isCallParameter", () => {
    it("should accept positions >= 1", () => {
      expect(isCallParameter(param({ ordinal_position: 1 }))).toBe(true);
      expect(isCallParameter(param({ ordinal_position: 3 }))).toBe(true);
    });

    it("should reject the return-value pseudo-parameter at position 0", () => {
      expect(
        isCallParameter(param({ ordinal_position: 0, name: "", mode: "OUT" })),
      ).toBe(false);
    });
  });

  describe("isOutputOnly", () => {
    it("should detect OUT mode case-insensitively", () => {
      expect(isOutputOnly(param({ mode: "OUT" }))).toBe(true);
      expect(isOutputOnly(param({ mode: "out" }))).toBe(true);
    });

    it("should treat IN and INOUT as inputs", () => {
      expect(isOutputOnly(param({ mode: "IN" }))).toBe(false);
      expect(isOutputOnly(param({ mode: "INOUT" }))).toBe(false);
    });
  });

  describe("isNumericDataType", () => {
    it("should match numeric families", () => {
      for (const t of [
        "int",
        "INTEGER",
        "bigint",
        "decimal(10,2)",
        "double precision",
        "numeric",
        "boolean",
        " float ",
      ]) {
        expect(isNumericDataType(t), t).toBe(true);
      }
    });

    it("should not match string or temporal types", () => {
      for (const t of ["varchar(50)", "text", "datetime", "json", "interval"]) {
        expect(isNumericDataType(t), t).toBe(false);
      }
    });

    it("should not match types merely containing a numeric word", () => {
      expect(isNumericDataType("varchar_int")).toBe(false);
      expect(isNumericDataType("pointer")).toBe(false);
    });
  });

  describe("buildRoutineCallArgs", () => {
    it("should order arguments by ordinal position", () => {
      const params = [
        param({ name: "b", ordinal_position: 2 }),
        param({ name: "a", ordinal_position: 1 }),
      ];
      const args = buildRoutineCallArgs(params, {
        1: input({ value: "first" }),
        2: input({ value: "second" }),
      });
      expect(args.map((a) => a.name)).toEqual(["a", "b"]);
      expect(args.map((a) => a.value)).toEqual(["first", "second"]);
    });

    it("should exclude the return-value pseudo-parameter", () => {
      const params = [
        param({ name: "", mode: "OUT", ordinal_position: 0 }),
        param({ ordinal_position: 1 }),
      ];
      const args = buildRoutineCallArgs(params, { 1: input({ value: "x" }) });
      expect(args).toHaveLength(1);
      expect(args[0].name).toBe("p_value");
    });

    it("should send null for OUT parameters regardless of input state", () => {
      const params = [param({ name: "p_out", mode: "OUT" })];
      const args = buildRoutineCallArgs(params, {
        1: input({ value: "ignored" }),
      });
      expect(args[0].value).toBeNull();
    });

    it("should send null when the NULL checkbox is set or input is missing", () => {
      const params = [
        param({ name: "a", ordinal_position: 1 }),
        param({ name: "b", ordinal_position: 2 }),
      ];
      const args = buildRoutineCallArgs(params, {
        1: input({ value: "x", isNull: true }),
      });
      expect(args[0].value).toBeNull();
      expect(args[1].value).toBeNull();
    });

    it("should forward the raw flag", () => {
      const params = [param({ data_type: "int" })];
      const args = buildRoutineCallArgs(params, {
        1: input({ value: "42", isRaw: true }),
      });
      expect(args[0]).toEqual({
        name: "p_value",
        mode: "IN",
        value: "42",
        is_raw: true,
      });
    });
  });
});
