// Finding #10: Nested SQL autocomplete doesn't receive the loaded tables. The
// hook reads top-level schemaDataMap/databaseDataMap, not
// nestedDatabaseDataMap, so a table that exists only in the secondary
// database (review.only_secondary) is not offered in autocomplete.
//
// This test drives the REAL UI: opens a console for the secondary review
// schema, types "only_" in the Monaco editor, triggers autocomplete, and
// checks the suggestion widget for only_secondary. Also checks the hook.
import { waitForApp, openMultiDbConnection, openNewConsole } from "../helpers/navigation";

describe("Finding #10: nested autocomplete", () => {
  it("offers secondary-only tables in a nested-database console", async () => {
    await waitForApp();
    await openMultiDbConnection();
    await openNewConsole("tabularis_test_secondary", "review");
    await browser.pause(3000);

    // Set the query text via the Monaco editor hook.
    await browser.execute(() => {
      (window as any).__e2e_editor.setValue("SELECT * FROM only_");
    });
    await browser.pause(1000);

    // Trigger autocomplete via Ctrl+Space.
    await browser.keys(["Control", "Space"]);
    await browser.pause(3000);

    // Check the autocomplete suggestion widget for only_secondary.
    const suggestions = await browser.execute(() => {
      const rows = Array.from(document.querySelectorAll('.suggest-widget .monaco-list-row'));
      return rows.map(r => r.textContent?.trim().slice(0, 40));
    });
    // BUG: reads databaseDataMap (not nestedDatabaseDataMap), so
    // only_secondary is missing from autocomplete suggestions.
    expect(suggestions.some((s: string) => s.includes("only_secondary"))).toBe(true);
  });
});
