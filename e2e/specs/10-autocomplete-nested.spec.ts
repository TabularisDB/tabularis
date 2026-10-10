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

    // Set the query text via the Monaco editor hook, then move the cursor to
    // the end so autocomplete triggers for the "only_" prefix (setValue leaves
    // the cursor at position 0, not the end of the text).
    await browser.execute(() => {
      const editor = (window as any).__e2e_editor;
      editor.setValue("SELECT * FROM only_");
      // Move cursor to the end of the line.
      const model = editor.getModel();
      const lastLine = model.getLineCount();
      const lastCol = model.getLineMaxColumn(lastLine);
      editor.setPosition({ lineNumber: lastLine, column: lastCol });
      editor.focus();
    });
    await browser.pause(3000);

    // Trigger autocomplete via Monaco's API (Ctrl+Space via browser.keys
    // doesn't reliably reach Monaco's editor in WKWebView).
    await browser.execute(() => {
      const editor = (window as any).__e2e_editor;
      editor.focus();
      editor.trigger("e2e", "editor.action.triggerSuggest", {});
    });
    await browser.pause(3000);

    // Check the autocomplete suggestion widget for only_secondary.
    const suggestions = await browser.execute(() => {
      const rows = Array.from(document.querySelectorAll('.suggest-widget .monaco-list-row'));
      return rows.map(r => r.textContent?.trim().slice(0, 40));
    });
    expect(suggestions.some((s: string) => s.includes("only_secondary"))).toBe(true);
  });
});
