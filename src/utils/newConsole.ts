import { quoteTableRef } from "./identifiers";

export interface NewConsoleSpec {
  sql: string;
  title: string;
  schema?: string;
  database?: string;
}

export function newConsoleForDatabase(
  databaseName: string,
  isSchemaBased = false,
): NewConsoleSpec {
  // Schema-based multi-database (PostgreSQL): the node is a real database, so
  // route the console to that database's pool via `database` and leave `schema`
  // unset — the query runs with the default search_path and users qualify as
  // needed. Setting `schema` to the database name (the flat convention below)
  // would make the backend run `SET search_path TO "<db>"` on the WRONG (primary)
  // pool, so unqualified relations fail to resolve.
  //
  // Flat multi-database (MySQL/MariaDB) keeps overloading `schema` as the
  // database name, since one connection sees every database.
  if (isSchemaBased) {
    return { sql: "", title: databaseName, database: databaseName };
  }
  return { sql: "", title: databaseName, schema: databaseName };
}

export function newConsoleForTable(
  tableName: string,
  driver: string | null | undefined,
  schema?: string,
  database?: string,
): NewConsoleSpec {
  return {
    sql: `SELECT * FROM ${quoteTableRef(tableName, driver, schema)}`,
    title: tableName,
    schema,
    database,
  };
}
