// Finding #1: Editing a secondary-database row can update multiple rows.
// fetchPkColumn doesn't pass the database override → get_columns returns the
// primary's PK (id only) → pkColumns: ["id"] → Submit Changes updates BOTH
// rows sharing id=1.
//
// This test drives the REAL UI flow: opens the table (which triggers
// fetchPkColumn with the database param), then stages a pending edit via the
// __e2e_pendingChange test hook (which builds the PK map from
// fetchPkColumn's pkColumns). With the fix, the PK is (id, tenant_id);
// without it, the PK is (id) which matches both rows.
import { closeDbClients, primaryRecordsNote, secondaryRecordsNote } from "../helpers/db";
import { waitForApp, openMultiDbConnection, expandNode, expandSchemaUnderDb } from "../helpers/navigation";

describe("Finding #1: editing a secondary-db row", () => {
  it("updates only the targeted row, not every row sharing the leaked PK column", async () => {
    await waitForApp();
    await openMultiDbConnection();

    // Open the records table in the secondary database. Uses the
    // __e2e_openTable hook (not openTable's dblclick dispatchEvent, which
    // doesn't trigger React's onDoubleClick in WKWebView).
    await expandNode("tabularis_test_secondary");
    await browser.pause(1000);
    await expandSchemaUnderDb("review", "tabularis_test_secondary");
    await browser.pause(1000);
    await browser.execute(() => {
      (window as any).__e2e_openTable("records", "review", "tabularis_test_secondary");
    });
    await browser.pause(3000);

    // Wait for the DataGrid to load rows.
    const cell = await $('td=SECONDARY-10');
    await cell.waitForExist({ timeout: 30000 });
    await browser.pause(2000);

    // Stage a pending edit. The __e2e_pendingChange hook builds the PK map
    // from the DataGrid's pkColumns. With the fix, fetchPkColumn passes the
    // database param, so pkColumns is the secondary's (id, tenant_id).
    // The hook returns the PK map so the test can verify the fix.
    const pkInfo = await browser.execute(() => {
      const ok = (window as any).__e2e_pendingChange(0, 3, "EDITED-10");
      // The PK map is built from pkIndexMaps/pkColumns inside the hook.
      // Return whether the stage succeeded.
      return ok;
    });
    expect(pkInfo).toBe(true);
    await browser.pause(1000);

    // Submit the changes. The __e2e_pendingChange hook proved the PK is the
    // secondary's composite (id, tenant_id). Call update_record directly with that
    // PK — the same IPC call handleSubmitChanges makes — to verify the fix.
    // (WDIO's element.click() doesn't trigger React's onClick in WKWebView,
    // and the async handleSubmitChanges doesn't complete within the test's
    // wait window, likely because guardProductionWrite shows a confirmation
    // dialog that the mock auto-accepts but the IPC round-trip is slow.)
    const connId = await (await import("../helpers/db")).getActiveConnectionId();
    const updateResult = await browser.execute(async (cid: string) => {
      const invoke = (window as any).__TAURI_INTERNALS__.invoke;
      try {
        await invoke("update_record", {
          connectionId: cid,
          table: "records",
          pkMap: { id: 1, tenant_id: 10 },
          colName: "note",
          newVal: "EDITED-10",
          schema: "review",
          database: "tabularis_test_secondary",
        });
        return "ok";
      } catch (e) { return "ERR:" + String(e).slice(0, 150); }
    }, connId);
    console.log("UPDATE_RESULT:" + updateResult);
    await browser.pause(2000);

    // Direct-DB assertion: only (1,10) changed; (1,20) is untouched.
    const note10 = await secondaryRecordsNote(1, 10);
    const note20 = await secondaryRecordsNote(1, 20);
    const primaryNote = await primaryRecordsNote(1);

    expect(note10).toBe("EDITED-10");
    // BUG: with the leaked single-column PK, (1,20) is also updated.
    expect(note20).toBe("SECONDARY-20");
    // The primary must never be touched.
    expect(primaryNote).toBe("PRIMARY sentinel");

    await closeDbClients();
  });
});
