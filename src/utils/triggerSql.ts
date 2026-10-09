export type TriggerDialect = "postgres" | "mysql" | "sqlite";
export type TriggerTiming = "BEFORE" | "AFTER" | "INSTEAD OF";
export type TriggerEvent = "INSERT" | "UPDATE" | "DELETE";

export const TRIGGER_CAPS: Record<
  TriggerDialect,
  { timings: TriggerTiming[]; events: TriggerEvent[]; multiEvent: boolean }
> = {
  postgres: {
    timings: ["BEFORE", "AFTER", "INSTEAD OF"],
    events: ["INSERT", "UPDATE", "DELETE"],
    multiEvent: true,
  },
  mysql: {
    timings: ["BEFORE", "AFTER"],
    events: ["INSERT", "UPDATE", "DELETE"],
    multiEvent: false,
  },
  sqlite: {
    timings: ["BEFORE", "AFTER", "INSTEAD OF"],
    events: ["INSERT", "UPDATE", "DELETE"],
    multiEvent: false,
  },
};

/** Same default the modal used before: anything that is not mysql/sqlite is treated as postgres-like. */
export function resolveTriggerDialect(driver?: string): TriggerDialect {
  if (driver === "mysql") return "mysql";
  if (driver === "sqlite") return "sqlite";
  return "postgres";
}

/** Default body shown in the editor, per dialect. */
export const defaultTriggerBody = (d: TriggerDialect): string =>
  d === "postgres" ? "  -- trigger body" : "BEGIN\n  -- trigger body\nEND";

export const quoteIdent = (d: TriggerDialect, s: string): string =>
  d === "mysql" ? `\`${s.replace(/`/g, "``")}\`` : `"${s.replace(/"/g, '""')}"`;

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
  return { timing: t, events: e };
}

export interface BuildTriggerArgs {
  dialect: TriggerDialect;
  name: string;
  schema?: string;
  table: string;
  timing: TriggerTiming;
  events: TriggerEvent[];
  forEach?: "ROW" | "STATEMENT";
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

/** Statements to run, in order. Postgres needs two (function + trigger). */
export function buildCreateTriggerStatements(a: BuildTriggerArgs): string[] {
  const q = a.quote ?? ((s: string) => quoteIdent(a.dialect, s));
  const { timing, events } = normalizeSelection(a.dialect, a.timing, a.events);
  const eventSql = events.join(" OR ");
  const forEach = a.forEach ?? "ROW";

  if (a.dialect === "postgres") {
    const sp = a.schema ? `${q(a.schema)}.` : "";
    const table = `${sp}${q(a.table)}`;
    const trigger = (tail: string) =>
      [
        `CREATE TRIGGER ${q(a.name)}`,
        `${timing} ${eventSql} ON ${table}`,
        `FOR EACH ${forEach}`,
        tail.trim().endsWith(";") ? tail.trim() : `${tail.trim()};`,
      ].join("\n");

    if (a.existingTail) return [trigger(a.existingTail)];

    const fn = `${sp}${q(a.name + "_fn")}`;
    const returnsRow = forEach === "ROW" && timing !== "AFTER";
    const ret = returnsRow
      ? "  IF (TG_OP = 'DELETE') THEN RETURN OLD; END IF;\n  RETURN NEW;"
      : "  RETURN NULL;";
    const func = [
      `CREATE OR REPLACE FUNCTION ${fn}() RETURNS TRIGGER AS $$`,
      `BEGIN`,
      a.body.trim() ? a.body.replace(/\s+$/, "") : "  -- trigger body",
      ret,
      `END;`,
      `$$ LANGUAGE plpgsql;`,
    ].join("\n");
    return [func, trigger(`EXECUTE FUNCTION ${fn}()`)];
  }

  if (a.dialect === "mysql") {
    // MySQL takes the schema from the connection; qualifying ON causes error 1435.
    return [
      [
        `CREATE TRIGGER ${q(a.name)}`,
        `${timing} ${eventSql}`,
        `ON ${q(a.table)}`,
        `FOR EACH ROW`,
        a.body,
      ].join("\n"),
    ];
  }

  return [
    [
      `CREATE TRIGGER ${q(a.name)}`,
      `${timing} ${eventSql} ON ${q(a.table)}`,
      `FOR EACH ROW`,
      a.body,
    ].join("\n"),
  ];
}

export const buildCreateTriggerSql = (a: BuildTriggerArgs): string =>
  buildCreateTriggerStatements(a).join("\n\n");

/** Parse timing + ALL events from the header of an existing definition. */
export function parseTriggerDefinition(def: string): {
  timing: TriggerTiming | null;
  events: TriggerEvent[];
} {
  const ev = "INSERT|UPDATE|DELETE";
  const re = new RegExp(
    `\\b(BEFORE|AFTER|INSTEAD\\s+OF)\\s+((?:${ev})(?:\\s+OR\\s+(?:${ev}))*)`,
    "i",
  );
  const m = re.exec(def);
  if (!m) return { timing: null, events: [] };
  return {
    timing: m[1].toUpperCase().replace(/\s+/g, " ") as TriggerTiming,
    events: m[2].split(/\s+OR\s+/i).map((e) => e.toUpperCase() as TriggerEvent),
  };
}

/** Split on `;` outside of quotes, comments and $$ blocks (postgres). */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
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
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      cur += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        dollar = m[0];
        cur += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}