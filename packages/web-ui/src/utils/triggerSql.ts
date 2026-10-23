import {quoteIdentifier, quoteTableRef} from './identifiers';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';

// ---------------------------------------------------------------------------
// Upstream's dialect type system
// ---------------------------------------------------------------------------

export type TriggerDialect = 'postgres' | 'mysql' | 'sqlite';
export type TriggerTiming = 'BEFORE' | 'AFTER' | 'INSTEAD OF';
export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export const TRIGGER_CAPS: Record<
    TriggerDialect,
    {timings: TriggerTiming[]; events: TriggerEvent[]; multiEvent: boolean}
> = {
    postgres: {
        timings: ['BEFORE', 'AFTER', 'INSTEAD OF'],
        events: ['INSERT', 'UPDATE', 'DELETE'],
        multiEvent: true,
    },
    mysql: {
        timings: ['BEFORE', 'AFTER'],
        events: ['INSERT', 'UPDATE', 'DELETE'],
        multiEvent: false,
    },
    sqlite: {
        timings: ['BEFORE', 'AFTER', 'INSTEAD OF'],
        events: ['INSERT', 'UPDATE', 'DELETE'],
        multiEvent: false,
    },
};

/** Same default the modal used before: anything that is not mysql/sqlite is treated as postgres-like. */
export interface TriggerDialectSource {
    driver?: string;
    capabilities?: {sql_dialect?: string | null} | null;
}

export function resolveTriggerDialect({
    driver,
    capabilities,
}: TriggerDialectSource): TriggerDialect | null {
    const raw = capabilities ? (capabilities.sql_dialect ?? 'postgres') : (driver ?? '');
    switch (raw.trim().toLowerCase()) {
        case 'postgres':
        case 'postgresql':
            return 'postgres';
        case 'mysql':
        case 'mariadb':
            return 'mysql';
        case 'sqlite':
            return 'sqlite';
        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// Our TriggerSqlInput interface (used by buildTriggerFunctionSql / buildTriggerSql)
// ---------------------------------------------------------------------------

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
    existingFunctionName?: {name: string; schema?: string};
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** True for both the builtin "postgres" driver and the "postgresql" plugin. */
export function isPostgresDriver(driver?: string): boolean {
    return driver === 'postgres' || driver === 'postgresql';
}

/** Default body shown in the editor, per dialect. */
export const defaultTriggerBody = (d: TriggerDialect): string =>
    d === 'postgres' ? '  -- trigger body' : 'BEGIN\n  -- trigger body\nEND';

export const quoteIdent = (d: TriggerDialect, s: string): string =>
    d === 'mysql' ? `\`${s.replace(/`/g, '``')}\`` : `"${s.replace(/"/g, '""')}"`;

/** Drop selections the driver doesn't support. */
export function normalizeSelection(
    d: TriggerDialect,
    timing: TriggerTiming,
    events: TriggerEvent[],
) {
    const caps = TRIGGER_CAPS[d];
    const t = caps.timings.includes(timing) ? timing : caps.timings[0];
    let e = events.filter((x) => caps.events.includes(x));
    if (e.length === 0) e = [caps.events[0]];
    if (!caps.multiEvent) e = [e[0]];
    return {timing: t, events: e};
}

// ---------------------------------------------------------------------------
// Upstream's BuildTriggerArgs interface (multi-dialect builder)
// ---------------------------------------------------------------------------

export interface BuildTriggerArgs {
    dialect: TriggerDialect;
    name: string;
    schema?: string;
    table: string;
    timing: TriggerTiming;
    events: TriggerEvent[];
    forEach?: 'ROW' | 'STATEMENT';
    /** pg: statements inside the function; mysql/sqlite: full BEGIN ... END block */
    body: string;
    /** Capability-aware identifier quoting supplied by the caller. */
    quote?: (id: string) => string;
    /**
     * postgres only: reuse an existing trigger function. Text that follows
     * `FOR EACH ROW`, e.g. `EXECUTE FUNCTION public.fn()`. No function is created.
     */
    existingTail?: string;
}

