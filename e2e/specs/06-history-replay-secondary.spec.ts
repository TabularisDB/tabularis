// Finding #6: History replay executes a secondary-database query on the
// primary. The history path stores the schema as its `database` field, then
// passes it back only as a schema when reopening. Running a query in a New
// Console from secondary `review` returns `tabularis_test_secondary`, but
// replaying from history opens a tab with `schema: "review"`, no database,
// returning the PRIMARY's `current_database()` (testdb).
//
// This test drives the REAL UI flow: runs a query in the secondary console
// via Monaco + Run button, then switches to the History tab, selects the
// entry, presses Enter to replay it, and asserts the replayed result.
import { getQueryHistory } from "../helpers/db";
import { waitForApp, openMultiDbConnection, openNewConsole, getMonacoEditor } from "../helpers/navigation";

describe("Finding #6: history replay on secondary db", () => {
  it("replays the query against the original secondary database, not the primary", async () => {
    await waitForApp();
    await openMultiDbConnection();
    await openNewConsole("tabularis_test_secondary", "review");
    await browser.pause(2000);

    // Set the query in Monaco via the e2e editor hook.
    await browser.execute(() => {
      (window as any).__e2e_editor.setValue("SELECT current_database() AS db");
    });
    await browser.pause(500);

    // Click the Run button (the one with the Play icon).
    await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
      const runBtn = btns.find(b => b.querySelector('svg.lucide-play'));
      runBtn?.click();
    });
    await browser.pause(8000);

    // The result grid should show tabularis_test_secondary.
    const tds = await browser.execute(() =>
      Array.from(document.querySelectorAll('td')).filter(e => e.offsetParent !== null).map(e => e.textContent?.trim().slice(0, 50)).slice(0, 10)
    );
    expect(tds).toContain("tabularis_test_secondary");

    // Now replay from History. Click the History tab in the sidebar.
    await browser.execute(() => {
      const btn = document.querySelector('button[title="History"]') as HTMLElement;
      if (btn) btn.click();
    });
    await browser.pause(1500);

    // Find the history entry (a button containing "current_database").
    await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const entry = btns.find(b => b.textContent?.includes("current_database"));
      if (entry) entry.click(); // select the entry
    });
    await browser.pause(500);
    // Press Enter to replay (the history entry's onKeyDown fires onDoubleClick).
    await browser.keys(["Enter"]);
    await browser.pause(8000);

    // The replayed tab should show tabularis_test_secondary (not testdb).
    // BUG: history stores "review" as the database field, so the replayed
    // query targets the primary database (testdb).
    const replayTds = await browser.execute(() =>
      Array.from(document.querySelectorAll('td')).filter(e => e.offsetParent !== null).map(e => e.textContent?.trim().slice(0, 50)).slice(0, 10)
    );
    expect(replayTds).toContain("tabularis_test_secondary");

    // Also verify the stored history entry's database field.
    const connId = await (await import("../helpers/db")).getActiveConnectionId();
    const entries = await getQueryHistory(connId);
    const lastEntry = entries[entries.length - 1];
    expect(lastEntry.database).toBe("tabularis_test_secondary");
  });
});
