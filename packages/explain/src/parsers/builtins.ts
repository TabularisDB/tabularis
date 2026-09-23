import type { ExplainPlan } from "../types";
import { parseMysqlJson, parseMysqlTabularRows, parseMysqlText } from "./mysql";
import type { MysqlTabularRow } from "./mysql";
import { parsePostgresJson, parsePostgresText } from "./postgres";
import { parseSqliteEqpRows } from "./sqlite";
import type { SqliteEqpRow } from "./sqlite";

function parseJsonRows<T>(payload: string, format: string): T[] {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (err) {
    throw new Error(`Failed to parse EXPLAIN rows: ${String(err)}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`EXPLAIN rows payload for '${format}' must be a JSON array`);
  }
  return value as T[];
}

interface BuiltinExplainParser {
  readonly engine: string;
  readonly format: string;
  parse(payload: string): ExplainPlan;
}

/** Immutable parser baseline shared by raw-driver and source dispatch. */
export const BUILTIN_EXPLAIN_PARSERS: readonly BuiltinExplainParser[] = Object.freeze([
    Object.freeze({
      engine: "postgres",
      format: "postgres-json",
      parse: parsePostgresJson,
    }),
    Object.freeze({
      engine: "postgres",
      format: "postgres-text",
      parse: parsePostgresText,
    }),
    Object.freeze({
      engine: "mysql",
      format: "mysql-json",
      parse: parseMysqlJson,
    }),
    Object.freeze({
      engine: "mysql",
      format: "mysql-text",
      parse: parseMysqlText,
    }),
    Object.freeze({
      engine: "mysql",
      format: "mysql-analyze-text",
      parse: parseMysqlText,
    }),
    Object.freeze({
      engine: "mysql",
      format: "mysql-tabular-rows",
      parse: (payload: string) =>
        parseMysqlTabularRows(
          parseJsonRows<MysqlTabularRow>(payload, "mysql-tabular-rows"),
        ),
    }),
    Object.freeze({
      engine: "sqlite",
      format: "sqlite-eqp-rows",
      parse: (payload: string) =>
        parseSqliteEqpRows(
          parseJsonRows<SqliteEqpRow>(payload, "sqlite-eqp-rows"),
        ),
    }),
  ]);
