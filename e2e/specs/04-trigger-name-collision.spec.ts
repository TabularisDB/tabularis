// Finding #4: Same-named triggers on different tables overwrite each other's
// functions. PostgreSQL allows the same trigger name on different tables,
// but the backing function is named only ${triggerName}_fn with CREATE OR
// REPLACE. Creating `normalize` on trigger_b clobbers trigger_a's function.
//
// This test drives the REAL UI: opens the TriggerEditorModal for the existing
// `normalize` trigger, then calls __e2e_save_trigger_with_body (which mirrors
// handleSave: create/replace function → drop_trigger → create trigger —
// the function is created before the drop so a failure leaves the trigger
// intact). Inserts a fresh row into trigger_a to observe the current trigger
// behavior.
import { closeDbClients, querySecondary } from "../helpers/db";
import { waitForApp, openMultiDbConnection } from "../helpers/navigation";

describe("Finding #4: same-named trigger collision", () => {
  it("keeps each table's trigger behavior independent", async () => {
    await waitForApp();
    await openMultiDbConnection();

    // Clean up any stale rows from prior runs.
    await querySecondary("DELETE FROM review.trigger_a WHERE id = 7777");
    await querySecondary("DELETE FROM review.trigger_b WHERE id = 7777");

    // Create `normalize` on trigger_a with body `from A`.
    await browser.execute(() => {
      (window as any).__e2e_open_trigger_editor("normalize", "trigger_a", "review", "tabularis_test_secondary");
    });
    await browser.pause(3000);
    await browser.execute(async () => {
      await (window as any).__e2e_save_trigger_with_body("  NEW.note := 'from A';\n  RETURN NEW;");
    });
    await browser.pause(2000);

    // Create `normalize` on trigger_b with body `from B`.
    await browser.execute(() => {
      (window as any).__e2e_open_trigger_editor("normalize", "trigger_b", "review", "tabularis_test_secondary");
    });
    await browser.pause(3000);
    await browser.execute(async () => {
      await (window as any).__e2e_save_trigger_with_body("  NEW.note := 'from B';\n  RETURN NEW;");
    });
    await browser.pause(2000);

    // Insert a fresh row into trigger_a. The bug: both triggers share
    // normalize_fn, so inserting into A stores 'from B' (the last CREATE
    // OR REPLACE). After the fix (table-scoped fn names), A stores 'from A'.
    await querySecondary("INSERT INTO review.trigger_a (id) VALUES (7777)");
    const rows = await querySecondary<{ note: string }>("SELECT note FROM review.trigger_a WHERE id = 7777");
    const noteA = rows[0]?.note ?? "";
    expect(noteA).toBe("from A");

    await closeDbClients();
  });
});
