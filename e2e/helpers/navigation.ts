// Shared UI-navigation helpers for E2E specs. Selectors are grounded in a
// verified audit of the real components (text / aria-label / title / CSS — the
// repo has ~no data-testid). See the plan's selector table.

// A Tauri app's webview already loaded the frontend from the devUrl/Vite
// server at launch — do NOT call browser.url(...).

/** Wait for the app root to render (app launched + window ready). */
export async function waitForApp(): Promise<void> {
  const root = await $("#root");
  await root.waitForExist({ timeout: 30000 });
}

// --- Sidebar tree navigation ----------------------------------------------

// Tree nodes render as div[role="button"] with the name in a <span>. The
// nested Postgres tree: database node > schema node > table/view/trigger nodes.

/** Expand a tree node by clicking its span text. */
export async function expandNode(name: string): Promise<void> {
  const node = await $(`//span[contains(@class, "truncate") and normalize-space()='${name}']`);
  await node.waitForExist({ timeout: 15000 });
  await node.click();
  await browser.pause(800);
}

/** Select a schema in the nested tree and confirm loading. The schema list
 * shows button[aria-pressed] entries; clicking toggles selection. After
 * selecting, a "Confirm" button (initially disabled) becomes enabled — click
 * it to load the schema's tables into the tree. */
export async function expandSchemaUnderDb(schema: string, database: string): Promise<void> {
  // Click the schema's selection button (scoped to the database's section).
  const schemaBtn = await $(
    `//span[contains(@class, "truncate") and normalize-space()='${database}']` +
    `/ancestor::div[@role="button"][1]` +
    `/following-sibling::*//button[@aria-pressed]//span[normalize-space()='${schema}']/ancestor::button[1]`
  );
  await schemaBtn.waitForExist({ timeout: 15000 });
  await schemaBtn.click();
  await browser.pause(500);

  // Click the "Confirm" button (was disabled, now enabled after selecting a schema).
  const confirmBtn = await $('button=Confirm');
  await confirmBtn.waitForExist({ timeout: 10000 });
  await confirmBtn.waitForEnabled({ timeout: 10000 });
  await confirmBtn.click();
  await browser.pause(2000); // wait for tables to load into the tree
}

/** Double-click a table in the nested tree to open it in a tab. The tree must
 * be expanded down to the table's schema first. */
export async function openTable(
  tableName: string,
  schema?: string,
  database?: string,
): Promise<void> {
  if (database) {
    await expandNode(database);
  }
  if (schema && database) {
    await expandSchemaUnderDb(schema, database);
  } else if (schema) {
    await expandNode(schema);
  }
  // The table node is a span with class "truncate" containing the table name.
  // Use XPath for findElements; for the double-click, use browser.execute()
  // to dispatch a dblclick event (tauri-wd's doubleClick via the actions
  // endpoint doesn't support XPath selectors — only CSS).
  const tableNode = await $(`//span[contains(@class, "truncate") and normalize-space()='${tableName}']`);
  await tableNode.waitForExist({ timeout: 15000 });
  // Dispatch a dblclick event on the table node directly.
  await browser.execute((xpath: string) => {
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const el = result.singleNodeValue as HTMLElement;
    if (el) {
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    }
  }, `//span[contains(@class, "truncate") and normalize-space()='${tableName}']`);
}

/** Click the "New Console" action button on a schema node (opens a SQL tab).
 * Requires the database to be expanded and the schema loaded first. */
export async function openNewConsole(
  database?: string,
  schema?: string,
): Promise<void> {
  // Expand the database and load the schema (same as openTable's first steps).
  if (database) {
    await expandNode(database);
    if (schema) {
      await expandSchemaUnderDb(schema, database);
    }
  }
  // The "New Console" button appears on the loaded schema row.
  const btn = await $('button[aria-label="New Console"]');
  await btn.waitForExist({ timeout: 15000 });
  await btn.click();
}

// --- Connection modal ------------------------------------------------------

/** Click the primary "Add Connection" affordance on the Connections page. */
export async function clickAddConnection(): Promise<void> {
  const btn = await $('button=Add Connection');
  await btn.waitForExist({ timeout: 30000 });
  await btn.click();
}

/** Click the modal Save button. */
export async function clickSaveConnection(): Promise<void> {
  const btn = await $('button=Save');
  await btn.waitForExist({ timeout: 10000 });
  await btn.click();
}

