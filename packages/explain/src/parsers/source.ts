/**
 * Format detection and dispatch for a raw EXPLAIN payload.
 *
 * A caller that knows which engine produced the output says so, and the right
 * parser is used directly. A caller that does not — a dropped file, a pasted
 * blob — omits the hint and the format is sniffed.
 *
 * The host stays responsible for obtaining the bytes; this module only
 * inspects them.
 */

import type { ExplainPlan } from "../types";
import { parseMysqlJson, parseMysqlText } from "./mysql";
import { parsePostgresJson, parsePostgresText } from "./postgres";

/** The engine that produced an EXPLAIN payload, when the caller knows it. */
export type ExplainEngine = "postgres" | "mysql" | "sqlite";

/** Supported source formats that a host may hand to `parseExplainFor`. */
export type ExplainSourceFormat =
  /** Postgres `EXPLAIN (FORMAT JSON [, ANALYZE, BUFFERS])` output. */
  | "postgres-json"
  /**
   * Postgres default `EXPLAIN` output — indentation-based tree with
   * `cost=X..Y rows=N width=W` headers and optional `actual time` blocks.
   */
  | "postgres-text"
  /**
   * MySQL / MariaDB `EXPLAIN FORMAT=JSON` or `ANALYZE FORMAT=JSON` output —
   * a document with a `query_block` key.
   */
  | "mysql-json"
  /** MySQL `EXPLAIN ANALYZE` / MariaDB `ANALYZE FORMAT=TEXT` indented tree. */
  | "mysql-text";

/**
 * A parser for one serialised EXPLAIN payload format.
 *
 * Every engine exposes its formats through this same interface so dispatch,
 * sniffing and hosts handle them uniformly.
 */
export interface ExplainSourceParser {
  readonly engine: ExplainEngine;
  readonly format: ExplainSourceFormat;
  /** Turn a raw payload into a plan; throws `Error` when the payload does not fit. */
  parse(raw: string): ExplainPlan;
}

const SOURCE_PARSERS: readonly ExplainSourceParser[] = [
  { engine: "postgres", format: "postgres-json", parse: parsePostgresJson },
  { engine: "postgres", format: "postgres-text", parse: parsePostgresText },
  { engine: "mysql", format: "mysql-json", parse: parseMysqlJson },
  { engine: "mysql", format: "mysql-text", parse: parseMysqlText },
];

function parserFor(format: ExplainSourceFormat): ExplainSourceParser {
  const parser = SOURCE_PARSERS.find((candidate) => candidate.format === format);
  if (parser === undefined) {
    throw new Error(`No parser registered for format '${format}'`);
  }
  return parser;
}

/**
 * Map a driver identifier — the same string carried in `ExplainPlan.driver` —
 * onto an engine.
 *
 * Matching is case-insensitive, and MariaDB maps onto `"mysql"` because they
 * share every plan format. Returns `null` for an unknown name, so an
 * unrecognised driver degrades to sniffing rather than failing.
 */
export function explainEngineFromDriverName(name: string): ExplainEngine | null {
  switch (name.trim().toLowerCase()) {
    case "postgres":
    case "postgresql":
    case "pg":
      return "postgres";
    case "mysql":
    case "mariadb":
      return "mysql";
    case "sqlite":
    case "sqlite3":
      return "sqlite";
    default:
      return null;
  }
}

/**
 * Detect the format of a payload of unknown origin.
 *
 * Recognises the two Postgres shapes only; pass an engine to
 * `detectFormatFor` to reach the others.
 */
export function detectFormat(raw: string): ExplainSourceFormat {
  return detectFormatFor(raw, null);
}

/**
 * Detect the format of a payload, given what the caller knows about its
 * origin.
 *
 * With an engine the choice is between that engine's own formats. Without
 * one, behaviour is unchanged from `detectFormat`: JSON is recognised by the
 * leading `[` or `{`, and the text form by a Postgres cost header
 * (`cost=X..Y rows=N width=W`).
 */
export function detectFormatFor(
  raw: string,
  engine: ExplainEngine | null,
): ExplainSourceFormat {
  switch (engine) {
    case "postgres":
    case null:
      if (looksLikeJson(raw)) return "postgres-json";
      if (looksLikePostgresText(raw)) return "postgres-text";
      throw new Error(
        "Unsupported EXPLAIN file format: expected Postgres JSON or text output",
      );
    case "mysql":
      if (looksLikeJson(raw)) return "mysql-json";
      if (raw.trim() === "") {
        throw new Error("Unsupported EXPLAIN file format: input is empty");
      }
      return "mysql-text";
    case "sqlite":
      throw new Error(
        "SQLite EXPLAIN QUERY PLAN has no text form here: pass its " +
          "(id, parent, detail) rows to buildSqliteTree",
      );
  }
}

function looksLikeJson(raw: string): boolean {
  const trimmed = raw.trimStart();
  return trimmed.startsWith("[") || trimmed.startsWith("{");
}

/** A cost header is the most reliable marker of a Postgres text plan. */
function looksLikePostgresText(raw: string): boolean {
  return raw
    .split("\n")
    .some((line) => line.includes("(cost=") && line.includes("width="));
}

/**
 * Parse a payload of unknown origin, sniffing the format.
 *
 * Equivalent to `parseExplainFor(raw, null)`.
 */
export function parseExplain(raw: string): ExplainPlan {
  return parseExplainFor(raw, null);
}

/** Parse a payload, using the caller's engine hint when there is one. */
export function parseExplainFor(
  raw: string,
  engine: ExplainEngine | null,
): ExplainPlan {
  return parserFor(detectFormatFor(raw, engine)).parse(raw);
}

/**
 * Label a plan that came from a named source (a file, an upload) so the UI
 * can display "From file: …" without needing a separate field.
 *
 * Takes the display name rather than a path: deriving a basename from a path
 * is the host's job.
 */
export function withSourceLabel(plan: ExplainPlan, name: string): ExplainPlan {
  if (plan.original_query === "") {
    return { ...plan, original_query: `-- loaded from ${name}` };
  }
  return plan;
}
