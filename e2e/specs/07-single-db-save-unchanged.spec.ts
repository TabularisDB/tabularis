// Finding #7: Existing single-database PostgreSQL connections can't be saved
// unchanged. Editing an existing single-DB connection leaves the
// selected-database list empty and loadAllDatabases=false, but the new
// isMultiDb validation requires a selection. Opening Edit and clicking Save
// without changes fails with "Select at least one database".
//
// This test creates a single-DB connection via the UI (using the connection
// string field, which sets database to a plain string), then clicks Edit →
// Save. After the fix, the validation uses isOptedInMultiDb (which is false
// for a plain-string database on a schema-based driver), so the error does
// NOT appear and the save succeeds.
import { waitForApp, clickSaveConnection, clickEditConnection } from "../helpers/navigation";

describe("Finding #7: single-DB connection save unchanged", () => {
  it("saves an existing single-DB connection unchanged without the spurious error", async () => {
    await waitForApp();

    // Open the catalogue and pick the plugin PostgreSQL card.
    const addBtn = await $('button=Add Connection');
    await addBtn.waitForExist({ timeout: 30000 });
    await addBtn.click();
    await browser.waitUntil(
      async () => (await $$('button[aria-label="Connect to PostgreSQL"]')).length > 0,
      { timeout: 20000 },
    );
    const pgCards = await $$('button[aria-label="Connect to PostgreSQL"]');
    let targetIndex = 0;
    if (pgCards.length > 1) {
      const isDeprecated = await browser.execute(() =>
        Array.from(document.querySelectorAll('button[aria-label="Connect to PostgreSQL"]'))
          .map(c => c.textContent?.includes("Deprecated") ?? false)
      );
      const idx = isDeprecated.findIndex((d: boolean) => !d);
      targetIndex = idx >= 0 ? idx : 0;
    }
    await pgCards[targetIndex].click();
    await browser.pause(2000);

    // Fill the connection string (creates a single-DB connection, not multi-db).
    const connStrInput = await $('input[placeholder="postgres://user:pass@localhost:5432/db"]');
    await connStrInput.waitForExist({ timeout: 5000 });
    await browser.execute(() => {
      const input = document.querySelector('input[placeholder="postgres://user:pass@localhost:5432/db"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "postgres://postgres:password@127.0.0.1:54320/testdb");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await browser.pause(500);

    // Fill the connection name.
    await browser.execute(() => {
      const input = document.querySelector('input[placeholder="Provide your connection name"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "e2e-single-db");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await browser.pause(500);

    // Save — the connection string sets database to a plain string, so
    // loadAllDatabases stays true (default) and validation passes.
    await clickSaveConnection();
    await browser.pause(2000);

    // Now the connection card should be on the Connections page (saved via UI).
    await clickEditConnection();
    await browser.pause(2000);

    // Click Save without changing anything. Before the fix, the edit-init
    // code set loadAllDatabases=false and selectedDatabasesState=[], so
    // isMultiDb validation fired: "Select at least one database". After the
    // fix, isOptedInMultiDb is false for a plain-string database on a
    // schema-based driver, so the validation is skipped and the save succeeds.
    await clickSaveConnection();
    await browser.pause(2000);

    // Assert the error does NOT appear (the save succeeded).
    const err = await $('=Select at least one database');
    const present = await err.isExisting().catch(() => false);
    expect(present).toBe(false);
  });
});
