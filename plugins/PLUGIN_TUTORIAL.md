# Your first Tabularis driver in 20 minutes

This tutorial walks you from an empty directory to a working **Google Sheets** database driver installed in your local Tabularis. You'll use `@tabularis/create-plugin` to scaffold the project, wire a handful of JSON-RPC handlers to the Google Sheets REST API, and drop two small UI extensions into the plugin folder.

Target reader: you've written Rust before (any level) and React/JS at least once. You have never touched Tabularis internals.

Target time: **20 minutes**, give or take. Get coffee first.

> For the complete reference — every RPC method, every capability flag, every UI slot — read [`PLUGIN_GUIDE.md`](./PLUGIN_GUIDE.md) after this tutorial. This document gets you moving; the guide answers everything else.

---

## 0. Prerequisites (1 minute)

- **Node 18.17+** (for `create-plugin`). `node --version`
- **Rust stable** (for the plugin binary). `rustc --version`
- **A text editor** (any).
- A **Google account** with at least one spreadsheet you can read.

That's it. No `just`, no `pnpm` — we'll use plain `cargo` and `cp`.

---

## 1. Scaffold (2 minutes)

```bash
npm create @tabularis/plugin@latest -- \
  --db-type=api \
  --dir ~/Progetti/google-sheets \
  google-sheets
```

What the flags mean:

| Flag | Why |
|------|-----|
| `--db-type=api` | Google Sheets is a REST API, not a network DB. Sets `no_connection_required: true` in the manifest. |
| `--dir <path>` | Scaffold somewhere outside this tutorial's reading order. |
| `google-sheets` | The plugin id. Used for the crate name, binary name, manifest `id`, and the install directory. |

Expected output:

```
✓ Created google-sheets at /home/you/Progetti/google-sheets

Next steps:

  cd google-sheets
  just dev-install     # build + copy into Tabularis plugins dir
  ...
```

What you got:

```
google-sheets/
├── Cargo.toml
├── manifest.json          ← plugin metadata (id, capabilities, UI extensions…)
├── justfile               ← build / install / test recipes
├── README.md
├── rust-toolchain.toml
├── .github/workflows/release.yml   ← 5-platform matrix for `v*` tags
└── src/
    ├── main.rs            ← stdin/stdout JSON-RPC loop
    ├── rpc.rs             ← method dispatch → handlers/
    ├── client.rs          ← scaffold placeholder (delete when you don't need it)
    ├── error.rs           ← scaffold placeholder (idem)
    ├── models.rs          ← scaffold placeholder (idem)
    ├── handlers/{mod,metadata,query,crud,ddl}.rs
    ├── utils/{mod,identifiers,pagination}.rs
    └── bin/test_plugin.rs
```

Every handler returns a **valid-but-empty response** or `-32601 method not implemented`. That means:

- The plugin compiles and runs from the start.
- `test_connection` returns `{ "success": true }`, so the driver shows up in Tabularis' connection picker immediately.
- You fill in handlers in priority order — metadata first (the driver looks alive), then query, then CRUD, then DDL.

Verify:

```bash
cd ~/Progetti/google-sheets
cargo check
```

Should print `Finished` in a few seconds. If it doesn't, stop and open an issue — the scaffold is supposed to be green on first build.

---

## 2. Declare the driver (3 minutes)

Edit `manifest.json`. The scaffold gives you this:

```json
{
  "$schema": "https://tabularis.dev/schemas/plugin-manifest.json",
  "id": "google-sheets",
  "name": "Google Sheets",
  "capabilities": {
    "schemas": false, "views": false, "routines": false,
    "file_based": false, "folder_based": false,
    "no_connection_required": true,
    "identifier_quote": "\"",
    ...
  },
  "data_types": [{"name":"INTEGER",...}, {"name":"TEXT",...}]
}
```

You need to add two things:

### 2a. Settings (OAuth)

Add a `"settings"` array with the five OAuth fields the plugin persists:

