import { quoteIdentifier, quoteTableRef } from "./identifiers";
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
  /**
   * The trigger's actual existing backing function, as parsed from its
   * `EXECUTE FUNCTION|PROCEDURE` clause (see `parseTriggerFunctionName`).
   * When set, `buildTriggerFunctionSql`/`buildTriggerSql` reference this
   * function instead of the generated `<table>_<name>_fn` convention name —
   * so editing a trigger whose function doesn't follow that convention
   * updates the function it actually calls, instead of creating (or
   * silently clobbering) a second, convention-named one. Omit for a brand-new
   * trigger, which has no existing function to preserve the identity of.
   */
  existingFunctionName?: { name: string; schema?: string };
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
 * the invalid `EXECUTE FUNCTION ...` string.
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
  if (input.existingFunctionName) {
    const { name, schema } = input.existingFunctionName;
    return quoteTableRef(name, input.capabilities ?? input.driver ?? "postgres", schema ?? null);
  }
  const prefix = input.schema ? `${q(input.schema)}.` : "";
  return `${prefix}${q(triggerFunctionName(input.name, input.tableName))}`;
}

/**
 * PostgreSQL only: the trigger function `buildTriggerSql`'s statement
 * references. When the body already carries its own `DECLARE` block
 * (preserved verbatim by `extractFunctionBody`, including the `BEGIN` that
 * separates declarations from statements), it is NOT re-wrapped in a second
 * `BEGIN` — PL/pgSQL allows exactly one `BEGIN` per function body, and a
 * `DECLARE` after `BEGIN` is a syntax error.
 */
export function buildTriggerFunctionSql(input: TriggerSqlInput): string {
  const hasOwnDeclareBegin = /^\s*DECLARE\b/i.test(input.body);
  const lines = hasOwnDeclareBegin
    ? [
        `CREATE OR REPLACE FUNCTION ${qualifiedFunctionName(input)}() RETURNS TRIGGER AS $$`,
        input.body,
        `END;`,
        `$$ LANGUAGE plpgsql;`,
      ]
    : [
        `CREATE OR REPLACE FUNCTION ${qualifiedFunctionName(input)}() RETURNS TRIGGER AS $$`,
        `BEGIN`,
        input.body,
        `END;`,
        `$$ LANGUAGE plpgsql;`,
      ];
  return lines.join("\n");
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
 * its original logic (variables and all). When there's a `DECLARE` block, the
 * body KEEPS the `BEGIN` keyword that follows it: that's the only marker of
 * where declarations end and statements begin, and the boundary can't be
 * reconstructed later from the statement text alone (an assignment like
 * `n := n + 1;` looks identical whether it's inside DECLARE's scope or after
 * it). `buildTriggerFunctionSql` detects a leading `DECLARE` and skips adding
 * its own `BEGIN` wrapper, so the round-trip stays valid PL/pgSQL — a prior
 * version stripped `BEGIN` unconditionally, which made `buildTriggerFunctionSql`
 * reinsert a second one before `DECLARE`.
 *
 * Nesting is tracked because a function body can contain nested `BEGIN/END`
 * (e.g. inside a loop), `END IF;`/`END LOOP;` clauses, and `CASE` — both the
 * *expression* form (`... := CASE WHEN ... END`, closed by a bare `END`,
 * indistinguishable from the function's own closing `END` by keyword alone)
 * and the *statement* form (`CASE WHEN ... END CASE;`). `BEGIN` and `CASE`
 * both open a construct that increments one depth counter; a bare `END` or
 * `END CASE` closes the innermost of either. `END IF`/`END LOOP` close their
 * own IF/LOOP construct and are excluded entirely, since IF/LOOP are never
 * counted as openers — a prior version's lookahead
 * excluded `END CASE` from decrementing at all, which left the depth counter
 * permanently inflated for the CASE *statement* form and truncated the body
 * to `null`).
 */
export function extractFunctionBody(fnDef: string): string | null {
  // Locate the outermost BEGIN. A DECLARE block (optional) precedes it.
  const declareMatch = fnDef.match(/\bDECLARE\b/);
  const beginMatch = fnDef.match(/\bBEGIN\b/);
  if (!beginMatch || beginMatch.index === undefined) return null;

  const hasDeclare =
    declareMatch !== null && declareMatch.index !== undefined && declareMatch.index < beginMatch.index;
  // When DECLARE is present, start there and keep the BEGIN keyword in the
  // extracted body (see the function doc comment for why). Otherwise start
  // just after BEGIN, as before.
  const start = hasDeclare ? declareMatch.index : beginMatch.index + beginMatch[0].length;

  // Walk the string from the outer BEGIN, counting depth so nested blocks
  // don't close the function early. BEGIN and CASE both open a construct a
  // bare END or END CASE closes; END IF/END LOOP close IF/LOOP (never
  // counted as openers) and are excluded entirely.
  let depth = 0;
  let end = -1;
  const tail = fnDef.slice(beginMatch.index);
  const keyword = /\bBEGIN\b|\bCASE\b|\bEND\s+CASE\b|\bEND\b(?!\s+(?:IF|LOOP|CASE)\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = keyword.exec(tail)) !== null) {
    const token = m[0].toUpperCase().replace(/\s+/g, " ");
    if (token === "BEGIN" || token === "CASE") {
      depth += 1;
    } else {
      // A bare END or END CASE — closes the innermost BEGIN or CASE. The
      // function body ends when this returns the depth to 0.
      depth -= 1;
      if (depth === 0) {
        end = beginMatch.index + m.index;
        break;
      }
    }
  }
  if (end === -1) return null;

  // The body spans from the start (DECLARE, or just after BEGIN) up to the
  // matching END. Without a DECLARE block, the slice already starts after
  // BEGIN (no wrapper to strip). With one, the slice includes the BEGIN that
  // separates declarations from statements — kept verbatim, since
  // buildTriggerFunctionSql detects it and skips adding its own BEGIN.
  const body = fnDef.slice(start, end).trim();
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
