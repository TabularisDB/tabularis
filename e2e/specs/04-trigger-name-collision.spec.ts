// Blocking fix: editing a trigger whose EXECUTE FUNCTION clause
// references a non-convention function name must update THAT function (via
// CREATE OR REPLACE), not silently create a second, convention-named function
// alongside it or clobber an unrelated one.
//
// The seed sets up `normalize` on trigger_a and trigger_b, both pointing at
// the shared `normalize_fn`. The old behavior (prior fix) created separate
// `trigger_a_normalize_fn`/`trigger_b_normalize_fn` on edit — because it
// used the generated convention name, not the one in the EXECUTE clause.
// With the fix, editing trigger_a's normalize correctly updates `normalize_fn`
// in place; the trigger still points to the same function after the edit.
//
// This test drives the REAL UI: opens the TriggerEditorModal for the existing
// `normalize` trigger, edits its body via __e2e_save_trigger_with_body, then
// inserts a row into trigger_a and asserts the new body ran.
//
// Idempotent: beforeSession re-seeds normalize_fn back to its original body
// ('from A'); the DELETE/INSERT cleanup at the end handles the 7777 test row.
import { closeDbClients, querySecondary } from "../helpers/db";
import { waitForApp, openMultiDbConnection } from "../helpers/navigation";

describe("trigger edit updates real function, not a convention-named orphan", () => {
  it("updates normalize_fn in place when editing trigger_a's normalize trigger", async () => {
    await waitForApp();
    await openMultiDbConnection();

    // Clean up any stale test rows.
    await querySecondary("DELETE FROM review.trigger_a WHERE id = 7777");

    // Open the TriggerEditorModal for trigger_a's `normalize` trigger.
    await browser.execute(() => {
      (window as any).__e2e_open_trigger_editor("normalize", "trigger_a", "review", "tabularis_test_secondary");
    });
    await browser.pause(3000);

    // Save with a new body. With the fix, this updates `normalize_fn`
    // (the real function) — not `trigger_a_normalize_fn` (the convention name).
    await browser.execute(async () => {
      try {
        await (window as any).__e2e_save_trigger_with_body("  NEW.note := 'updated by fix4';\n  RETURN NEW;");
      } catch (e) {
        // Swallow any thrown errors so the test can assert the DB state.
      }
    });
    await browser.pause(2000);

    // Insert a fresh row — the trigger fires and sets note via normalize_fn.
    await querySecondary("INSERT INTO review.trigger_a (id) VALUES (7777)");
    const rows = await querySecondary<{ note: string }>(
      "SELECT note FROM review.trigger_a WHERE id = 7777"
    );
    const note = rows[0]?.note ?? "";

    // With the fix, normalize_fn was updated in place to 'updated by fix4',
    // and the trigger still calls it — so the inserted row has the new body.
    expect(note).toBe("updated by fix4");

    // Verify normalize_fn was updated (not a second convention-named function
    // created alongside it).
    const conventionFn = await querySecondary<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
      "WHERE n.nspname = 'review' AND p.proname = 'trigger_a_normalize_fn') AS exists"
    );
    expect(conventionFn[0]?.exists).toBe(false);

    await querySecondary("DELETE FROM review.trigger_a WHERE id = 7777");
    await closeDbClients();
  });
});