```json
"settings": [
  { "key": "client_id",     "label": "OAuth Client ID",     "type": "string", "required": false,
    "description": "Auto-managed by the OAuth flow." },
  { "key": "client_secret", "label": "OAuth Client Secret", "type": "string", "required": false,
    "description": "Auto-managed by the OAuth flow." },
  { "key": "access_token",  "label": "Access Token",        "type": "string", "required": false },
  { "key": "refresh_token", "label": "Refresh Token",       "type": "string", "required": false },
  { "key": "token_expiry",  "label": "Token Expiry",        "type": "number", "required": false }
]
```

These fields appear in Settings → Plugins → Google Sheets, but the user will never touch them directly — the OAuth wizard (step 6) writes them for you.

### 2b. UI extensions

Declare two slots. The `module` paths point to the built IIFE bundles Vite will produce in step 6:

```json
"ui_extensions": [
  { "slot": "settings.plugin.before_settings", "module": "ui/dist/google-auth.js", "order": 10 },
  { "slot": "connection-modal.connection_content", "module": "ui/dist/google-sheets-db-field.js",
    "order": 10, "driver": "google-sheets" }
]
```

- `settings.plugin.before_settings` mounts a component above the settings form — we'll use it for the OAuth wizard.
- `connection-modal.connection_content` replaces the default host/port/user/pass form in the "new connection" modal — we need this because Google Sheets connections have no host/port; just a spreadsheet id.

### 2c. Data types

Replace the default with the three types Sheets actually uses:

```json
"data_types": [
  { "name": "TEXT",    "category": "string",  "requires_length": false, "requires_precision": false },
  { "name": "INTEGER", "category": "numeric", "requires_length": false, "requires_precision": false },
  { "name": "REAL",    "category": "numeric", "requires_length": false, "requires_precision": false }
]
```

**Checkpoint:** `cargo check` still passes — `manifest.json` isn't touched by rustc.

---

## 3. Talk to Google (4 minutes)

Add the crates you need to `Cargo.toml`:

```toml
[dependencies]
anyhow = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["blocking", "json"] }
regex = "1"
```

Create three new files in `src/`:

### `src/auth.rs`

Holds the OAuth state (client id/secret, access + refresh tokens) in a module-level `Mutex`. Exposes `access_token(client) -> Result<String>` that silently refreshes if the saved token is expired. The initialize RPC (step 5) pushes the saved settings in here.

### `src/sheets.rs`

Thin wrapper around the Google Sheets REST API:

```rust
pub fn get_sheet_names(spreadsheet_id: &str) -> Result<Vec<String>>
pub fn get_sheet_id(spreadsheet_id: &str, sheet_name: &str) -> Result<i64>
pub fn get_sheet_data(spreadsheet_id: &str, sheet_name: &str)
    -> Result<(Vec<String>, Vec<Vec<Value>>)>   // (headers, rows)
pub fn append_row(spreadsheet_id: &str, sheet_name: &str, row: Vec<String>) -> Result<()>
pub fn update_cell(spreadsheet_id: &str, sheet_name: &str, col_letter: &str, row: usize, value: &str) -> Result<()>
pub fn delete_row(spreadsheet_id: &str, sheet_id: i64, row: usize) -> Result<()>
pub fn extract_spreadsheet_id(raw: &str) -> &str   // accepts full URL or bare id
pub fn infer_type(values: &[Value]) -> &'static str  // "TEXT" | "INTEGER" | "REAL"
```

All functions go through `auth::access_token()` to get a Bearer token. No service accounts, just OAuth2.

### `src/sql.rs`

A tiny regex-based parser for the subset of SQL the driver needs:

```rust
pub enum Query { Select(SelectQuery), Insert(...), Update(...), Delete(...) }
pub fn parse(raw: &str) -> Result<Query>
pub fn eval_where(where_clause: &str, row: &HashMap<String, String>) -> bool
pub fn extract_row_num(where_clause: &str) -> Result<usize>   // for UPDATE/DELETE "WHERE _row = N"
```

