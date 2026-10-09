import { quoteIdentifier } from "./identifiers";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";

export interface TriggerSqlInput {
  name: string;
  tableName: string;
  schema?: string;
  timing: string;
  events: string[];
  body: string;
  driver?: string;
  capabilities?: DriverCapabilities | PluginManifest | null;
}

/** True for both the builtin "postgres" driver and the "postgresql" plugin. */
export function isPostgresDriver(driver?: string): boolean {
  return driver === "postgres" || driver === "postgresql";
}

/**
 * PostgreSQL has no inline trigger body — CREATE TRIGGER only references a
 * separate trigger function, so its default guided-mode body is PL/pgSQL
 * *function* statements (no BEGIN/END, no `DELIMITER`-free literal block).
 * MySQL and SQLite both execute a literal BEGIN/END body inline, which is
 * their only supported form.
 */
export function defaultTriggerBody(driver?: string): string {
  return isPostgresDriver(driver)
    ? "-- trigger body\n  RETURN NEW;"
    : "BEGIN\n  -- trigger body\nEND";
}

/**
 * Deterministic name for the trigger function PostgreSQL requires.
 * Scoped by table so two same-named triggers on different tables don't share
 * one function (CREATE OR REPLACE would clobber the other table's logic).
 * CREATE OR REPLACE makes re-saving the same trigger idempotent rather than
 * erroring on a name collision.
 */
export function triggerFunctionName(name: string, tableName?: string): string {
  return tableName ? `${tableName}_${name}_fn` : `${name}_fn`;
}

/**
 * Parses the actual function name a PostgreSQL trigger references in its
 * `EXECUTE FUNCTION <name>()` (or legacy `EXECUTE PROCEDURE <name>()`) clause,
 * so the editor can fetch that function's real definition on load — instead of
 * assuming the `<table>_<trigger>_fn` convention, which fails for triggers whose
 * function follows a different naming scheme and left the body falling back to
 * the invalid `EXECUTE FUNCTION ...` string (debba review, PR #822, blocking 3).
 *
 * Returns the name with quotes stripped and schema qualification preserved
 * (`schema.name`), or `null` when the clause is absent or malformed. Handles
 * both quoted (`"schema"."name"`) and unqualified (`name`) forms.
 */
