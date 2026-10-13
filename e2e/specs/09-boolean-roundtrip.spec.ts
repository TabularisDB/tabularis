// Finding #9: Plugin PG dumps don't round-trip boolean columns. The dump
// serializer writes booleans as unquoted 1/0 (escape_sql_value at
// dump_commands.rs:426), but Postgres boolean columns reject integer literals
// (SQLSTATE 42804). The non-atomic plugin import commits the DROP+CREATE then
// fails on the INSERT, leaving the table empty.
//
// This test drives the REAL IPC path the Dump Database modal and Run SQL File
// button use (dump_database + import_database), against the plugin driver,
// then asserts via direct-DB that the import succeeded and booleans
// round-trip. A prior run's destructive import may have emptied dump_types,
// so the test re-seeds the two boolean rows before dumping.
import { closeDbClients, querySecondary, secondaryBoolValue, getActiveConnectionId } from "../helpers/db";
import { waitForApp, openMultiDbConnection } from "../helpers/navigation";

describe("Finding #9: boolean round-trip in dump/import", () => {
  it("round-trips boolean columns as true/false, not 1/0", async () => {
    await waitForApp();
    await openMultiDbConnection();

    // Re-seed the boolean rows: a prior run's non-atomic import may have
    // emptied dump_types (DROP+CREATE commits, INSERT fails → 0 rows). The
    // seed is idempotent but won't re-insert if the rows exist — and after
    // the destructive import they don't, so delete + re-insert guarantees
    // exactly 2 rows with the right booleans regardless of prior state.
    await querySecondary("DELETE FROM review.dump_types");
    await querySecondary("INSERT INTO review.dump_types (id, enabled, payload) VALUES (1, TRUE, '{\"key\":\"value\"}'::jsonb)");
    await querySecondary("INSERT INTO review.dump_types (id, enabled, payload) VALUES (2, FALSE, '\"string\"'::jsonb)");

    // Dump the dump_types table. The connectionId is passed as a serializable
    // arg to browser.execute (it can't be closed over from Node) and received
    // as a named param (arrow functions have no `arguments`).
    const connId = await getActiveConnectionId();
    const dumpResult = await browser.execute(async (cid: string) => {
      const invoke = (window as any).__TAURI_INTERNALS__.invoke;
      try {
        await invoke("dump_database", {
          connectionId: cid, filePath: "/tmp/e2e-bool-dump.sql",
          options: { structure: true, data: true, tables: ["dump_types"] },
          schema: "review", database: "tabularis_test_secondary",
        });
        return "ok";
      } catch (e) { return "ERR:" + String(e).slice(0, 150); }
    }, connId);
    expect(dumpResult).toBe("ok");

    // Import it back — the bug: booleans serialized as 1/0, so the import
    // fails with "column is of type boolean but expression is of type integer".
    // The non-atomic plugin import commits the DROP+CREATE then fails on the
    // INSERT, leaving the table empty.
    const importResult = await browser.execute(async (cid: string) => {
      const invoke = (window as any).__TAURI_INTERNALS__.invoke;
      try {
        await invoke("import_database", {
          connectionId: cid, filePath: "/tmp/e2e-bool-dump.sql",
          schema: "review", database: "tabularis_test_secondary",
        });
        return "ok";
      } catch (e) { return "ERR:" + String(e).slice(0, 150); }
    }, connId);
    // BUG: import fails. After the fix, import succeeds and booleans
    // round-trip as true/false.
    expect(importResult).toBe("ok");

    // Direct-DB: booleans should round-trip.
    const v1 = await secondaryBoolValue(1);
    const v2 = await secondaryBoolValue(2);
    expect(v1).toBe(true);
    expect(v2).toBe(false);

    await closeDbClients();
  });
});