/** Click the "Connect" button on a connection card (the Power icon). */
export async function connectConnection(): Promise<void> {
  const btn = await $('button[title="Connect"]');
  await btn.waitForExist({ timeout: 10000 });
  await btn.click();
}

/** Click the "Disconnect" button (same Power icon, shown when connected). */
export async function disconnectConnection(): Promise<void> {
  const btn = await $('button[title="Disconnect"]');
  await btn.waitForExist({ timeout: 10000 });
  await btn.click();
}

/** Click the "Edit" button on a connection card. */
export async function clickEditConnection(): Promise<void> {
  const btn = await $('button[title="Edit"]');
  await btn.waitForExist({ timeout: 10000 });
  await btn.click();
}

/** Navigate to the Connections page via the nav link. */
export async function goToConnectionsPage(): Promise<void> {
  const link = await $('a[aria-label="Connections"]');
  if (await link.isExisting().catch(() => false)) {
    await link.click();
    await browser.pause(1500);
  }
}

// --- Connection creation (the keystone: unblocks all real-flow specs) -----
//
// Flow grounded in the verified component markup:
//  - Catalogue: EngineCard button with aria-label "Connect to {{name}}"
//    (PostgreSQL's displayName is "PostgreSQL").
//  - Form: FieldInput renders <label>uppercase text</label> + <input>; target
//    the input via XPath //label[normalize-space()='X']/following::input[1].
//  - Databases: a tab labeled "Databases" (i18n newConnection.selectDatabases),
//    a "Choose databases" toggle, then a list of button[aria-pressed] entries.

/** Set a React controlled input's value + dispatch native input/change events
 * so React's onChange fires (WebDriverIO's setValue/keys alone don't trigger
 * React's synthetic event in WKWebView). */
async function reactSetValue(selector: string, value: string): Promise<void> {
  await browser.execute((sel: string, val: string) => {
    const el = document.querySelector(sel) as HTMLInputElement;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value",
    )?.set;
    setter?.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector, value);
}

/**
 * Create a Postgres multi-database connection selecting the two seeded
 * databases (testdb + tabularis_test_secondary) and wait for the sidebar tree
 * to render. Must be called after waitForApp() (Connections page visible).
 *
 * Key verified details:
 *  - The catalogue has TWO "Connect to PostgreSQL" cards: [0] = builtin
 *    (Deprecated), [1] = plugin (Relational, installed). Pick [1] — the
 *    plugin supports list_databases for the multi-db nested feature.
 *  - React controlled inputs need native input event dispatch (setValue alone
 *    doesn't trigger React's onChange in WKWebView).
 *  - The database list is empty until "Load Databases" is clicked (fires
 *    list_databases invoke against the filled credentials).
 */
