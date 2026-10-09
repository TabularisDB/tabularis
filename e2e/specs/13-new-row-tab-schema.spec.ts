// PR #822 recommended fix 4: "New row" and save-edits validation call get_columns
// with the tab's own schema (activeTab?.schema), not the connection-level
// activeSchema. In nested multi-db mode, a tab scoped to the `review` schema
// must fetch columns from `review.records`, not from `public.records` (which
// doesn't exist in the secondary DB).
//
// This test drives the REAL UI: opens the `records` table in the secondary
// `review` schema (a non-default schema), then triggers the new-row flow via
// the handleNewRow path. The get_columns call must use the tab's `review`
// schema to return columns; with the bug (activeSchema = public), it would
// find no table and return empty columns. We verify via the DataGrid that the
// new-row insertion form has the table's real columns (id, tenant_id, note,
// parent_id), proving the schema was correct.
//
// Idempotent: the beforeSession hook re-seeds the fixtures; the test opens a
// table read-only and triggers a new-row form (never submits), so no DB state
// changes. A prior run's unsubmitted new-row is discarded on tab close.
import { closeDbClients, querySecondary } from "../helpers/db";
import { waitForApp, openMultiDbConnection, expandNode, expandSchemaUnderDb } from "../helpers/navigation";

describe("PR #822 fix 4: new-row get_columns uses the tab's schema", () => {
  it("fetches columns from the tab's review schema, not the connection's active schema", async () => {
    await waitForApp();
    await openMultiDbConnection();

    // Open the records table in the secondary database's review schema (a
    // non-default schema — the secondary's `public` schema is empty).
    await expandNode("tabularis_test_secondary");
    await browser.pause(1000);
    await expandSchemaUnderDb("review", "tabularis_test_secondary");
    await browser.pause(1000);
    await browser.execute(() => {
      (window as any).__e2e_openTable("records", "review", "tabularis_test_secondary");
    });
    await browser.pause(3000);

    // The DataGrid should have loaded the table's rows. Verify the column
    // headers include the secondary's columns (proving get_columns used the
    // right schema). With the bug (activeSchema = public), get_columns would
    // return 0 columns and the grid would be empty or error. The header cells
    // render as "name" + "type" (e.g. "idid: integer"), so check for the column
    // name as a substring.
    const headers = await browser.execute(() =>
      Array.from(document.querySelectorAll('th'))
        .filter(e => e.offsetParent !== null)
        .map(e => e.textContent?.trim() ?? "")
        .filter(Boolean)
    );
    // The records table has columns: id, tenant_id, note, parent_id.
    expect(headers.some((h: string) => h.startsWith("id"))).toBe(true);
    expect(headers.some((h: string) => h.startsWith("note"))).toBe(true);

    // Trigger a new row via handleNewRow. This calls get_columns with the
    // tab's schema. With the fix, it returns the table's real columns; without
    // it (activeSchema = public), it returns empty/no columns (and handleNewRow
    // throws "No columns found" without adding a row).
    // The "New Row" button is in the Data Manipulation Toolbar below the header,
    // with title="New Row" and a Plus icon — distinct from the sidebar's
    // "Create New Table" button which also has a Plus icon.
    const rowCountBefore = await browser.execute(() =>
      document.querySelectorAll('table tbody tr[data-row-index]').length
    );
    await browser.execute(() => {
      const btn = document.querySelector('button[title="New Row"]') as HTMLElement;
      btn?.click();
    });
    await browser.pause(2000);

    // After clicking new-row, a blank insertion row should appear in the grid.
    // If get_columns returned the right schema's columns, handleNewRow succeeds
    // and the insertion row is added (one more row). If it returned empty (wrong
    // schema), handleNewRow throws "No columns found" and no row is added.
    const rowCountAfter = await browser.execute(() =>
      document.querySelectorAll('table tbody tr[data-row-index]').length
    );
    expect(rowCountAfter).toBeGreaterThan(rowCountBefore);

    await closeDbClients();
  });
});