> **Don't write a SQL parser from scratch.** Copy this file from the [reference implementation in the tutorial companion repo](https://github.com/TabularisDB/tabularis-google-sheets-plugin) — it's ~300 lines of regex and supports `SELECT`, `INSERT`, `UPDATE WHERE _row = N`, `DELETE WHERE _row = N`, `COUNT(*)`, basic `WHERE` with `AND`/`LIKE`/`=`/`>`/etc. Good enough for Sheets; nowhere near good enough for real SQL.

Then register all three modules in `src/main.rs`:

```rust
mod auth;
mod client;
mod error;
mod handlers;
mod models;
mod rpc;
mod sheets;
mod sql;
mod utils;
```

**Checkpoint:** `cargo check` compiles clean (plus a few warnings about unused scaffold leftovers — fine, we'll handle them at the end).

---

## 4. Wire metadata (4 minutes)

Open `src/handlers/metadata.rs`. The scaffold has every method returning an empty list. Three of them need real data.

### `get_databases`

One "database" per connection — the spreadsheet id from the connection form:

```rust
pub fn get_databases(id: Value, params: &Value) -> Value {
    match spreadsheet_id(&id, params) {
        Ok(sid) => ok_response(id, json!([sid])),
        Err(resp) => resp,
    }
}
```

`spreadsheet_id` is a small helper in `src/handlers/mod.rs` that reads `params.params.database`, strips the URL wrapper if any, and returns a ready-made error response if the field is empty. See the repo for the exact code.

### `get_tables`

Each sheet tab becomes a table:

```rust
pub fn get_tables(id: Value, params: &Value) -> Value {
    let sid = match spreadsheet_id(&id, params) {
        Ok(s) => s, Err(resp) => return resp,
    };
    match get_sheet_names(&sid) {
        Ok(names) => {
            let tables: Vec<Value> = names.into_iter()
                .map(|n| json!({ "name": n, "schema": null, "comment": null }))
                .collect();
            ok_response(id, json!(tables))
        }
        Err(e) => error_response(id, -32000, &e.to_string()),
    }
}
```

### `get_columns`

Read the first row as headers, sample up to 100 data rows, infer each column's type:

```rust
pub fn get_columns(id: Value, params: &Value) -> Value {
    let table = params.get("table").and_then(Value::as_str).unwrap_or("").to_string();
    let sid = match spreadsheet_id(&id, params) {
        Ok(s) => s, Err(resp) => return resp,
    };
    match get_sheet_data(&sid, &table) {
        Ok((headers, rows)) => {
            let sample: Vec<Vec<Value>> = rows.iter().take(100).cloned().collect();
            ok_response(id, build_columns(&headers, &sample))
        }
        Err(e) => error_response(id, -32000, &e.to_string()),
    }
}
```

`build_columns` prepends a synthetic `_row` primary-key column (the Sheets API indexes rows by position — this gives us something to `WHERE` on for UPDATE/DELETE) and then one entry per header with type inferred by `sheets::infer_type`.

Also fill `get_schema_snapshot` (used for the ER diagram) and `get_all_columns_batch` (used at connection load) — they follow the same pattern. Leave everything else (`get_foreign_keys`, `get_indexes`, `get_views`, routines) returning empty lists. Sheets has no such concepts.

**Checkpoint:** `cargo check`. Metadata handlers compile. You're about halfway through.

---

## 5. `initialize` and query execution (4 minutes)

### 5a. `initialize` → push settings into auth state

The scaffold's `rpc.rs` answers `initialize` with `Value::Null`. We need to capture the OAuth tokens the host sends in `params.settings` and store them in the `auth` module.

Create `src/handlers/init.rs`:

```rust
pub fn initialize(id: Value, params: &Value) -> Value {
    let settings = params.get("settings").cloned().unwrap_or(Value::Null);
    let mut state = auth().lock().unwrap();
    *state = AuthState::default();
    state.oauth_client_id     = string_setting(&settings, "client_id");
    state.oauth_client_secret = string_setting(&settings, "client_secret");
    state.oauth_refresh_token = string_setting(&settings, "refresh_token");
    state.oauth_access_token  = string_setting(&settings, "access_token");
    state.oauth_token_expiry  = settings.get("token_expiry").and_then(Value::as_u64);
    ok_response(id, Value::Null)
}
```

Register it in `src/handlers/mod.rs` (`pub mod init;`) and in `src/rpc.rs`:

```rust
"initialize" => handlers::init::initialize(id, &params),
```

### 5b. `test_connection` → real ping

Open `src/handlers/query.rs`. Replace the scaffold's hard-coded `{ "success": true }` with a real call:

```rust
pub fn test_connection(id: Value, params: &Value) -> Value {
    let sid = match spreadsheet_id(&id, params) {
        Ok(s) => s, Err(resp) => return resp,
    };
    match get_sheet_names(&sid) {
        Ok(_) => ok_response(id, json!({ "success": true })),
        Err(e) => error_response(id, -32000, &e.to_string()),
    }
}
```

Now "test connection" in the UI actually validates the token.

### 5c. `execute_query` → parse + fetch + filter

The interesting handler. Parse the incoming SQL, fetch the sheet, apply the WHERE / projection / pagination, return a `QueryResult`:

```rust
pub fn execute_query(id: Value, params: &Value) -> Value {
    let query = params.get("query").and_then(Value::as_str).unwrap_or("").trim();
    let sid = match spreadsheet_id(&id, params) { Ok(s) => s, Err(resp) => return resp };
    let parsed = match parse(query) {
        Ok(q) => q, Err(e) => return error_response(id, -32000, &e.to_string()),
    };
    match parsed {
        Query::Select(sel) => run_select(id, &sid, sel, ...),
        Query::Insert(ins) => { /* fetch headers, build row in column order, append_row */ }
        Query::Update(upd) => { /* extract _row from WHERE, update_cell per SET entry */ }
        Query::Delete(del) => { /* extract _row from WHERE, delete_row */ }
    }
}
```

The full implementation (including `run_select` with pagination) lives in [the companion repo](https://github.com/TabularisDB/tabularis-google-sheets-plugin/blob/main/src/handlers/query.rs). ~200 lines. Copy it.

Also replace the CRUD (`handlers/crud.rs`) and the `get_create_table_sql` (`handlers/ddl.rs`) stubs with real implementations — all of them route through `sheets::*` helpers. Every other DDL method (`drop_index`, `get_create_foreign_key_sql`, etc.) stays as an explicit `-32601` error: Sheets has no such thing, say so clearly.

**Checkpoint:**

```bash
cargo build --release
```

Should finish in 30–60 seconds. The binary lives at `target/release/google-sheets-plugin`.

---

## 6. The UI extensions (4 minutes)

Tabularis' plugin system loads UI contributions as **IIFE bundles** — single-file JavaScript that assigns a React component to `__tabularis_plugin__`. The scaffold's `--with-ui` flag gave you one bundle targeting `data-grid.toolbar.actions` via [`@tabularis/plugin-api`](https://www.npmjs.com/package/@tabularis/plugin-api). We need two different slots, so we'll replace that single entry with two TSX files and configure Vite to build both.

### 6a. Workspace layout

```
ui/
├── package.json                # depends on @tabularis/plugin-api + react + vite
├── tsconfig.json               # strict; jsx: react-jsx
├── vite.auth.config.ts         # one config per bundle
├── vite.db-field.config.ts
└── src/
    ├── google-auth.tsx
    ├── google-sheets-db-field.tsx
    └── styles.ts               # shared inline styles
```

`package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "pnpm run build:auth && pnpm run build:db-field",
    "build:auth": "vite build --config vite.auth.config.ts",
    "build:db-field": "vite build --config vite.db-field.config.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@tabularis/plugin-api": "^0.1.0" },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "~5.9.3",
    "vite": "^7.1.0"
  }
}
```

Both Vite configs are almost identical — they differ only in `entry` and `fileName`:

```ts
// vite.auth.config.ts
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: false,         // two builds share the same out dir
    lib: {
      entry: "src/google-auth.tsx",
      formats: ["iife"],
      name: "__tabularis_plugin__",
      fileName: () => "google-auth.js",
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "@tabularis/plugin-api"],
      output: {
        globals: {
          react: "React",
          "react/jsx-runtime": "ReactJSXRuntime",
          "@tabularis/plugin-api": "__TABULARIS_API__",
        },
      },
    },
  },
});
```

The externals + globals map is the whole trick: React, the JSX runtime, and the plugin-api are injected by the Tabularis host at load time — the bundle never ships them.

### 6b. `src/google-sheets-db-field.tsx` — custom connection field

Slot: `connection-modal.connection_content`. Replaces the default host/port/user/pass form with a single "Spreadsheet ID or URL" input when the active driver is `google-sheets`. Uses `defineSlot` for typed context:

```tsx
import { defineSlot } from "@tabularis/plugin-api";
import type { TypedSlotProps } from "@tabularis/plugin-api";
import { PLUGIN_ID } from "./styles";

// plugin-api v0.1.0 only declares `{ driver: string }` for this slot, but the
// host also passes `database` and `onDatabaseChange`. Augment locally.
type FieldContext = TypedSlotProps<"connection-modal.connection_content">["context"]
  & { database?: string; onDatabaseChange?: (value: string) => void };

const GoogleSheetsDatabaseField = defineSlot(
  "connection-modal.connection_content",
  ({ context }) => {
    const c = context as FieldContext;
    if (c.driver !== PLUGIN_ID) return null;
    const value = typeof c.database === "string" ? c.database : "";
    const onChange = c.onDatabaseChange ?? (() => {});
    return (
      <div>
        <label>Spreadsheet ID or URL</label>
        <input type="text" value={value}
               onChange={e => onChange(e.target.value)}
               placeholder="https://docs.google.com/spreadsheets/d/… or id" />
      </div>
    );
  },
);
export default GoogleSheetsDatabaseField.component;
```

The `as FieldContext` cast is a rough edge: `plugin-api@0.1.0` types the slot context too loosely. The host runtime provides more fields than are typed. Future versions of plugin-api should tighten this.

### 6c. `src/google-auth.tsx` — OAuth wizard

Slot: `settings.plugin.before_settings`. A two-step modal wizard using three hooks from plugin-api:

- `usePluginSetting(PLUGIN_ID)` — typed `getSetting` / `setSetting` / `setSettings` for the five settings declared in step 2a.
- `usePluginModal()` — host-managed modal for the two-step flow (credentials → paste redirect URL).
- `openUrl(url)` — launches the Google consent URL in the **system browser**. Critical: `window.open` doesn't open external URLs inside a Tauri webview; `openUrl` routes through `@tauri-apps/plugin-opener`.

The slot component:

```tsx
const GoogleSheetsOAuth = defineSlot(
  "settings.plugin.before_settings",
  ({ context }) => {
    if (context.targetPluginId !== PLUGIN_ID) return null;   // typed as string, not optional
    const { getSetting, setSetting, setSettings } = usePluginSetting(PLUGIN_ID);
    const { openModal, closeModal } = usePluginModal();

    const isConnected = !!(getSetting("refresh_token") || getSetting("access_token"));

    function handleOpenOAuth() {
      openModal({
        title: "Connect Google Account",
        size: "md",
        content: <OAuthWizard
          getSetting={getSetting}
          setSetting={setSetting}
          setSettings={setSettings}
          onClose={closeModal}
        />,
      });
    }

    return /* ...connected/disconnected panel... */;
  },
);
export default GoogleSheetsOAuth.component;
```

Inside `OAuthWizard`, `openUrl(buildAuthUrl(clientId))` opens the consent page; `fetch(TOKEN_URL, ...)` exchanges the code; `setSettings({access_token, refresh_token, token_expiry})` persists the tokens — the Rust side reads them on the next `initialize`.

~330 lines with the full wizard UI and styling. Copy from [`ui/src/google-auth.tsx`](https://github.com/TabularisDB/tabularis-google-sheets-plugin/blob/main/ui/src/google-auth.tsx) in the companion repo.

### 6d. Build

```bash
cd ui
pnpm install
pnpm run typecheck   # strict mode: catches slot context mismatches early
pnpm run build       # produces dist/google-auth.js + dist/google-sheets-db-field.js
```

Both bundles end up in `ui/dist/`. The manifest's `ui_extensions` already points at `ui/dist/google-auth.js` and `ui/dist/google-sheets-db-field.js` (step 2b), so the install step picks them up automatically.

---

## 7. Install and test (2 minutes)

With `just` (if installed) — the `dev-install` recipe builds the Rust binary **and** runs `pnpm --dir ui build`, then copies both into place:

```bash
just dev-install
```

Without `just` (minimal):

```bash
# 1. Build the Rust binary
cargo build --release

# 2. Build the UI bundles
pnpm --dir ui install
pnpm --dir ui build

# 3. Copy everything into the plugins folder
PLUGIN_DIR="$HOME/.local/share/tabularis/plugins/google-sheets"
mkdir -p "$PLUGIN_DIR/ui/dist"
cp target/release/google-sheets-plugin "$PLUGIN_DIR/"
cp manifest.json "$PLUGIN_DIR/"
cp ui/dist/*.js "$PLUGIN_DIR/ui/dist/"
chmod +x "$PLUGIN_DIR/google-sheets-plugin"
```

(macOS: `~/Library/Application Support/com.debba.tabularis/plugins/google-sheets/`.
Windows: `%APPDATA%\com.debba.tabularis\plugins\google-sheets\`.)

Now:

1. Start Tabularis (or, if it was running, toggle the plugin in **Settings → Plugins**).
2. Go to **Settings → Plugins**, find "Google Sheets", click the gear icon.
3. In the wizard, paste your Google OAuth Client ID + Secret, click **Open Authorization Page →**.
4. Grant access in the browser, copy the redirect URL, paste it back, click **Save Token**.
5. Open **New Connection**, pick **Google Sheets** from the driver list. A single "Spreadsheet ID or URL" field appears — paste a spreadsheet URL.
6. **Connect**. The sidebar lists every tab as a table. Click one: row 1 becomes the column header, rows 2..N the data. Try `SELECT * FROM "Sheet1" LIMIT 5`.

That's it.

---

## Where next

- **[`PLUGIN_GUIDE.md`](./PLUGIN_GUIDE.md)** — full protocol reference. Every RPC method, every capability flag, every slot context type.
- **[`@tabularis/plugin-api` docs](https://www.npmjs.com/package/@tabularis/plugin-api)** — if you want to build the UI side with typed hooks instead of hand-written IIFE.
- **[Companion repo](https://github.com/TabularisDB/tabularis-google-sheets-plugin)** — the full working plugin from this tutorial, ready to clone.
- **[Other community plugins](./registry.json)** — HackerNews, DuckDB, Reddit, a CSV-folder Python plugin, and more. Each one is a different shape worth copying from.

## What this tutorial didn't cover

Ruthlessly cut for the 20-minute budget:

- **Release packaging** — the scaffold ships `.github/workflows/release.yml` with a 5-platform matrix. Tag `v0.1.0`, push, collect artifacts. Not reading-order critical.
- **CRUD via the row editor UI** — covered in the implementation but not explained. Enable by filling in `handlers/crud.rs` (done in step 5) and setting `capabilities.readonly: false` (we did). Once you can edit rows, look at the `row-editor-sidebar.field.after` slot for per-field UI extensions.
- **DDL generation for the SQL preview** — `get_create_table_sql` is the only one you can implement meaningfully for Sheets. The rest are explicit `-32601` with a clear message.
- **Typed UI via `@tabularis/plugin-api`** — the scaffold's `--with-ui` mode sets this up with a hello-world button in `data-grid.toolbar.actions`. Worth trying when your second plugin doesn't need two slots.
- **Schema parsing for complex SQL** — the mini-parser in `sql.rs` handles flat SELECT/INSERT/UPDATE/DELETE. Anything with joins, subqueries, or CTEs will error out. Add a real parser (e.g. [`sqlparser`](https://crates.io/crates/sqlparser)) when you care.

Each of these is worth a few hours the first time. None of them block shipping v0.1.0.
