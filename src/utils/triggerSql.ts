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
 *   BEGIN
 *     NEW.note := ...;
 *     RETURN NEW;
 *   END;
 *   $function$
 * This returns the statements between `BEGIN` and `END;` (trimmed), which is
 * what the guided-mode body field holds — so the guided-save can recreate the
 * function with its original logic.
 */
export function extractFunctionBody(fnDef: string): string | null {
  const beginMatch = fnDef.match(/\bBEGIN\b/);
  const endMatch = fnDef.match(/\bEND\s*;/);
  if (!beginMatch || !endMatch || beginMatch.index === undefined || endMatch.index === undefined) {
    return null;
  }
  const body = fnDef.slice(beginMatch.index + beginMatch[0].length, endMatch.index).trim();
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
