import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import manifestSchema from "../../plugins/manifest.schema.json";
import extensionsSchema from "../../plugins/tabularium-extensions.schema.json";
import { GOOGLESQL_DESCRIPTOR } from "../fixtures/sql-syntax/googlesql";
import { SQL_SYNTAX_FORMATTERS, SQL_SYNTAX_LIMITS } from "../../src/utils/sqlSyntax";

describe("sql_syntax manifest contract", () => {
  for (const [name, schema] of Object.entries({ manifestSchema, extensionsSchema })) {
    const sqlSyntax = schema.properties.capabilities.properties.sql_syntax;
    const validate = new Ajv({ strict: false }).compile(sqlSyntax);

    it(`accepts the GoogleSQL descriptor in ${name}`, () => {
      expect(validate(GOOGLESQL_DESCRIPTOR), JSON.stringify(validate.errors)).toBe(true);
    });

    it(`rejects out-of-contract values in ${name}`, () => {
      for (const invalid of [
        { extends: "bigquery" },
        { quotes: [] },
        { quotes: [{ open: "{", kind: "string" }] },
        { string_prefixes: ["raw"] },
        { string_escape: "mysql" },
        { formatter: "custom" },
        { boolean_literals: "yes" },
        { boolean_literals: true },
        { keywords: ["DROP TABLE x;"] },
      ]) {
        expect(validate(invalid), JSON.stringify(invalid)).toBe(false);
      }
    });

    it(`matches the host limits in ${name}`, () => {
      expect(sqlSyntax.properties.quotes.maxItems).toBe(SQL_SYNTAX_LIMITS.maxQuotes);
      expect(sqlSyntax.properties.string_prefixes.maxItems).toBe(
        SQL_SYNTAX_LIMITS.maxStringPrefixes,
      );
      expect(sqlSyntax.properties.keywords.maxItems).toBe(SQL_SYNTAX_LIMITS.maxWords);
      expect(sqlSyntax.properties.functions.items.maxLength).toBe(
        SQL_SYNTAX_LIMITS.maxWordLength,
      );
      expect(sqlSyntax.properties.formatter.enum).toEqual([...SQL_SYNTAX_FORMATTERS]);
      expect(sqlSyntax.properties.boolean_literals.enum).toEqual(["keywords", "numeric"]);
    });

    it(`no longer lists bigquery as a dialect in ${name}`, () => {
      const dialect = (schema.properties.capabilities.properties as Record<string, { enum?: string[] }>)
        .sql_dialect;
      expect(dialect?.enum ?? []).not.toContain("bigquery");
    });
  }
});