export function parseTriggerFunctionName(triggerSql: string): string | null {
  const match = triggerSql.match(
    /\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\s+((?:"[^"]+"\s*\.\s*)*"[^"]+"|(?:[A-Za-z_][\w$]*\s*\.\s*)*[A-Za-z_][\w$]*)\s*\(\s*\)/i,
  );
  if (!match) return null;
  // Strip double-quotes and the spaces around the dot, collapsing
  // `"store"."trg_fn"` → `store.trg_fn` and `my_audit` → `my_audit`.
  return match[1].replace(/"\s*\.\s*"/g, ".").replace(/"/g, "").trim();
}

/**
 * Schema-qualified reference to the trigger function, e.g. `"store"."trg_fn"`.
 * Both statements below must use this — not just the bare name — because
 * `CREATE FUNCTION` and `CREATE TRIGGER ... EXECUTE FUNCTION` run as two
 * separate backend calls (see TriggerEditorModal.handleSave) that aren't
 * guaranteed to resolve an unqualified name against the same `search_path`:
 * an unqualified `CREATE FUNCTION fn()` lands wherever that call's own
 * search_path happens to point (e.g. the connection's default schema), and
 * an unqualified `EXECUTE FUNCTION fn()` independently resolves against
 * whatever search_path *that* call sees — schema-qualifying both removes
 * the dependency on either one matching (#837).
 */
function qualifiedFunctionName(input: TriggerSqlInput): string {
  const q = (id: string) => quoteIdentifier(id, input.capabilities ?? input.driver ?? "postgres");
  const prefix = input.schema ? `${q(input.schema)}.` : "";
  return `${prefix}${q(triggerFunctionName(input.name, input.tableName))}`;
}

/** PostgreSQL only: the trigger function `buildTriggerSql`'s statement references. */
export function buildTriggerFunctionSql(input: TriggerSqlInput): string {
  return [
    `CREATE OR REPLACE FUNCTION ${qualifiedFunctionName(input)}() RETURNS TRIGGER AS $$`,
    `BEGIN`,
    input.body,
    `END;`,
    `$$ LANGUAGE plpgsql;`,
  ].join("\n");
}

/**
 * Extracts the PL/pgSQL body statements from a `pg_get_functiondef` result.
 * The function definition looks like:
 *   CREATE OR REPLACE FUNCTION review.fn() RETURNS trigger LANGUAGE plpgsql
 *   AS $function$
 *   DECLARE
 *     n integer := 0;
 *   BEGIN
 *     NEW.note := ...;
 *     RETURN NEW;
 *   END;
 *   $function$
 * This returns the statements that the guided-mode body field holds — including
 * a `DECLARE` block when present — so the guided-save recreates the function with
 * its original logic (variables and all). The body runs from the `DECLARE` (or
 * `BEGIN` when there are no declarations) through the matching outer `END;`.
 *
 * Nesting is tracked because a function body can contain nested `BEGIN/END`
 * (e.g. inside a loop) and `END IF;`/`END LOOP;` clauses whose `END;`-adjacent
 * tokens the naive first-`END;` regex matched too early, truncating the body
 * (debba review, PR #822). `CASE ... END` and `LOOP ... END` are matched via a
 * depth counter on the `BEGIN` keyword and the standalone `END` that closes it.
 */
export function extractFunctionBody(fnDef: string): string | null {
  // Locate the outermost BEGIN. A DECLARE block (optional) precedes it and must
  // be preserved in the extracted body.
  const declareMatch = fnDef.match(/\bDECLARE\b/);
  const beginMatch = fnDef.match(/\bBEGIN\b/);
  if (!beginMatch || beginMatch.index === undefined) return null;

  // Start from DECLARE if it appears before BEGIN; otherwise start at BEGIN's
  // body (after the BEGIN keyword itself).
  const start = declareMatch && declareMatch.index !== undefined && declareMatch.index < beginMatch.index
    ? declareMatch.index
    : beginMatch.index + beginMatch[0].length;

  // Walk the string from the outer BEGIN, counting BEGIN/END depth so nested
  // blocks don't close the function early. In PL/pgSQL, only a bare `END;`
  // closes a `BEGIN` block — `END IF;`, `END CASE;`, and `END LOOP;` close
  // IF/CASE/LOOP constructs and must NOT decrement the BEGIN/END depth. So we
  // match BEGIN always, but END only when NOT followed by IF/CASE/LOOP.
  let depth = 0;
  let end = -1;
  const tail = fnDef.slice(beginMatch.index);
  const keyword = /\bBEGIN\b|\bEND\b(?!\s+(?:IF|CASE|LOOP)\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = keyword.exec(tail)) !== null) {
    if (m[0].toUpperCase() === "BEGIN") {
      depth += 1;
    } else {
      // A bare END — closes one BEGIN. The function body ends at depth 0.
      depth -= 1;
      if (depth === 0) {
        end = beginMatch.index + m.index;
        break;
      }
    }
  }
  if (end === -1) return null;

  // The body spans from the start (DECLARE, or just after BEGIN) up to the
  // matching END. When a DECLARE block is present the slice includes the
  // `BEGIN` keyword that separates declarations from statements — remove
  // just that line so the body field holds declarations + statements, not
  // the wrapper, preserving the indentation of the statements that follow.
  const body = fnDef.slice(start, end).replace(/^[ \t]*BEGIN[ \t]*\r?\n/m, "").trim();
  return body || null;
}

/**
 * The CREATE TRIGGER statement itself. For PostgreSQL this references the
 * function from `buildTriggerFunctionSql` (created separately — see
 * TriggerEditorModal.handleSave and issue #837) instead of an inline body,
 * since neither the builtin driver nor the plugin's Postgres client can
 * execute more than one statement per call.
 */
export function buildTriggerSql(input: TriggerSqlInput): string {
  const q = (id: string) => quoteIdentifier(id, input.capabilities ?? input.driver ?? "postgres");
  // MySQL handles schema via the connection — including it in the ON clause causes error 1435
  const isMysql = input.driver === "mysql";
  const schemaPrefix = !isMysql && input.schema ? `${q(input.schema)}.` : "";
  const eventStr = input.events.join(" OR ");
  const header = [
    `CREATE TRIGGER ${q(input.name)}`,
    `${input.timing} ${eventStr}`,
    `ON ${schemaPrefix}${q(input.tableName)}`,
    `FOR EACH ROW`,
  ];
  if (isPostgresDriver(input.driver)) {
    return [...header, `EXECUTE FUNCTION ${qualifiedFunctionName(input)}();`].join("\n");
  }
  return [...header, input.body].join("\n");
}