// ---------------------------------------------------------------------------
// Our postgres identity helpers
// ---------------------------------------------------------------------------

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
    return match[1]
        .replace(/"\s*\.\s*"/g, '.')
        .replace(/"/g, '')
        .trim();
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
    const q = (id: string) => quoteIdentifier(id, input.capabilities ?? input.driver ?? 'postgres');
    if (input.existingFunctionName) {
        const {name, schema} = input.existingFunctionName;
        return quoteTableRef(
            name,
            input.capabilities ?? input.driver ?? 'postgres',
            schema ?? null,
        );
    }
    const prefix = input.schema ? `${q(input.schema)}.` : '';
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
    return lines.join('\n');
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
        declareMatch !== null &&
        declareMatch.index !== undefined &&
        declareMatch.index < beginMatch.index;
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
        const token = m[0].toUpperCase().replace(/\s+/g, ' ');
        if (token === 'BEGIN' || token === 'CASE') {
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
    const q = (id: string) => quoteIdentifier(id, input.capabilities ?? input.driver ?? 'postgres');
    // MySQL handles schema via the connection — including it in the ON clause causes error 1435
    const isMysql = input.driver === 'mysql';
    const schemaPrefix = !isMysql && input.schema ? `${q(input.schema)}.` : '';
    const eventStr = input.events.join(' OR ');
    const header = [
        `CREATE TRIGGER ${q(input.name)}`,
        `${input.timing} ${eventStr}`,
        `ON ${schemaPrefix}${q(input.tableName)}`,
        `FOR EACH ROW`,
    ];
    if (isPostgresDriver(input.driver)) {
        return [...header, `EXECUTE FUNCTION ${qualifiedFunctionName(input)}();`].join('\n');
    }
    return [...header, input.body].join('\n');
}

// ---------------------------------------------------------------------------
// Upstream's multi-dialect builder
// ---------------------------------------------------------------------------

/** Statements to run, in order. Postgres needs two (function + trigger). */
export function buildCreateTriggerStatements(a: BuildTriggerArgs): string[] {
    const q = a.quote ?? ((s: string) => quoteIdent(a.dialect, s));
    const {timing, events} = normalizeSelection(a.dialect, a.timing, a.events);
    const eventSql = events.join(' OR ');
    const forEach = a.forEach ?? 'ROW';

    if (a.dialect === 'postgres') {
        const sp = a.schema ? `${q(a.schema)}.` : '';
        const table = `${sp}${q(a.table)}`;
        const trigger = (tail: string) =>
            [
                `CREATE TRIGGER ${q(a.name)}`,
                `${timing} ${eventSql} ON ${table}`,
                `FOR EACH ${forEach}`,
                tail.trim().endsWith(';') ? tail.trim() : `${tail.trim()};`,
            ].join('\n');

        if (a.existingTail) return [trigger(a.existingTail)];

        const fn = `${sp}${q(a.name + '_fn')}`;
        const returnsRow = forEach === 'ROW' && timing !== 'AFTER';
        const ret = returnsRow
            ? "  IF (TG_OP = 'DELETE') THEN RETURN OLD; END IF;\n  RETURN NEW;"
            : '  RETURN NULL;';
        const func = [
            `CREATE OR REPLACE FUNCTION ${fn}() RETURNS TRIGGER AS $$`,
            `BEGIN`,
            a.body.trim() ? a.body.replace(/\s+$/, '') : '  -- trigger body',
            ret,
            `END;`,
            `$$ LANGUAGE plpgsql;`,
        ].join('\n');
        return [func, trigger(`EXECUTE FUNCTION ${fn}()`)];
    }

    if (a.dialect === 'mysql') {
        // MySQL takes the schema from the connection; qualifying ON causes error 1435.
        return [
            [
                `CREATE TRIGGER ${q(a.name)}`,
                `${timing} ${eventSql}`,
                `ON ${q(a.table)}`,
                `FOR EACH ROW`,
                a.body,
            ].join('\n'),
        ];
    }

    return [
        [
            `CREATE TRIGGER ${q(a.name)}`,
            `${timing} ${eventSql} ON ${q(a.table)}`,
            `FOR EACH ROW`,
            a.body,
        ].join('\n'),
    ];
}

export const buildCreateTriggerSql = (a: BuildTriggerArgs): string =>
    buildCreateTriggerStatements(a).join('\n\n');

// ---------------------------------------------------------------------------
// Upstream's definition parser
// ---------------------------------------------------------------------------

/** Parse timing + ALL events from the header of an existing definition. */
export function parseTriggerDefinition(def: string): {
    timing: TriggerTiming | null;
    events: TriggerEvent[];
} {
    const ev = 'INSERT|UPDATE|DELETE';
    const re = new RegExp(
        `\\b(BEFORE|AFTER|INSTEAD\\s+OF)\\s+((?:${ev})(?:\\s+OR\\s+(?:${ev}))*)`,
        'i',
    );
    const m = re.exec(def);
    if (!m) return {timing: null, events: []};
    return {
        timing: m[1].toUpperCase().replace(/\s+/g, ' ') as TriggerTiming,
        events: m[2].split(/\s+OR\s+/i).map((e) => e.toUpperCase() as TriggerEvent),
    };
}

// ---------------------------------------------------------------------------
// Upstream's statement splitter
// ---------------------------------------------------------------------------

/** Split on `;` outside of quotes, comments and $$ blocks (postgres). */
export function splitSqlStatements(sql: string): string[] {
    const out: string[] = [];
    let cur = '';
    let i = 0;
    let dollar: string | null = null;
    let quote: string | null = null;
    while (i < sql.length) {
        const ch = sql[i];
        if (dollar) {
            if (sql.startsWith(dollar, i)) {
                cur += dollar;
                i += dollar.length;
                dollar = null;
            } else {
                cur += ch;
                i++;
            }
            continue;
        }
        if (quote) {
            cur += ch;
            if (ch === quote) {
                if (sql[i + 1] === quote) {
                    cur += sql[i + 1];
                    i += 2;
                    continue;
                }
                quote = null;
            }
            i++;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            cur += ch;
            i++;
            continue;
        }
        // Skip line comments without splitting on semicolons.
        if (ch === '-' && sql[i + 1] === '-') {
            const nl = sql.indexOf('\n', i);
            const end = nl === -1 ? sql.length : nl;
            cur += sql.slice(i, end);
            i = end;
            continue;
        }
        // Preserve block comments, including nested PostgreSQL comments.
        if (ch === '/' && sql[i + 1] === '*') {
            let depth = 1;
            cur += '/*';
            i += 2;

            while (i < sql.length && depth > 0) {
                if (sql.startsWith('/*', i)) {
                    depth++;
                    cur += '/*';
                    i += 2;
                } else if (sql.startsWith('*/', i)) {
                    depth--;
                    cur += '*/';
                    i += 2;
                } else {
                    cur += sql[i];
                    i++;
                }
            }
            continue;
        }
        if (ch === '$') {
            const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
            if (m) {
                dollar = m[0];
                cur += m[0];
                i += m[0].length;
                continue;
            }
        }
        if (ch === ';') {
            if (cur.trim()) out.push(cur.trim());
            cur = '';
            i++;
            continue;
        }
        cur += ch;
        i++;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}
