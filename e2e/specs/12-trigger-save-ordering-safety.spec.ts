// Blocking fix: Trigger save creates the function BEFORE dropping
// the trigger, so a function-creation failure leaves the existing trigger
// intact. Before the fix, the edit flow dropped the trigger first, then tried
// to create the function — a syntax error in the body left the trigger gone
// with no rollback.
//
// This test drives the REAL UI via test hooks: opens the seeded `trg_audit`
// trigger for edit, then calls __e2e_save_trigger_with_body with an invalid
// PL/pgSQL body (a bare keyword that's not a valid statement). The function
// creation fails; after the fix, the trigger is NOT dropped (the drop only
// runs after a successful function creation).
//
// Idempotent: the beforeSession hook re-seeds the fixtures (ON CONFLICT DO
// UPDATE), so the `trg_audit` trigger and its function are restored before
// each run regardless of prior-run side effects.
import { closeDbClients, secondaryTriggerNames } from "../helpers/db";
import { waitForApp, openMultiDbConnection } from "../helpers/navigation";

describe("trigger save ordering: function created before drop", () => {
  it("does not drop the trigger when the function-creation step fails", async () => {
    await waitForApp();
    await openMultiDbConnection();

    // Verify the trigger exists before the save attempt.
    const triggersBefore = await secondaryTriggerNames("records");
    expect(triggersBefore).toContain("trg_audit");

    // Open the trigger editor for the existing trg_audit trigger.
    await browser.execute(() => {
      (window as any).__e2e_open_trigger_editor("trg_audit", "records", "review", "tabularis_test_secondary");
    });
    await browser.pause(2000);

    // Save with an INVALID PL/pgSQL body — a bare keyword that's not a valid
    // statement. The CREATE OR REPLACE FUNCTION will fail with a syntax error.
    // Before the fix: drop_trigger ran first → trigger gone. After the fix:
    // the function is created before the drop, so the failure leaves the
    // trigger intact. The __e2e_save_trigger_with_body hook doesn't catch the
    // error (unlike handleSave), so wrap it in a try/catch — the error is
    // expected; the assertion is that the trigger survived.
    await browser.execute(async () => {
      try {
        await (window as any).__e2e_save_trigger_with_body("NOT A VALID STATEMENT");
      } catch (e) {
        // Expected: the function creation fails with a syntax error.
        // The trigger must NOT have been dropped.
      }
    });
    await browser.pause(3000);

    // The trigger must still exist — the function-creation failure prevented
    // the drop from running.
    const triggersAfter = await secondaryTriggerNames("records");
    expect(triggersAfter).toContain("trg_audit");

    await closeDbClients();
  });
});
