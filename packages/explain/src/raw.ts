/**
 * The boundary between a host driver and the parsers.
 *
 * A built-in driver runs `EXPLAIN`, decides which variant succeeded, and hands
 * over the raw payload untouched — text, JSON, or decoded rows re-serialised
 * as JSON. Everything that *interprets* that payload lives here, so the same
 * parsers back the desktop app and any standalone visualiser fed a pasted or
 * uploaded plan.
 *
 * Plugin drivers know engines this package does not, so they keep returning a
 * fully-parsed plan; `resolveExplainOutput` accepts both shapes.
 */

import type { ExplainPlan } from "./types";
import { parseMysqlJson, parseMysqlText, parseMysqlTabularRows } from "./parsers/mysql";
import type { MysqlTabularRow } from "./parsers/mysql";
import { parsePostgresJson } from "./parsers/postgres";
import { parseSqliteEqpRows } from "./parsers/sqlite";
import type { SqliteEqpRow } from "./parsers/sqlite";

/** Wire formats a built-in driver can hand over. */
export type RawExplainFormat =
  | "postgres-json"
  | "mysql-json"
  | "mysql-analyze-text"
  | "mysql-tabular-rows"
  | "sqlite-eqp-rows";

/** Raw EXPLAIN output produced by a built-in driver, parsed on this side. */
export interface RawExplainOutput {
  /** Driver id of the engine that produced the payload ("postgres", …). */
  engine: string;
  format: RawExplainFormat;
  /** The untouched payload: text, a JSON document, or rows as a JSON array. */
  payload: string;
  original_query: string;
}

/**
 * What the host's `explain_query_plan` command returns: a raw payload from a
 * built-in driver, or a plan a plugin driver already parsed.
 */
export type ExplainQueryOutput =
  | { kind: "raw"; raw: RawExplainOutput }
  | { kind: "plan"; plan: ExplainPlan };

/** Parse a driver's raw EXPLAIN payload into a plan. */
export function parseRawExplain(raw: RawExplainOutput): ExplainPlan {
  const plan = parseRawPayload(raw);
  return {
    ...plan,
    driver: raw.engine,
    original_query: raw.original_query,
  };
}

/** Normalise either shape of `ExplainQueryOutput` into a plan. */
export function resolveExplainOutput(output: ExplainQueryOutput): ExplainPlan {
  return output.kind === "plan" ? output.plan : parseRawExplain(output.raw);
}

function parseRawPayload(raw: RawExplainOutput): ExplainPlan {
  switch (raw.format) {
    case "postgres-json":
      return parsePostgresJson(raw.payload);
    case "mysql-json":
      return parseMysqlJson(raw.payload);
    case "mysql-analyze-text":
      return parseMysqlText(raw.payload);
    case "mysql-tabular-rows":
      return parseMysqlTabularRows(parseJsonRows<MysqlTabularRow>(raw));
    case "sqlite-eqp-rows":
      return parseSqliteEqpRows(parseJsonRows<SqliteEqpRow>(raw));
  }
}

function parseJsonRows<T>(raw: RawExplainOutput): T[] {
  let value: unknown;
  try {
    value = JSON.parse(raw.payload);
  } catch (err) {
    throw new Error(`Failed to parse EXPLAIN rows: ${String(err)}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`EXPLAIN rows payload for '${raw.format}' must be a JSON array`);
  }
  return value as T[];
}
