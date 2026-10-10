// Blocking fix: New PostgreSQL connections must default to
// single-database mode (Database field visible, no Databases tab, "Browse
// multiple databases" checkbox unchecked). Before the fix, a new PG form
// started with database: "" which hasOptedIntoDatabaseSelection read as the
// all-databases opt-in signal — every new PG connection silently became
// nested multi-database mode.
//
// This test drives the REAL UI: opens the New Connection modal for the
// PostgreSQL plugin, fills the form fields (but does NOT touch the Databases
// tab), and asserts:
//  1. The single "Database Name" field is visible on the General tab.
//  2. The "Browse multiple databases" checkbox is visible and unchecked.
//  3. The "Databases" tab is NOT present.
// Then checks the opt-in checkbox and asserts:
//  4. The "Database Name" field disappears.
//  5. The "Databases" tab appears.
//
// Idempotent: creates a throwaway connection (never saved — the assertion runs
// before clicking Save), so no DB state to clean up. The beforeSession hook
// clears saved connections, so a prior run's connection doesn't interfere.
import { waitForApp, clickAddConnection } from "../helpers/navigation";

describe("new PG connection defaults to single-database (not multi-db)", () => {
  it("shows the Database field (not multi-db) by default, and opts in via the checkbox", async () => {
    await waitForApp();

    // Navigate to the Connections page if not already there.
    const addBtn = await $('button=Add Connection');
    const onConnectionsPage = await addBtn.isExisting().catch(() => false);
    if (!onConnectionsPage) {
      const connLink = await $('a[aria-label="Connections"]');
      if (await connLink.isExisting().catch(() => false)) {
        await connLink.click();
        await browser.pause(1000);
      }
    }

    // 1. Open the catalogue and pick the PostgreSQL plugin card.
    await clickAddConnection();
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
    await browser.pause(3000);

    // 2. Assert: the "Database Name" label is visible (single-DB field shown).
    // Use XPath to match the label element whose text is exactly "Database Name".
    const dbLabel = await $('//label[normalize-space()="Database Name"]');
    await dbLabel.waitForExist({ timeout: 10000 });
    expect(await dbLabel.isExisting()).toBe(true);

    // 3. Assert: the "Browse multiple databases" checkbox is visible and unchecked.
    const checkbox = await $('//label[contains(., "Browse multiple databases")]//input[@type="checkbox"]');
    await checkbox.waitForExist({ timeout: 10000 });
    expect(await checkbox.isSelected()).toBe(false);

    // 4. Assert: the "Databases" tab is NOT present (not opted in).
    const dbTab = await $('button=Databases');
    expect(await dbTab.isExisting().catch(() => false)).toBe(false);

    // 5. Check the opt-in checkbox.
    await checkbox.click();
    await browser.pause(1000);

    // 6. Assert: the "Database Name" field is now hidden (opted in).
    const dbLabelAfter = await $('//label[normalize-space()="Database Name"]');
    expect(await dbLabelAfter.isExisting().catch(() => false)).toBe(false);

    // 7. Assert: the "Databases" tab is now present.
    const dbTabAfter = await $('button=Databases');
    expect(await dbTabAfter.isExisting()).toBe(true);

    // Don't save — close the modal. No connection is created, so no cleanup.
    const closeBtn = await $('button[aria-label="Close"]');
    if (await closeBtn.isExisting().catch(() => false)) {
      await closeBtn.click();
    } else {
      // Some modal variants use an X icon button without aria-label.
      await browser.execute(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const close = btns.find(b => b.querySelector('svg.lucide-x'));
        close?.click();
      });
    }
  });
});
