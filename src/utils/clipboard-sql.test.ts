import { describe, expect, it } from "vitest";
import { rowsToSqlInsert } from "./clipboard";

describe("SQL INSERT copy quoting", () => {
  it("quotes identifiers with the driver's own quote character", () => {
    expect(rowsToSqlInsert([[1, "a"]], ["id", "name"], "users", "postgres")).toBe(
      'INSERT INTO "users" ("id", "name") VALUES (1, \'a\');',
    );
  });

  it("keeps MySQL backticks for a MySQL driver", () => {
    expect(rowsToSqlInsert([[1]], ["id"], "users", "mysql")).toBe(
      "INSERT INTO `users` (`id`) VALUES (1);",
    );
  });

  it("keeps backticks when no driver is given", () => {
    expect(rowsToSqlInsert([[1]], ["id"], "users")).toBe(
      "INSERT INTO `users` (`id`) VALUES (1);",
    );
  });
});
