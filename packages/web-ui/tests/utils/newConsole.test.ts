import { describe, it, expect } from "vitest";
import {
  newConsoleForDatabase,
  newConsoleForTable,
} from "../../src/utils/newConsole";

describe("newConsole", () => {
  describe("newConsoleForDatabase", () => {
    it("returns empty SQL with database as title and schema target", () => {
      expect(newConsoleForDatabase("analytics")).toEqual({
        sql: "",
        title: "analytics",
        schema: "analytics",
      });
    });

    it("preserves whitespace and special characters in the database name", () => {
      expect(newConsoleForDatabase("my db")).toEqual({
        sql: "",
        title: "my db",
        schema: "my db",
      });
    });
  });

  describe("newConsoleForTable", () => {
    it("builds a postgres SELECT with schema qualifier", () => {
      expect(newConsoleForTable("users", "postgres", "public")).toEqual({
        sql: 'SELECT * FROM "public"."users"',
        title: "users",
        schema: "public",
      });
    });

    it("builds a mysql SELECT with backticks and schema qualifier", () => {
      expect(newConsoleForTable("users", "mysql", "mydb")).toEqual({
        sql: "SELECT * FROM `mydb`.`users`",
        title: "users",
        schema: "mydb",
      });
    });

    it("omits schema qualifier when schema is not provided", () => {
      expect(newConsoleForTable("users", "postgres")).toEqual({
        sql: 'SELECT * FROM "users"',
        title: "users",
        schema: undefined,
      });
    });

    it("omits schema qualifier when schema is empty string", () => {
      expect(newConsoleForTable("users", "postgres", "")).toEqual({
        sql: 'SELECT * FROM "users"',
        title: "users",
        schema: "",
      });
    });

    it("uses default quote char for null driver", () => {
      const spec = newConsoleForTable("users", null);
      expect(spec.sql).toBe('SELECT * FROM "users"');
      expect(spec.title).toBe("users");
    });

    it("uses default quote char for undefined driver", () => {
      const spec = newConsoleForTable("users", undefined);
      expect(spec.sql).toBe('SELECT * FROM "users"');
    });

    it("escapes double quotes in postgres identifiers", () => {
      const spec = newConsoleForTable('my"table', "postgres", 'my"schema');
      expect(spec.sql).toBe('SELECT * FROM "my""schema"."my""table"');
    });

    it("escapes backticks in mysql identifiers", () => {
      const spec = newConsoleForTable("my`table", "mysql");
      expect(spec.sql).toBe("SELECT * FROM `my``table`");
    });
  });
});
