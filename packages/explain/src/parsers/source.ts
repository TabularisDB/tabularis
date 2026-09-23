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

import {
  getExplainParser,
  listExplainParsers,
  type RegisteredExplainParser,
} from "../registry";
import type { ExplainPlan } from "../types";

/** Engines whose source detection is built into this package. */
export type BuiltinExplainEngine = "postgres" | "mysql" | "sqlite";

/** The engine that produced an EXPLAIN payload, when the caller knows it. */
export type ExplainEngine = BuiltinExplainEngine | (string & {});

/** Source formats whose detection is built into this package. */
export type BuiltinExplainSourceFormat =
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

/** Supported source format supplied by a built-in or registered parser. */
export type ExplainSourceFormat = BuiltinExplainSourceFormat | (string & {});

/** A parser for one serialised EXPLAIN payload format. */
export interface ExplainSourceParser extends RegisteredExplainParser {
  readonly engine: ExplainEngine;
  readonly format: ExplainSourceFormat;
}

const BUILTIN_SOURCE_FORMATS: ReadonlySet<string> = new Set([
  "postgres-json",
  "postgres-text",
  "mysql-json",
  "mysql-text",
]);

function parserFor(format: ExplainSourceFormat): ExplainSourceParser {
  const parser = getExplainParser(format);
  if (parser === null) {
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
  const normalizedName = name.trim().toLowerCase();
  switch (normalizedName) {
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
  }

  const parser = listExplainParsers().find(
    (candidate) => candidate.engine.trim().toLowerCase() === normalizedName,
  );
  return parser?.engine ?? null;
}

/**
 * Detect the format of a payload of unknown origin.
 *
 * Recognises the two Postgres shapes before trying registered custom sniffers.
 */
export function detectFormat(raw: string): ExplainSourceFormat {
  return detectFormatFor(raw, null);
}

/**
 * Detect the format of a payload, given what the caller knows about its
 * origin.
 *
 * Built-in hints retain their historical decisions. Custom parsers are tried
 * in registry order and only through their side-effect-free sniffers.
 */
export function detectFormatFor(
  raw: string,
  engine: ExplainEngine | null,
): ExplainSourceFormat {
  switch (engine) {
    case "postgres":
      return detectPostgresFormat(raw);
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
    case null: {
      const builtinFormat = detectPostgresFormatOrNull(raw);
      if (builtinFormat !== null) return builtinFormat;

      const customFormat = sniffRegisteredFormat(raw, null);
      if (customFormat !== null) return customFormat;

      throw new Error(
        "Unsupported EXPLAIN file format: expected Postgres JSON or text output",
      );
    }
    default: {
      const format = sniffRegisteredFormat(raw, engine);
      if (format !== null) return format;
      throw new Error(`Unsupported EXPLAIN file format for engine '${engine}'`);
    }
  }
}

function detectPostgresFormat(raw: string): BuiltinExplainSourceFormat {
  const format = detectPostgresFormatOrNull(raw);
  if (format !== null) return format;
  throw new Error(
    "Unsupported EXPLAIN file format: expected Postgres JSON or text output",
  );
}

function detectPostgresFormatOrNull(
  raw: string,
): BuiltinExplainSourceFormat | null {
  if (looksLikeJson(raw)) return "postgres-json";
  if (looksLikePostgresText(raw)) return "postgres-text";
  return null;
}

function sniffRegisteredFormat(
  raw: string,
  engine: ExplainEngine | null,
): ExplainSourceFormat | null {
  const normalizedEngine = engine?.trim().toLowerCase() ?? null;

  for (const parser of listExplainParsers()) {
    if (normalizedEngine === null && BUILTIN_SOURCE_FORMATS.has(parser.format)) {
      continue;
    }
    if (
      normalizedEngine !== null &&
      parser.engine.trim().toLowerCase() !== normalizedEngine
    ) {
      continue;
    }
    if (parser.sniff === undefined) continue;

    try {
      if (parser.sniff(raw)) return parser.format;
    } catch {
      // A sniffer is advisory; one broken parser must not block later parsers.
    }
  }

  return null;
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
