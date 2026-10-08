// Finding #1: Editing a secondary-database row can update multiple rows.
// fetchPkColumn doesn't pass the database override → get_columns returns the
// primary's PK (id only) → pkColumns: ["id"] → Submit Changes updates BOTH
// rows sharing id=1.
//
// This test drives the REAL UI flow: open the table, stage a pending edit on
// the note cell via the __e2e_pendingChange test hook (the native input event
// that sets the textarea value doesn't reliably trigger React's onChange in
// WKWebView, so handleEditCommit drops the change — the hook mirrors
// handleEditCommit's buildPkMap + onPendingChange with a forced value), click
// Submit Changes, and assert via direct-DB which rows changed.
import { closeDbClients, primaryRecordsNote, secondaryRecordsNote } from "../helpers/db";
import { waitForApp, openMultiDbConnection, expandNode, expandSchemaUnderDb, clickSubmitChanges } from "../helpers/navigation";

describe("Finding #1: editing a secondary-db row", () => {
  it("updates only the targeted row, not every row sharing the leaked PK column", async () => {
    await waitForApp();
    await openMultiDbConnection();

    // Open the records table in the secondary database. Uses the
    // __e2e_openTable hook (not openTable's dblclick dispatchEvent, which
    // doesn't trigger React's onDoubleClick in WKWebView). The schema must
    // be loaded first (expand db + select schema) so the table node exists.
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
    await cell.waitForExist({ timeout: 20000 });
    await browser.pause(2000);

    // Stage a pending edit on the note cell (row 0, col 3 = "note"). The grid
    // columns are: [0]="#", [1]="id", [2]="tenant_id", [3]="note", [4]="parent_id".
    // Uses __e2e_pendingChange (not dblclick + textarea + Enter) because the
    // native input event doesn't reliably trigger React's onChange in WKWebView.
    const staged = await browser.execute(() => {
      return (window as any).__e2e_pendingChange(0, 3, "EDITED-10");
    });
    expect(staged).toBe(true);
    await browser.pause(2000);

    // Submit the changes.
    await clickSubmitChanges();
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
