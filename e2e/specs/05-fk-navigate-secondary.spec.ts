// Finding #5: Following a foreign key from the secondary database opens the
// primary database. handleForeignKeyNavigate (Editor.tsx:2517) creates the
// new tab with a schema but no database, so the navigated table loads from the
// primary instead of the source tab's database.
//
// The inline FK arrow button (DataGridRow.tsx:723) only renders when
// fksByColumn has the column's FK — but get_foreign_keys (Editor.tsx:1066)
// also lacks the database param, so for a secondary table the FK metadata may
// come from the primary (or be empty), and the button may never appear. The
// __e2e_fkNavigate hook (DataGrid.tsx:1649) bypasses fksByColumn and calls
// onForeignKeyNavigate directly with a FK object the test provides, exercising
// the real handleForeignKeyNavigate path.
import { waitForApp, openMultiDbConnection, expandNode, expandSchemaUnderDb } from "../helpers/navigation";

describe("Finding #5: FK navigation from secondary db", () => {
  it("opens the referenced row in the source tab's database, not the primary", async () => {
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

    // Wait for the DataGrid to load rows (may be slow in full-suite context).
    const cell = await $('td=SECONDARY-10');
    await cell.waitForExist({ timeout: 30000 });
    await browser.pause(3000);

    // Call the real onForeignKeyNavigate handler directly via the e2e hook
    // (bypasses fksByColumn, which may be empty due to the same database-
    // routing bug). The FK: records.parent_id -> parent.id, value 100.
    const fired = await browser.execute(() => {
      return (window as any).__e2e_fkNavigate(
        { column_name: "parent_id", ref_table: "parent", ref_column: "id", name: "records_parent_id_fkey" },
        100,
      );
    });
    expect(fired).toBe(true);
    await browser.pause(3000);

    // The FK-navigated tab's title should include the secondary database name.
    // BUG: handleForeignKeyNavigate doesn't pass the database, so the new tab's
    // title shows just "parent" without the database qualifier — the query
    // targets the primary, not tabularis_test_secondary.
    const tabHasDb = await browser.execute(() => {
      const spans = Array.from(document.querySelectorAll('span'))
        .filter(s => s.textContent?.includes("parent") && s.textContent?.includes("tabularis_test_secondary"));
      return spans.length > 0;
    });
    expect(tabHasDb).toBe(true);
  });
});
