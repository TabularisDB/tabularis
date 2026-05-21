import { describe, it, expect } from "vitest";
import type { ForeignKey } from "../../src/types/schema";
import {
  pickPrimaryForeignKeyByColumn,
  isForeignKeyValueNavigable,
  isNumericColumnType,
  buildForeignKeyFilterClause,
} from "../../src/utils/foreignKeys";

const fk = (
  name: string,
  column_name: string,
  ref_table: string,
  ref_column: string,
): ForeignKey => ({ name, column_name, ref_table, ref_column });

describe("foreignKeys", () => {
  describe("pickPrimaryForeignKeyByColumn", () => {
    it("returns an empty map for undefined/null/empty input", () => {
      expect(pickPrimaryForeignKeyByColumn(undefined).size).toBe(0);
      expect(pickPrimaryForeignKeyByColumn(null).size).toBe(0);
      expect(pickPrimaryForeignKeyByColumn([]).size).toBe(0);
    });

    it("indexes single-column FKs by their source column", () => {
      const fks = [
        fk("fk_org", "org_id", "organizations", "id"),
        fk("fk_role", "role_id", "roles", "id"),
      ];
      const map = pickPrimaryForeignKeyByColumn(fks);
      expect(map.size).toBe(2);
      expect(map.get("org_id")?.ref_table).toBe("organizations");
      expect(map.get("role_id")?.ref_table).toBe("roles");
    });

    it("skips composite FKs (entries that share a constraint name)", () => {
      const fks = [
        fk("fk_composite", "tenant_id", "memberships", "tenant_id"),
        fk("fk_composite", "user_id", "memberships", "user_id"),
        fk("fk_country", "country_code", "countries", "code"),
      ];
      const map = pickPrimaryForeignKeyByColumn(fks);
      expect(map.size).toBe(1);
      expect(map.has("tenant_id")).toBe(false);
      expect(map.has("user_id")).toBe(false);
      expect(map.get("country_code")?.ref_table).toBe("countries");
    });

    it("keeps the first occurrence when multiple single-column FKs hit the same column", () => {
      const fks = [
        fk("fk_first", "owner_id", "users", "id"),
        fk("fk_second", "owner_id", "service_accounts", "id"),
      ];
      const map = pickPrimaryForeignKeyByColumn(fks);
      expect(map.size).toBe(1);
      expect(map.get("owner_id")?.name).toBe("fk_first");
    });
  });

  describe("isForeignKeyValueNavigable", () => {
    it("rejects null, undefined, and empty string", () => {
      expect(isForeignKeyValueNavigable(null)).toBe(false);
      expect(isForeignKeyValueNavigable(undefined)).toBe(false);
      expect(isForeignKeyValueNavigable("")).toBe(false);
    });

    it("accepts numbers, non-empty strings, and zero", () => {
      expect(isForeignKeyValueNavigable(0)).toBe(true);
      expect(isForeignKeyValueNavigable(42)).toBe(true);
      expect(isForeignKeyValueNavigable("abc")).toBe(true);
      expect(isForeignKeyValueNavigable(false)).toBe(true);
    });
  });

  describe("isNumericColumnType", () => {
    it("recognises common numeric types across drivers", () => {
      for (const t of [
        "INT",
        "int(11)",
        "bigint unsigned",
        "DECIMAL(10,2)",
        "numeric",
        "double precision",
        "real",
        "float",
        "serial",
        "bigserial",
        "money",
      ]) {
        expect(isNumericColumnType(t)).toBe(true);
      }
    });

    it("returns false for non-numeric or missing types", () => {
      expect(isNumericColumnType(undefined)).toBe(false);
      expect(isNumericColumnType("")).toBe(false);
      expect(isNumericColumnType("varchar(255)")).toBe(false);
      expect(isNumericColumnType("text")).toBe(false);
      expect(isNumericColumnType("uuid")).toBe(false);
      expect(isNumericColumnType("timestamp")).toBe(false);
    });
  });

  describe("buildForeignKeyFilterClause", () => {
    const orgFk = fk("fk_org", "org_id", "organizations", "id");

    it("emits numbers unquoted and quotes the identifier per driver", () => {
      expect(buildForeignKeyFilterClause(orgFk, 42, "mysql")).toBe(
        "`id` = 42",
      );
      expect(buildForeignKeyFilterClause(orgFk, 42, "postgres")).toBe(
        '"id" = 42',
      );
      expect(buildForeignKeyFilterClause(orgFk, 42, "sqlite")).toBe(
        '"id" = 42',
      );
    });

    it("treats bigint values as numeric", () => {
      expect(
        buildForeignKeyFilterClause(orgFk, BigInt("9007199254740993"), "postgres"),
      ).toBe('"id" = 9007199254740993');
    });

    it("quotes string values and escapes embedded single quotes", () => {
      const slugFk = fk("fk_slug", "slug", "pages", "slug");
      expect(
        buildForeignKeyFilterClause(slugFk, "o'brien", "postgres"),
      ).toBe(`"slug" = 'o''brien'`);
    });

    it("emits numeric strings unquoted when the source column is numeric", () => {
      expect(
        buildForeignKeyFilterClause(orgFk, "42", "postgres", "BIGINT"),
      ).toBe('"id" = 42');
    });

    it("keeps numeric strings quoted when the source column type is unknown", () => {
      expect(buildForeignKeyFilterClause(orgFk, "42", "postgres")).toBe(
        `"id" = '42'`,
      );
    });

    it("emits booleans as TRUE/FALSE", () => {
      const flagFk = fk("fk_flag", "active", "settings", "active");
      expect(buildForeignKeyFilterClause(flagFk, true, "postgres")).toBe(
        '"active" = TRUE',
      );
      expect(buildForeignKeyFilterClause(flagFk, false, "postgres")).toBe(
        '"active" = FALSE',
      );
    });

    it("escapes identifiers that contain the quote character", () => {
      const weirdFk = fk("fk_weird", '"id', "weird", '"id');
      expect(buildForeignKeyFilterClause(weirdFk, 1, "postgres")).toBe(
        `"""id" = 1`,
      );
    });
  });
});