export async function openMultiDbConnection(
  databases: string[] = ["testdb", "tabularis_test_secondary"],
): Promise<void> {
  // If a connection already exists (from a prior spec), the app opens to the
  // editor view, not the Connections page. Navigate to Connections first.
  const addBtn = await $('button=Add Connection');
  const onConnectionsPage = await addBtn.isExisting().catch(() => false);
  if (!onConnectionsPage) {
    // Click the Connections nav link to go back to the Connections page.
    const connLink = await $('a[aria-label="Connections"]');
    if (await connLink.isExisting().catch(() => false)) {
      await connLink.click();
      await browser.pause(1000);
    }
  }

  // 1. Open the catalogue.
  await clickAddConnection();

  // 2. Pick the PostgreSQL card. Locally there are two (builtin "Deprecated" at
  // [0] and plugin "Relational" at [1]); in CI the plugin may not be installed
  // (only the builtin at [0]). Pick the non-deprecated one, or the only one.
  await browser.waitUntil(
    async () => (await $$('button[aria-label="Connect to PostgreSQL"]')).length > 0,
    { timeout: 20000, timeoutMsg: "PostgreSQL catalogue card never rendered" },
  );
  const pgCards = await $$('button[aria-label="Connect to PostgreSQL"]');
  // Pick the PLUGIN PostgreSQL card (not the builtin "Deprecated" one). The
  // plugin supports list_databases for the multi-db nested feature. Both cards
  // exist in CI (builtin "postgres" + plugin "postgresql"). Use WDIO's
  // element.click() which reliably triggers React's onClick.
  let targetIndex = 0;
  if (pgCards.length > 1) {
    // The plugin card is the one NOT containing "Deprecated" text.
    const isDeprecated = await browser.execute(() =>
      Array.from(document.querySelectorAll('button[aria-label="Connect to PostgreSQL"]'))
        .map(c => c.textContent?.includes("Deprecated") ?? false)
    );
    const idx = isDeprecated.findIndex((d: boolean) => !d);
    targetIndex = idx >= 0 ? idx : 0;
  }
  await pgCards[targetIndex].click();
  await browser.pause(2000); // wait for the form to render

  // 3. Fill the form via native input event dispatch (React controlled inputs).
  const nameSel = 'input[placeholder="Provide your connection name"]';
  await $(nameSel).waitForExist({ timeout: 10000 });
  await reactSetValue(nameSel, "e2e-multi-db");
  await reactSetValue('input[placeholder="localhost"]', "127.0.0.1");
  await reactSetValue('input[type="number"]', "54320");
  await reactSetValue('input[placeholder="Enter username"]', "postgres");
  await reactSetValue('input[type="password"]', "password");
  await browser.pause(500);

  // 4. Opt into multi-database mode via the "Browse multiple databases"
  // checkbox (PR #822 fix 2: a new PG connection defaults to single-database,
  // so the Databases tab is hidden until the user checks this checkbox).
  const optInCheckbox = await $('//label[contains(., "Browse multiple databases")]//input[@type="checkbox"]');
  await optInCheckbox.waitForExist({ timeout: 10000 });
  await optInCheckbox.click();
  await browser.pause(500);

  // 5. Open the Databases tab and switch to "Choose databases" mode.
  const dbTab = await $('button=Databases');
  await dbTab.waitForExist({ timeout: 10000 });
  await dbTab.click();

  const chooseToggle = await $('button=Choose databases');
  await chooseToggle.waitForExist({ timeout: 10000 });
  await chooseToggle.click();

  // 5. Click "Load Databases" to fetch the database list via list_databases.
  const loadBtn = await $('button=Load Databases');
  await loadBtn.waitForExist({ timeout: 10000 });
  await loadBtn.click();

  // 6. Wait for the aria-pressed database buttons to render, then select
  // testdb + tabularis_test_secondary. Use $$ (there are 3 databases, so
  // strict-mode $ would error with "resolved to 3 elements").
  await browser.waitUntil(
    async () => (await $$('button[aria-pressed]')).length > 0,
    { timeout: 20000, timeoutMsg: "database list never rendered after Load Databases" },
  );

  for (const dbName of databases) {
    const specific = await $(`//button[@aria-pressed]//span[normalize-space()='${dbName}']/..`);
    await specific.waitForExist({ timeout: 10000 });
    await specific.click();
  }

  // 7. Save. The app returns to the Connections page showing the new
  // connection as a <div> card (not a button) with the name + driver + host.
  await clickSaveConnection();

  // 8. Click the "Connect" button on the connection card's footer row. The
  // card's ActionButtons render a button[title="Connect"] (a Power icon) that
  // triggers onConnect -> handleConnect. (The card also connects on
  // double-click, but tauri-wd's doubleClick via the actions endpoint doesn't
  // support XPath selectors — the Connect button is more reliable.)
  const connectBtn = await $('button[title="Connect"]');
  await connectBtn.waitForExist({ timeout: 15000 });
  await connectBtn.click();

  // 9. Wait for the nested sidebar tree to render. After connecting, the tree
  // shows database nodes — a span with class "text-sm font-medium" containing
  // the first selected database name. Use XPath (WebDriverIO's =text syntax
  // doesn't work with multi-class CSS selectors in tauri-wd).
  const firstDb = databases[0] || "testdb";
  const treeDb = await $(`//span[contains(@class, "font-medium") and normalize-space()='${firstDb}']`);
  await treeDb.waitForExist({ timeout: 30000 });
}

// --- Editor / DataGrid -----------------------------------------------------

/** Click the "Submit Changes" button to commit pending row edits. */
export async function clickSubmitChanges(): Promise<void> {
  const btn = await $('button[title="Submit Changes"]');
  await btn.waitForExist({ timeout: 10000 });
  await btn.click();
}

/** The Monaco SQL editor input. */
export async function getMonacoEditor(): Promise<WebdriverIO.ElementArray[number]> {
  const ta = await $(".monaco-editor textarea");
  await ta.waitForExist({ timeout: 15000 });
  return ta;
}

/** The Monaco autocomplete suggestion widget rows. */
export async function getAutocompleteSuggestions(): Promise<WebdriverIO.ElementArray> {
  return await $$(".suggest-widget .monaco-list-row");
}
