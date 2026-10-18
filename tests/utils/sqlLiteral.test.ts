import { describe, it, expect } from "vitest";
import { quoteSqlString, stringEscapeStyle } from "../../src/utils/sqlLiteral";
import type { DriverCapabilities, PluginManifest } from "../../src/types/plugins";

const caps = (sql_dialect?: DriverCapabilities["sql_dialect"]): DriverCapabilities =>
  ({ identifier_quote: "`", sql_dialect } as DriverCapabilities);

describe("sqlLiteral", () => {
  describe("stringEscapeStyle", () => {
    it("maps built-in driver ids", () => {
      expect(stringEscapeStyle("mysql")).toBe("mysql");
      expect(stringEscapeStyle("mariadb")).toBe("mysql");
      expect(stringEscapeStyle("postgres")).toBe("standard");
      expect(stringEscapeStyle("bigquery")).toBe("standard");
      expect(stringEscapeStyle(null)).toBe("standard");
      expect(stringEscapeStyle(undefined)).toBe("standard");
    });

    it("reads sql_dialect from capabilities and manifests", () => {
      expect(stringEscapeStyle(caps("bigquery"))).toBe("bigquery");
      expect(stringEscapeStyle(caps("mysql"))).toBe("mysql");
      expect(stringEscapeStyle(caps("postgres"))).toBe("standard");
      const manifest = { id: "bq", capabilities: caps("bigquery") } as PluginManifest;
      expect(stringEscapeStyle(manifest)).toBe("bigquery");
    });

    it("falls back to the manifest id when no dialect is declared", () => {
      expect(stringEscapeStyle({ id: "mariadb", capabilities: caps() } as PluginManifest))
        .toBe("mysql");
      expect(stringEscapeStyle(caps())).toBe("standard");
    });
  });

  describe("quoteSqlString", () => {
    it("doubles quotes for standard dialects", () => {
      expect(quoteSqlString("O'Brien \\ x", "postgres")).toBe("'O''Brien \\ x'");
    });

    it("also doubles backslashes for mysql", () => {
      expect(quoteSqlString("O'Brien \\ x", "mysql")).toBe("'O''Brien \\\\ x'");
    });

    it("backslash-escapes quotes, backslashes and line breaks for bigquery", () => {
      expect(quoteSqlString("O'Brien \\ x\r\ny", caps("bigquery"))).toBe(
        "'O\\'Brien \\\\ x\\r\\ny'",
      );
      expect(quoteSqlString("", caps("bigquery"))).toBe("''");
    });
  });
});
