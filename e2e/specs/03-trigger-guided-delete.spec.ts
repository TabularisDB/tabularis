// Finding #3: Saving an existing PostgreSQL trigger in Guided mode deletes it,
// then fails. The parser treats `EXECUTE FUNCTION audit_fn()` as the editable
// body; the generator wraps it in an invalid CREATE OR REPLACE FUNCTION. Edit
// Trigger → Save unchanged → confirm Recreate → trigger dropped, function
// creation fails, trigger gone.
//
// This test drives the REAL UI flow via test hooks: opens the trigger editor
// for the seeded `trg_audit` trigger (via __e2e_open_trigger_editor —
// tauri-wd can't trigger the right-click context menu), then calls
// __e2e_save_trigger (which runs handleSave → ask() auto-accept →
// create/replace function → drop_trigger → create_trigger). Asserts the
// trigger survives the guided-save flow (after the fix: the function is
// created first using the real function name from parseTriggerFunctionName,
// so a function-creation failure never leaves the trigger dropped).
import { closeDbClients, secondaryTriggerNames } from "../helpers/db";
import { waitForApp, openMultiDbConnection } from "../helpers/navigation";

describe("Finding #3: trigger guided-mode save", () => {
  it("the trigger is NOT deleted by the guided-save flow", async () => {
    await waitForApp();
    await openMultiDbConnection();

    // Verify the trigger exists before.
    const triggersBefore = await secondaryTriggerNames("records");
    expect(triggersBefore).toContain("trg_audit");

    // Open the trigger editor for the existing trg_audit trigger.
    await browser.execute(() => {
      (window as any).__e2e_open_trigger_editor("trg_audit", "records", "review", "tabularis_test_secondary");
    });
    await browser.pause(2000);

    // Click Save Changes via the hook (runs handleSave, which after the fix
    // does: ask() → create/replace function → drop_trigger → create_trigger,
    // so the trigger is recreated successfully and survives the save).
    await browser.execute(async () => {
      await (window as any).__e2e_save_trigger();
    });
    await browser.pause(3000);

    // After the fix, the trigger is recreated successfully (the function is
    // created first using the real function name, so the guided-save flow no
    // longer drops the trigger without recreating it).
    const triggersAfter = await secondaryTriggerNames("records");
    expect(triggersAfter).toContain("trg_audit");

    await closeDbClients();
  });
});
