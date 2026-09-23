/**
 * The boundary between a host driver and the parsers.
 *
 * A built-in driver runs `EXPLAIN`, decides which variant succeeded, and hands
 * over the raw payload untouched — text, JSON, or decoded rows re-serialised
 * as JSON. Everything that *interprets* that payload lives here, so the same
 * parsers back the desktop app and any standalone visualiser fed a pasted or
 * uploaded plan.
 *
 * Plugin drivers can register parsers for formats this package does not know;
 * `resolveExplainOutput` also accepts their historical fully-parsed shape.
 */

import { getExplainParser } from "./registry";
import type { ExplainPlan } from "./types";

/** Wire formats supplied by Tabularis built-in drivers. */
export type BuiltinRawExplainFormat =
  | "postgres-json"
  | "mysql-json"
  | "mysql-analyze-text"
  | "mysql-tabular-rows"
  | "sqlite-eqp-rows";

/** Wire format supplied by a built-in or registered plugin driver. */
export type RawExplainFormat = BuiltinRawExplainFormat | (string & {});

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
  const parser = getExplainParser(raw.format);
  if (parser === null) {
    throw new Error(
      `No EXPLAIN parser registered for format '${raw.format}' (engine '${raw.engine}'). ` +
        `Import the parser package for '${raw.engine}' before parsing.`,
    );
  }

  const plan = parser.parse(raw.payload);
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
