// Finding #8: Selecting one database loses multi-DB opt-in after reconnect.
// set_selected_databases collapses a singleton array to a string; after
// reconnect the sidebar switches DATABASES → SCHEMAS and loses its
// database-management controls.
//
// The nested PostgreSQL sidebar (SidebarNestedDatabaseItem) has no "Manage
// Databases" button — that control only exists in the flat multi-db (MySQL)
// layout. So the real-UI path to trigger set_selected_databases for a nested
// PG connection is the connect-time reconciliation (DatabaseProvider drops
// databases no longer on the server) — not drivable by a test. Instead, this
// test calls set_selected_databases via IPC (the exact call the app's
// setSelectedDatabases makes — DatabaseProvider:923), which is what the
// reconciliation path and the flat manage button both invoke. Then it drives
// the REAL UI for the verification: disconnect, reconnect, and assert the
// sidebar still shows the database node.
import { waitForApp, openMultiDbConnection, disconnectConnection, goToConnectionsPage, connectConnection } from "../helpers/navigation";

describe("Finding #8: singleton preserves multi-DB opt-in", () => {
  it("keeps the DATABASES sidebar layout after set_selected_databases + reconnect", async () => {
    await waitForApp();
    await openMultiDbConnection(["testdb", "tabularis_test_secondary"]);

    // Call set_selected_databases(["testdb"]) via IPC — the same call the app
    // makes from setSelectedDatabases (DatabaseProvider:923) and the flat
    // layout's "Manage Databases" confirm button. The Rust command collapses
    // a 1-element array to Single("testdb") (commands.rs:994) — the bug.
    const connId = await browser.execute(async () => {
      const invoke = (window as any).__TAURI_INTERNALS__.invoke;
      const all = await invoke("get_connections");
      const conn = all.find((c: any) => c.name === "e2e-multi-db");
      return conn?.id ?? null;
    });
    expect(connId).toBeTruthy();

    await browser.execute(async (cid: string) => {
      const invoke = (window as any).__TAURI_INTERNALS__.invoke;
      await invoke("set_selected_databases", { connectionId: cid, databases: ["testdb"] });
    }, connId as string);
    await browser.pause(1000);

    // Verify the collapse persisted: the saved connection's database param
    // should now be the string "testdb" (Single), not the original array.
    const saved = await browser.execute(async () => {
      const invoke = (window as any).__TAURI_INTERNALS__.invoke;
      const all = await invoke("get_connections");
      const conn = all.find((c: any) => c.name === "e2e-multi-db");
      return JSON.stringify(conn ? conn.params.database : "no conn");
    });
    console.log("SAVED_DB:" + saved);

    // Disconnect — the sidebar goes back to the Connections page.
    await disconnectConnection();
    await browser.pause(2000);

    // Reconnect — drives the REAL UI connect flow.
    await goToConnectionsPage();
    await browser.pause(1000);
    await connectConnection();
    await browser.pause(5000);

    // BUG: on reconnect, hasOptedIntoDatabaseSelection(capabilities, "testdb")
    // returns false for a non-array string on a schema-based driver
    // (database.ts:65), so the connect path falls through to the flat
    // schema-only layout — the nested DATABASES tree is gone, and the sidebar
    // shows no database node. After the fix (keep the array), the nested
    // layout stays and "testdb" is visible as a database node.
    const hasDbNode = await browser.execute(() => {
      const spans = Array.from(document.querySelectorAll('span'))
        .filter(s => s.textContent?.trim() === "testdb" && s.className.includes("font-medium"));
      return spans.length > 0;
    });
    expect(hasDbNode).toBe(true);
  });
});
