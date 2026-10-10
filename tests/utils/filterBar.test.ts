import { describe, it, expect } from "vitest";
import {
  filterColumnSuggestions,
  getCurrentWordPrefix,
  replaceCurrentWord,
  getOperatorsForType,
  buildSingleFilterClause,
  buildStructuredFilterClause,
  createEmptyFilter,
  isValuePickerSupported,
  buildDistinctValuesQuery,
  buildValuePickerWhere,
  parseDistinctValues,
  filterDistinctValues,
  formatPickedValue,
  applyPickedValues,
  getPickedValues,
  splitInList,
  VALUE_PICKER_LIMIT,
} from "../../src/utils/filterBar";
import type { TableColumn } from "../../src/types/editor";
import type { StructuredFilter } from "../../src/utils/filterBar";
import type { DriverCapabilities } from "../../src/types/plugins";

const makeColumn = (name: string, data_type: string): TableColumn => ({
  name,
  data_type,
  is_pk: false,
  is_nullable: true,
  is_auto_increment: false,
});

describe("filterBar utils", () => {
  describe("filterColumnSuggestions", () => {
    const columns: TableColumn[] = [
      makeColumn("user_id", "INTEGER"),
      makeColumn("user_name", "VARCHAR"),
      makeColumn("user_email", "VARCHAR"),
      makeColumn("created_at", "DATETIME"),
      makeColumn("status", "VARCHAR"),
    ];

    it("should return all columns (up to 10) when prefix is empty", () => {
      const result = filterColumnSuggestions(columns, "");
      expect(result).toHaveLength(5);
    });

    it("should filter by prefix (case-insensitive)", () => {
      const result = filterColumnSuggestions(columns, "user");
      expect(result).toHaveLength(3);
      expect(result.map((c) => c.name)).toEqual([
        "user_id",
        "user_name",
        "user_email",
      ]);
    });

    it("should match uppercase prefix against lowercase column names", () => {
      const result = filterColumnSuggestions(columns, "USER");
      expect(result).toHaveLength(3);
    });

    it("should return empty array when no columns match", () => {
      const result = filterColumnSuggestions(columns, "xyz");
      expect(result).toHaveLength(0);
    });

    it("should cap results at 10", () => {
      const manyColumns: TableColumn[] = Array.from({ length: 15 }, (_, i) =>
        makeColumn(`col_${i}`, "VARCHAR")
      );
      const result = filterColumnSuggestions(manyColumns, "col");
      expect(result).toHaveLength(10);
    });

    it("should return empty array for empty columns list", () => {
      const result = filterColumnSuggestions([], "user");
      expect(result).toHaveLength(0);
    });

    it("should handle exact match", () => {
      const result = filterColumnSuggestions(columns, "status");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("status");
    });
  });

  describe("getCurrentWordPrefix", () => {
    it("should return the word being typed at cursor", () => {
      expect(getCurrentWordPrefix("user_id > 5", 7)).toBe("user_id");
    });

    it("should return partial word at cursor in the middle", () => {
      expect(getCurrentWordPrefix("user", 2)).toBe("us");
    });

    it("should return empty string when cursor is after a space", () => {
      expect(getCurrentWordPrefix("id > ", 5)).toBe("");
    });

    it("should return empty string at start of input", () => {
      expect(getCurrentWordPrefix("", 0)).toBe("");
    });

    it("should return word after operator and space", () => {
      expect(getCurrentWordPrefix("id > user_id", 12)).toBe("user_id");
    });

    it("should handle cursor at end of word", () => {
      expect(getCurrentWordPrefix("status", 6)).toBe("status");
    });

    it("should handle underscore as part of word", () => {
      expect(getCurrentWordPrefix("created_at", 10)).toBe("created_at");
    });

    it("should stop at non-identifier characters", () => {
      expect(getCurrentWordPrefix("id=5 AND user", 13)).toBe("user");
    });
  });

  describe("replaceCurrentWord", () => {
    it("should replace word at cursor with replacement", () => {
      const result = replaceCurrentWord("use", 3, "user_id");
      expect(result).toBe("user_id");
    });

    it("should replace word in middle of string", () => {
      const result = replaceCurrentWord("us > 5", 2, "user_id");
      expect(result).toBe("user_id > 5");
    });

    it("should replace whole word when cursor is in the middle", () => {
      const result = replaceCurrentWord("user_id > 5", 4, "user_name");
      expect(result).toBe("user_name > 5");
    });

    it("should handle empty input", () => {
      const result = replaceCurrentWord("", 0, "user_id");
      expect(result).toBe("user_id");
    });

    it("should append replacement when cursor is after a space", () => {
      const result = replaceCurrentWord("id > ", 5, "user_id");
      expect(result).toBe("id > user_id");
    });
  });

  describe("getOperatorsForType", () => {
    it("should return comparison and range operators for integer types", () => {
      const ops = getOperatorsForType("INTEGER");
      expect(ops).toContain("=");
      expect(ops).toContain(">");
      expect(ops).toContain("<");
      expect(ops).toContain("BETWEEN");
      expect(ops).toContain("IS NULL");
    });

    it("should return LIKE operators for varchar types", () => {
      const ops = getOperatorsForType("VARCHAR");
      expect(ops).toContain("LIKE");
      expect(ops).toContain("NOT LIKE");
      expect(ops).toContain("IS NULL");
    });

    it("should return text-friendly operators for varchar types", () => {
      const ops = getOperatorsForType("VARCHAR");
      expect(ops).toContain("contains");
      expect(ops).toContain("starts with");
      expect(ops).toContain("ends with");
      expect(ops).toContain("is empty");
      expect(ops).toContain("is not empty");
    });

    it("should return text-friendly operators for TEXT types", () => {
      const ops = getOperatorsForType("TEXT");
      expect(ops).toContain("contains");
      expect(ops).toContain("starts with");
      expect(ops).toContain("ends with");
      expect(ops).toContain("is empty");
      expect(ops).toContain("is not empty");
    });

    it("should NOT return text-friendly operators for numeric types", () => {
      const ops = getOperatorsForType("INTEGER");
      expect(ops).not.toContain("contains");
      expect(ops).not.toContain("starts with");
      expect(ops).not.toContain("ends with");
      expect(ops).not.toContain("is empty");
      expect(ops).not.toContain("is not empty");
    });

    it("should NOT return BETWEEN for varchar types", () => {
      const ops = getOperatorsForType("VARCHAR");
      expect(ops).not.toContain("BETWEEN");
    });

    it("should handle case-insensitive type names", () => {
      const ops = getOperatorsForType("varchar(255)");
      expect(ops).toContain("LIKE");
    });

    it("should return all operators for unknown types", () => {
      const ops = getOperatorsForType("geometry");
      expect(ops).toContain("=");
      expect(ops).toContain("IS NULL");
    });

    it("should always include IS NULL and IS NOT NULL", () => {
      for (const type of ["INTEGER", "VARCHAR", "TEXT", "FLOAT", "DATETIME"]) {
        const ops = getOperatorsForType(type);
        expect(ops).toContain("IS NULL");
        expect(ops).toContain("IS NOT NULL");
      }
    });

    it("should include IN and NOT IN for numeric types", () => {
      const ops = getOperatorsForType("BIGINT");
      expect(ops).toContain("IN");
      expect(ops).toContain("NOT IN");
    });
  });

  describe("buildSingleFilterClause", () => {
    it("should build simple equality clause", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "status",
        operator: "=",
        value: "active",
      };
      expect(buildSingleFilterClause(filter)).toBe("status = 'active'");
    });

    it("should not quote numeric values", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "id",
        operator: ">",
        value: "5",
      };
      expect(buildSingleFilterClause(filter)).toBe("id > 5");
    });

    it("should build IS NULL clause (ignores value)", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "deleted_at",
        operator: "IS NULL",
        value: "ignored",
      };
      expect(buildSingleFilterClause(filter)).toBe("deleted_at IS NULL");
    });

    it("should build IS NOT NULL clause", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "email",
        operator: "IS NOT NULL",
        value: "",
      };
      expect(buildSingleFilterClause(filter)).toBe("email IS NOT NULL");
    });

    it("should build BETWEEN clause", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "age",
        operator: "BETWEEN",
        value: "18",
        value2: "65",
      };
      expect(buildSingleFilterClause(filter)).toBe("age BETWEEN 18 AND 65");
    });

    it("should build IN clause with comma-separated values", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "status",
        operator: "IN",
        value: "active, inactive, pending",
      };
      expect(buildSingleFilterClause(filter)).toBe(
        "status IN ('active', 'inactive', 'pending')"
      );
    });

    it("should keep commas inside quoted IN values", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "city",
        operator: "IN",
        value: "'Paris, TX', Rome, 'O''Hare'",
      };
      expect(buildSingleFilterClause(filter)).toBe(
        "city IN ('Paris, TX', 'Rome', 'O''Hare')"
      );
    });

    it("should still quote an unquoted IN value with an apostrophe", () => {
      const filter: StructuredFilter = { id: "1", column: "city", operator: "IN", value: "O'Hare, Rome" };
      expect(buildSingleFilterClause(filter)).toBe("city IN ('O''Hare', 'Rome')");
    });

    it("should keep an explicitly quoted empty string in IN but drop empty items", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "code",
        operator: "IN",
        value: "a,, '', b,",
      };
      expect(buildSingleFilterClause(filter)).toBe("code IN ('a', '', 'b')");
    });

    it("should build NOT IN clause", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "id",
        operator: "NOT IN",
        value: "1, 2, 3",
      };
      expect(buildSingleFilterClause(filter)).toBe("id NOT IN (1, 2, 3)");
    });

    it("should build LIKE clause", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "name",
        operator: "LIKE",
        value: "%john%",
      };
      expect(buildSingleFilterClause(filter)).toBe("name LIKE '%john%'");
    });

    it("should build NOT LIKE clause", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "email",
        operator: "NOT LIKE",
        value: "%spam%",
      };
      expect(buildSingleFilterClause(filter)).toBe("email NOT LIKE '%spam%'");
    });

    it("should escape single quotes in string values", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "name",
        operator: "=",
        value: "O'Brien",
      };
      expect(buildSingleFilterClause(filter)).toBe("name = 'O''Brien'");
    });

    it("should handle decimal numbers without quoting", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "price",
        operator: ">=",
        value: "9.99",
      };
      expect(buildSingleFilterClause(filter)).toBe("price >= 9.99");
    });

    it("should quote mixed-case column names for postgres driver", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "UserStatus",
        operator: "=",
        value: "active",
      };
      expect(buildSingleFilterClause(filter, "postgres")).toBe('"UserStatus" = \'active\'');
    });

    it("should not quote plain lowercase column names for postgres driver", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "user_status",
        operator: "=",
        value: "active",
      };
      expect(buildSingleFilterClause(filter, "postgres")).toBe("user_status = 'active'");
    });

    it("should not quote the column name for mysql driver", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "user_status",
        operator: "=",
        value: "active",
      };
      expect(buildSingleFilterClause(filter, "mysql")).toBe("user_status = 'active'");
    });

    it("should build contains as LIKE with surrounding wildcards and ESCAPE", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "name",
        operator: "contains",
        value: "john",
      };
      expect(buildSingleFilterClause(filter)).toBe(
        "name LIKE '%john%' ESCAPE '!'"
      );
    });

    it("should build starts with as LIKE with trailing wildcard and ESCAPE", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "email",
        operator: "starts with",
        value: "admin",
      };
      expect(buildSingleFilterClause(filter)).toBe(
        "email LIKE 'admin%' ESCAPE '!'"
      );
    });

    it("should build ends with as LIKE with leading wildcard and ESCAPE", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "email",
        operator: "ends with",
        value: "@example.com",
      };
      expect(buildSingleFilterClause(filter)).toBe(
        "email LIKE '%@example.com' ESCAPE '!'"
      );
    });

    it("should escape LIKE wildcards and the escape character in text operators", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "name",
        operator: "contains",
        value: "100%_off!\\sale",
      };
      // Backslash is not special with ESCAPE '!' on postgres/sqlite.
      expect(buildSingleFilterClause(filter)).toBe(
        "name LIKE '%100!%!_off!!\\sale%' ESCAPE '!'"
      );
    });

    it("should escape single quotes in text operator values", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "name",
        operator: "starts with",
        value: "O'Brien",
      };
      expect(buildSingleFilterClause(filter)).toBe(
        "name LIKE 'O''Brien%' ESCAPE '!'"
      );
    });

    it("should build is empty as NULL or empty string", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "nickname",
        operator: "is empty",
        value: "ignored",
      };
      expect(buildSingleFilterClause(filter)).toBe(
        "(nickname IS NULL OR nickname = '')"
      );
    });

    it("should build is not empty as negation of empty", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "nickname",
        operator: "is not empty",
        value: "",
      };
      expect(buildSingleFilterClause(filter)).toBe(
        "NOT (nickname IS NULL OR nickname = '')"
      );
    });

    it("should never emit ESCAPE '\\' for mysql/mariadb text operators", () => {
      for (const driver of ["mysql", "mariadb"]) {
        for (const [operator, expected] of [
          ["contains", "name LIKE '%john%' ESCAPE '!'"],
          ["starts with", "name LIKE 'john%' ESCAPE '!'"],
          ["ends with", "name LIKE '%john' ESCAPE '!'"],
        ] as const) {
          const filter: StructuredFilter = {
            id: "1",
            column: "name",
            operator,
            value: "john",
          };
          expect(buildSingleFilterClause(filter, driver)).toBe(expected);
        }
      }
    });

    it("should double backslashes in the mysql literal so they match literally", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "path",
        operator: "contains",
        value: "C:\\temp_1%",
      };
      expect(buildSingleFilterClause(filter, "mysql")).toBe(
        "path LIKE '%C:\\\\temp!_1!%%' ESCAPE '!'"
      );
    });

    it("should detect mysql dialect from driver capabilities", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "path",
        operator: "starts with",
        value: "a\\b",
      };
      expect(
        buildSingleFilterClause(filter, {
          identifier_quote: "`",
          sql_dialect: "mysql",
        } as DriverCapabilities)
      ).toBe("path LIKE 'a\\\\b%' ESCAPE '!'");
      expect(
        buildSingleFilterClause(filter, {
          identifier_quote: '"',
          sql_dialect: "postgres",
        } as DriverCapabilities)
      ).toBe("path LIKE 'a\\b%' ESCAPE '!'");
    });

    it("should quote mixed-case columns with text operators for postgres", () => {
      const filter: StructuredFilter = {
        id: "1",
        column: "DisplayName",
        operator: "contains",
        value: "Ada",
      };
      expect(buildSingleFilterClause(filter, "postgres")).toBe(
        "\"DisplayName\" LIKE '%Ada%' ESCAPE '!'"
      );
    });
  });

  describe("buildStructuredFilterClause", () => {
    it("should return empty string for empty filters array", () => {
      expect(buildStructuredFilterClause([])).toBe("");
    });

    it("should return clause for single filter", () => {
      const filters: StructuredFilter[] = [
        { id: "1", column: "id", operator: ">", value: "5" },
      ];
      expect(buildStructuredFilterClause(filters)).toBe("id > 5");
    });

    it("should join multiple filters with AND", () => {
      const filters: StructuredFilter[] = [
        { id: "1", column: "status", operator: "=", value: "active" },
        { id: "2", column: "age", operator: ">", value: "18" },
      ];
      expect(buildStructuredFilterClause(filters)).toBe(
        "status = 'active' AND age > 18"
      );
    });

    it("should quote columns that require quoting for postgres in structured filters", () => {
      const filters: StructuredFilter[] = [
        { id: "1", column: "UserStatus", operator: "=", value: "active" },
        { id: "2", column: "order", operator: ">", value: "18" },
      ];
      expect(buildStructuredFilterClause(filters, "postgres")).toBe(
        '"UserStatus" = \'active\' AND "order" > 18'
      );
    });

    it("should skip filters with empty column", () => {
      const filters: StructuredFilter[] = [
        { id: "1", column: "", operator: "=", value: "val" },
        { id: "2", column: "status", operator: "=", value: "active" },
      ];
      expect(buildStructuredFilterClause(filters)).toBe("status = 'active'");
    });

    it("should handle three filters", () => {
      const filters: StructuredFilter[] = [
        { id: "1", column: "a", operator: "=", value: "1" },
        { id: "2", column: "b", operator: "IS NULL", value: "" },
        { id: "3", column: "c", operator: "LIKE", value: "%x%" },
      ];
      expect(buildStructuredFilterClause(filters)).toBe(
        "a = 1 AND b IS NULL AND c LIKE '%x%'"
      );
    });

    it("should join multiple filters with OR in parentheses", () => {
      const filters: StructuredFilter[] = [
        { id: "1", column: "status", operator: "=", value: "failed" },
        { id: "2", column: "retries", operator: ">", value: "3" },
      ];
      expect(buildStructuredFilterClause(filters, null, "OR")).toBe(
        "(status = 'failed' OR retries > 3)"
      );
    });

    it("should not parenthesize a single filter with OR", () => {
      const filters: StructuredFilter[] = [
        { id: "1", column: "id", operator: ">", value: "5" },
      ];
      expect(buildStructuredFilterClause(filters, null, "OR")).toBe("id > 5");
    });

    it("should ignore disabled filters with OR", () => {
      const filters: StructuredFilter[] = [
        { id: "1", column: "a", operator: "=", value: "1" },
        { id: "2", column: "b", operator: "=", value: "2", enabled: false },
        { id: "3", column: "c", operator: "=", value: "3" },
      ];
      expect(buildStructuredFilterClause(filters, null, "OR")).toBe(
        "(a = 1 OR c = 3)"
      );
    });

    it("should return empty string for OR with no filters", () => {
      expect(buildStructuredFilterClause([], null, "OR")).toBe("");
    });
  });

  describe("createEmptyFilter", () => {
    it("should return filter with first column name", () => {
      const columns = [makeColumn("id", "INTEGER"), makeColumn("name", "VARCHAR")];
      const filter = createEmptyFilter(columns);
      expect(filter.column).toBe("id");
    });

    it("should return filter with empty value", () => {
      const columns = [makeColumn("id", "INTEGER")];
      const filter = createEmptyFilter(columns);
      expect(filter.value).toBe("");
    });

    it("should have a non-empty id", () => {
      const columns = [makeColumn("id", "INTEGER")];
      const filter = createEmptyFilter(columns);
      expect(filter.id).toBeTruthy();
    });

    it("should return default operator for the column type", () => {
      const columns = [makeColumn("id", "INTEGER")];
      const filter = createEmptyFilter(columns);
      const validOps = getOperatorsForType("INTEGER");
      expect(validOps).toContain(filter.operator);
    });

    it("should handle empty columns list with empty column string", () => {
      const filter = createEmptyFilter([]);
      expect(filter.column).toBe("");
      expect(filter.value).toBe("");
    });

    it("should generate unique ids for consecutive calls", () => {
      const columns = [makeColumn("id", "INTEGER")];
      const f1 = createEmptyFilter(columns);
      const f2 = createEmptyFilter(columns);
      expect(f1.id).not.toBe(f2.id);
    });
  });

  describe("value picker", () => {
    const filters: StructuredFilter[] = [
      { id: "a", column: "status", operator: "=", value: "open" },
      { id: "b", column: "priority", operator: ">", value: "2" },
      { id: "c", column: "owner", operator: "=", value: "" },
      { id: "d", column: "deleted_at", operator: "IS NULL", value: "" },
      { id: "e", column: "region", operator: "=", value: "eu", enabled: false },
    ];

    describe("isValuePickerSupported", () => {
      it.each(["VARCHAR(20)", "text", "INTEGER", "boolean", "date", "enum('a','b')", "uuid", ""])(
        "offers the picker for %s",
        (type) => expect(isValuePickerSupported(type)).toBe(true)
      );

      it.each(["BLOB", "longblob", "bytea", "VARBINARY(16)", "binary(16)", "json", "JSONB", "image"])(
        "does not offer the picker for %s",
        (type) => expect(isValuePickerSupported(type)).toBe(false)
      );
    });

    describe("buildDistinctValuesQuery", () => {
      it("builds a grouped, most-frequent-first query for postgres", () => {
        expect(
          buildDistinctValuesQuery({ table: "orders", schema: "public", column: "Status", driver: "postgres" })
        ).toBe(
          'SELECT "Status", COUNT(*) FROM "public"."orders" WHERE "Status" IS NOT NULL ' +
            'GROUP BY "Status" ORDER BY 2 DESC, 1 LIMIT 100'
        );
      });

      it("uses backticks for mysql and mariadb", () => {
        for (const driver of ["mysql", "mariadb"]) {
          expect(buildDistinctValuesQuery({ table: "orders", column: "status", driver })).toBe(
            "SELECT `status`, COUNT(*) FROM `orders` WHERE `status` IS NOT NULL " +
              "GROUP BY `status` ORDER BY 2 DESC, 1 LIMIT 100"
          );
        }
      });

      it("uses double quotes for sqlite", () => {
        expect(buildDistinctValuesQuery({ table: "orders", column: "status", driver: "sqlite" })).toBe(
          'SELECT "status", COUNT(*) FROM "orders" WHERE "status" IS NOT NULL ' +
            'GROUP BY "status" ORDER BY 2 DESC, 1 LIMIT 100'
        );
      });

      it("follows the identifier quote from driver capabilities", () => {
        const caps = { identifier_quote: "`", sql_dialect: "mysql" } as DriverCapabilities;
        expect(buildDistinctValuesQuery({ table: "t", schema: "db", column: "c", driver: caps })).toBe(
          "SELECT `c`, COUNT(*) FROM `db`.`t` WHERE `c` IS NOT NULL GROUP BY `c` ORDER BY 2 DESC, 1 LIMIT 100"
        );
      });

      it("escapes quote characters inside identifiers", () => {
        expect(buildDistinctValuesQuery({ table: "t", column: 'we"ird', driver: "postgres" })).toContain(
          'SELECT "we""ird", COUNT(*)'
        );
        expect(buildDistinctValuesQuery({ table: "t", column: "we`ird", driver: "mysql" })).toContain(
          "SELECT `we``ird`, COUNT(*)"
        );
      });

      it("ANDs the current filter in parentheses", () => {
        expect(
          buildDistinctValuesQuery({
            table: "orders",
            column: "status",
            driver: "sqlite",
            where: "a = 1 OR b = 2",
          })
        ).toBe(
          'SELECT "status", COUNT(*) FROM "orders" WHERE "status" IS NOT NULL AND (a = 1 OR b = 2) ' +
            'GROUP BY "status" ORDER BY 2 DESC, 1 LIMIT 100'
        );
      });

      it("honours a custom limit and defaults to VALUE_PICKER_LIMIT", () => {
        expect(VALUE_PICKER_LIMIT).toBe(100);
        expect(buildDistinctValuesQuery({ table: "t", column: "c", driver: "sqlite", limit: 25 })).toMatch(/LIMIT 25$/);
      });
    });

    describe("buildValuePickerWhere", () => {
      it("narrows by the other complete, enabled rows when matching all", () => {
        expect(buildValuePickerWhere(filters, "a", null, "AND")).toBe("priority > 2 AND deleted_at IS NULL");
      });

      it("skips the row being edited", () => {
        expect(buildValuePickerWhere(filters, "b", null, "AND")).toBe("status = 'open' AND deleted_at IS NULL");
      });

      it("does not narrow when matching any, since other rows widen the result", () => {
        expect(buildValuePickerWhere(filters, "a", null, "OR")).toBe("");
      });

      it("returns an empty clause when there are no other rows", () => {
        expect(buildValuePickerWhere([filters[0]], "a", null, "AND")).toBe("");
      });

      it("skips BETWEEN rows with a missing bound", () => {
        const rows: StructuredFilter[] = [
          { id: "x", column: "c", operator: "=", value: "" },
          { id: "y", column: "n", operator: "BETWEEN", value: "1", value2: "" },
          { id: "z", column: "m", operator: "BETWEEN", value: "1", value2: "5" },
        ];
        expect(buildValuePickerWhere(rows, "x", null, "AND")).toBe("m BETWEEN 1 AND 5");
      });
    });

    describe("parseDistinctValues", () => {
      it("turns [value, count] rows into strings and numbers", () => {
        expect(
          parseDistinctValues([
            ["open", 12],
            [3, "4"],
            [true, BigInt(2)],
            [{ a: 1 }, 1],
          ])
        ).toEqual([
          { value: "open", count: 12 },
          { value: "3", count: 4 },
          { value: "true", count: 2 },
          { value: '{"a":1}', count: 1 },
        ]);
      });

      it("drops NULL values and malformed rows", () => {
        expect(parseDistinctValues([[null, 5], ["x"], [], ["y", 1]])).toEqual([{ value: "y", count: 1 }]);
      });
    });

    describe("filterDistinctValues", () => {
      const values = [
        { value: "Open", count: 3 },
        { value: "closed", count: 2 },
        { value: "reopened", count: 1 },
      ];

      it("matches case-insensitively anywhere in the value", () => {
        expect(filterDistinctValues(values, "OPEN").map((v) => v.value)).toEqual(["Open", "reopened"]);
      });

      it("returns everything for a blank search", () => {
        expect(filterDistinctValues(values, "  ")).toBe(values);
      });
    });

    describe("formatPickedValue", () => {
      it("leaves plain values alone", () => {
        expect(formatPickedValue("open", "varchar")).toBe("open");
        expect(formatPickedValue("42", "integer")).toBe("42");
      });

      it("quotes number-like text in string columns so it is compared as text", () => {
        expect(formatPickedValue("007", "VARCHAR(10)")).toBe("'007'");
      });

      it("quotes values with commas, edge whitespace or wrapping quotes", () => {
        expect(formatPickedValue("Paris, TX", "text")).toBe("'Paris, TX'");
        expect(formatPickedValue(" padded", "text")).toBe("' padded'");
        expect(formatPickedValue("'quoted'", "text")).toBe("'''quoted'''");
        expect(formatPickedValue('"dq"', "text")).toBe(`'"dq"'`);
        expect(formatPickedValue("O'Hare", "text")).toBe("'O''Hare'");
      });

      it("quotes the empty string", () => {
        expect(formatPickedValue("", "text")).toBe("''");
      });
    });

    describe("applyPickedValues", () => {
      const base: StructuredFilter = { id: "1", column: "status", operator: "LIKE", value: "x%" };

      it("uses = for a single value", () => {
        expect(applyPickedValues(base, ["open"], "varchar")).toEqual({ ...base, operator: "=", value: "open" });
      });

      it("uses IN for several values", () => {
        expect(applyPickedValues(base, ["open", "Paris, TX"], "varchar")).toEqual({
          ...base,
          operator: "IN",
          value: "open, 'Paris, TX'",
        });
      });

      it("keeps a negated operator negated", () => {
        const neg: StructuredFilter = { ...base, operator: "!=" };
        expect(applyPickedValues(neg, ["a"], "text").operator).toBe("!=");
        expect(applyPickedValues(neg, ["a", "b"], "text").operator).toBe("NOT IN");
        const notIn: StructuredFilter = { ...base, operator: "NOT IN" };
        expect(applyPickedValues(notIn, ["a"], "text").operator).toBe("!=");
      });

      it("leaves the filter untouched when nothing is picked", () => {
        expect(applyPickedValues(base, [], "text")).toBe(base);
      });

      it("round-trips through buildSingleFilterClause", () => {
        const picked = applyPickedValues(base, ["Paris, TX", "O'Hare", "007"], "varchar");
        expect(buildSingleFilterClause(picked)).toBe("status IN ('Paris, TX', 'O''Hare', '007')");
      });
    });

    describe("getPickedValues", () => {
      it("reads back = and IN values without their quotes", () => {
        expect(getPickedValues({ id: "1", column: "c", operator: "=", value: "open" })).toEqual(["open"]);
        expect(
          getPickedValues({ id: "1", column: "c", operator: "IN", value: "open, 'Paris, TX', 'O''Hare'" })
        ).toEqual(["open", "Paris, TX", "O'Hare"]);
        expect(getPickedValues({ id: "1", column: "c", operator: "NOT IN", value: "1, 2" })).toEqual(["1", "2"]);
      });

      it("returns nothing for other operators or an empty value", () => {
        expect(getPickedValues({ id: "1", column: "c", operator: "LIKE", value: "a%" })).toEqual([]);
        expect(getPickedValues({ id: "1", column: "c", operator: "=", value: "" })).toEqual([]);
      });
    });

    describe("splitInList", () => {
      it("splits on commas outside quotes and trims", () => {
        expect(splitInList(` a , 'b, c' ,"d,e", 'it''s'`)).toEqual(["a", "'b, c'", '"d,e"', "'it''s'"]);
      });

      it("keeps an apostrophe inside an unquoted item", () => {
        expect(splitInList("O'Hare, Rome")).toEqual(["O'Hare", "Rome"]);
      });

      it("drops empty items", () => {
        expect(splitInList(",a,,")).toEqual(["a"]);
        expect(splitInList("")).toEqual([]);
      });
    });
  });
});
