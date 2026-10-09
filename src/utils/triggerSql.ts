export type TriggerDialect = "postgres" | "mysql" | "sqlite";
export type TriggerTiming = "BEFORE" | "AFTER" | "INSTEAD OF";
export type TriggerEvent = "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";

export const TRIGGER_CAPS: Record<
  TriggerDialect,
  { timings: TriggerTiming[]; events: TriggerEvent[]; multiEvent: boolean }
> = {
  postgres: {
    timings: ["BEFORE", "AFTER", "INSTEAD OF"],
    events: ["INSERT", "UPDATE", "DELETE", "TRUNCATE"],
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
  forEach: "ROW" | "STATEMENT";
  body: string; // pg: inner statements; mysql/sqlite: full BEGIN ... END block
}

export function buildCreateTriggerSql(a: BuildTriggerArgs): string {
  const q = (s: string) => quoteIdent(a.dialect, s);
  const { timing, events } = normalizeSelection(a.dialect, a.timing, a.events);
  const eventSql = events.join(" OR ");

  if (a.dialect === "postgres") {
    const fn = `${a.schema ? q(a.schema) + "." : ""}${q(a.name + "_fn")}`;
    const table = `${a.schema ? q(a.schema) + "." : ""}${q(a.table)}`;
    const returnsRow = a.forEach === "ROW" && timing !== "AFTER";
    const ret = returnsRow
      ? "  IF (TG_OP = 'DELETE') THEN RETURN OLD; END IF;\n  RETURN NEW;"
      : "  RETURN NULL;";
    return [
      `CREATE OR REPLACE FUNCTION ${fn}() RETURNS TRIGGER AS $$`,
      `BEGIN`,
      a.body.trim() ? a.body.replace(/\s+$/, "") : "  -- trigger body",
      ret,
      `END;`,
      `$$ LANGUAGE plpgsql;`,
      ``,
      `CREATE TRIGGER ${q(a.name)}`,
      `${timing} ${eventSql} ON ${table}`,
      `FOR EACH ${a.forEach}`,
      `EXECUTE FUNCTION ${fn}();`,
    ].join("\n");
  }

  if (a.dialect === "mysql") {
    const prefix = a.schema ? q(a.schema) + "." : "";
    return [
      `CREATE TRIGGER ${prefix}${q(a.name)}`,
      `${timing} ${eventSql}`,
      `ON ${prefix}${q(a.table)}`,
      `FOR EACH ROW`,
      a.body,
    ].join("\n");
  }

  return [
    `CREATE TRIGGER ${q(a.name)}`,
    `${timing} ${eventSql} ON ${q(a.table)}`,
    `FOR EACH ROW`,
    a.body,
  ].join("\n");
}

/** Parse timing + ALL events from an existing definition. */
export function parseTriggerDefinition(def: string): {
  timing: TriggerTiming | null;
  events: TriggerEvent[];
} {
  const ev = "INSERT|UPDATE|DELETE|TRUNCATE";
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
