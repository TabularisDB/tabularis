// Direct-Postgres assertion helpers for E2E tests.
//
// The whole point of the adversarial fixture: a UI action may *display* the
// correct row while *writing* to the wrong database. The only reliable
// detector is to query each database directly and compare. Mirrors the Rust
// `src-tauri/tests/postgres_integration/helpers.rs` pg_params / pg_params_secondary
// pattern.
//
// Connection values are stable (127.0.0.1:54320, postgres/password) — they
// match the CI provisioning in e2e-macos.yml and the local seed convention.

import { Client, type QueryResultRow } from "pg";

export type TestDb = "testdb" | "tabularis_test_secondary";

const PG = {
  host: "127.0.0.1",
  port: 54320,
  user: "postgres",
  password: "password",
};

// Reuse a single client per database across a spec (cheaper than reconnecting
// per assertion). Closed in afterAll.
const clients: Partial<Record<TestDb, Client>> = {};

export async function dbClient(database: TestDb): Promise<Client> {
  if (!clients[database]) {
    const c = new Client({ ...PG, database });
    await c.connect();
    clients[database] = c;
  }
  return clients[database]!;
}

export async function closeDbClients(): Promise<void> {
  await Promise.all(
    Object.values(clients).map((c) => c?.end().catch(() => {})),
  );
  for (const k of Object.keys(clients)) delete clients[k as TestDb];
}

// --- Query helpers ---------------------------------------------------------

export async function queryPrimary<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await dbClient("testdb");
  const { rows } = await c.query<T>(sql, params);
  return rows;
}

export async function querySecondary<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await dbClient("tabularis_test_secondary");
  const { rows } = await c.query<T>(sql, params);
  return rows;
}

// --- Finding #1: edit-secondary-row PK leakage ----------------------------

/** The primary's single sentinel row. Must be untouched by a secondary edit. */
export async function primaryRecordsNote(id = 1): Promise<string> {
  const [row] = await queryPrimary<{ note: string }>(
    "SELECT note FROM review.records WHERE id = $1",
    [id],
  );
  return row?.note ?? "";
}

/** One row of the secondary's composite-PK table. */
export async function secondaryRecordsNote(
  id: number,
  tenantId: number,
): Promise<string> {
  const [row] = await querySecondary<{ note: string }>(
    "SELECT note FROM review.records WHERE id = $1 AND tenant_id = $2",
    [id, tenantId],
  );
  return row?.note ?? "";
}

/** Count secondary rows with a given id (PK-leak detection: should be 2). */
export async function secondaryRowCountForId(id = 1): Promise<number> {
  const [row] = await querySecondary<{ count: string }>(
    "SELECT count(*)::text AS count FROM review.records WHERE id = $1",
    [id],
  );
  return Number(row?.count ?? 0);
}

// --- Finding #5: FK navigation --------------------------------------------

export async function primaryParentLabel(id = 100): Promise<string> {
  const [row] = await queryPrimary<{ label: string }>(
    "SELECT label FROM review.parent WHERE id = $1",
    [id],
  );
  return row?.label ?? "";
}

export async function secondaryParentLabel(id = 100): Promise<string> {
  const [row] = await querySecondary<{ label: string }>(
    "SELECT label FROM review.parent WHERE id = $1",
    [id],
  );
  return row?.label ?? "";
}

// --- Findings #2/#9: dump/import + boolean round-trip ---------------------

/** Does a table exist in the secondary database's review schema? */
export async function secondaryTableExists(name: string): Promise<boolean> {
  const [row] = await querySecondary<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'review' AND table_name = $1) AS exists",
    [name],
  );
  return Boolean(row?.exists);
}

export async function secondaryBoolValue(id = 1): Promise<boolean | null> {
  const [row] = await querySecondary<{ enabled: boolean }>(
    "SELECT enabled FROM review.dump_types WHERE id = $1",
    [id],
  );
  return row?.enabled ?? null;
}

// --- Findings #3/#4: triggers ----------------------------------------------

/** Names of triggers on a table in the secondary review schema. */
export async function secondaryTriggerNames(tableName: string): Promise<string[]> {
  const rows = await querySecondary<{ tgname: string }>(
    `SELECT tgname FROM pg_trigger
     JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid
     JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
     WHERE nspname = 'review' AND relname = $1 AND NOT tgisinternal`,
    [tableName],
  );
  return rows.map((r) => r.tgname);
}

/** The note stored on a trigger_a / trigger_b row after a trigger fires. */
export async function secondaryTriggerRowNote(
  table: "trigger_a" | "trigger_b",
  id = 1,
): Promise<string> {
  const [row] = await querySecondary<{ note: string }>(
    `SELECT note FROM review.${table} WHERE id = $1`,
    [id],
  );
  return row?.note ?? "";
}

// --- IPC wrappers for Tauri commands ---------------------------------------

/** Call a Tauri command via browser.execute. */
async function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return await browser.execute(async (c: string, a: Record<string, unknown>) => {
    return await (window as any).__TAURI_INTERNALS__.invoke(c, a);
  }, cmd, args) as T;
}

/** Get the active connection ID (the first active connection). */
export async function getActiveConnectionId(): Promise<string> {
  const ids = await invoke<string[]>("get_active_connections");
  return ids[0];
}

/** Dump a database/schema/table to a file via IPC. */
export async function dumpDatabase(
  connectionId: string,
  filePath: string,
  tables: string[],
  schema?: string,
  database?: string,
): Promise<void> {
  await invoke("dump_database", {
    connectionId,
    filePath,
    options: { structure: true, data: true, tables },
    schema: schema ?? null,
    database: database ?? null,
  });
}

/** Import a dump file into a database/schema via IPC. */
export async function importDatabase(
  connectionId: string,
  filePath: string,
  schema?: string,
  database?: string,
): Promise<void> {
  await invoke("import_database", {
    connectionId,
    filePath,
    schema: schema ?? null,
    database: database ?? null,
  });
}

/** Get a trigger's definition via IPC. */
export async function getTriggerDefinition(
  connectionId: string,
  triggerName: string,
  tableName: string,
  schema?: string,
  database?: string,
): Promise<string> {
  return await invoke<string>("get_trigger_definition", {
    connectionId,
    triggerName,
    tableName,
    schema: schema ?? null,
    database: database ?? null,
  });
}

/** Get query history entries via IPC. */
export async function getQueryHistory(
  connectionId: string,
): Promise<Array<{ database?: string; sql: string }>> {
  const res = await invoke<{ entries: Array<{ database?: string; sql: string }> }>(
    "get_query_history",
    { connectionId },
  );
  return res.entries;
}
