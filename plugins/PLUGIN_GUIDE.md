# Writing a Custom Database Driver Plugin for Tabularis

> **New to plugins?** Start with [`PLUGIN_TUTORIAL.md`](./PLUGIN_TUTORIAL.md) — a 20-minute walkthrough that ends with a working Google Sheets driver. This document is a **reference**, not a tutorial.
>
> 📚 The canonical, browsable version of the plugin docs lives at [tabularis.dev/wiki/plugins](https://tabularis.dev/wiki/plugins).

Tabularis supports extending its capabilities via a JSON-RPC based external plugin system. By building a standalone executable that implements the JSON-RPC interface, you can add support for virtually any SQL or NoSQL database (such as DuckDB, MongoDB, etc.) using the programming language of your choice.

This guide details how to implement and register a custom external plugin.

---

## 1. Plugin Architecture

An external plugin in Tabularis is a separate executable (binary or script) that runs alongside the main application. Tabularis communicates with the plugin using **JSON-RPC 2.0** over standard input/output (`stdin` / `stdout`).

- **Requests:** Tabularis writes JSON-RPC request objects to the plugin's `stdin`, separated by a newline (`\n`).
- **Responses:** The plugin processes the request and writes a JSON-RPC response object to its `stdout`, followed by a newline (`\n`).
- **Logging:** Any output to `stderr` from the plugin is inherited/logged by Tabularis without interfering with the JSON-RPC communication.

### Lifecycle

1. Tabularis discovers plugins in its data folder at startup:
   - **Linux:** `~/.local/share/tabularis/plugins/`
   - **macOS:** `~/Library/Application Support/tabularis/plugins/`
   - **Windows:** `%APPDATA%\tabularis\plugins\`
2. It reads each plugin's `.tabularium` manifest (or a legacy `manifest.json`) to discover its capabilities and data types.
3. The plugin is registered as a driver and appears in the "Database Type" list.
4. When the user opens a connection using the plugin's driver, Tabularis spawns the executable and begins sending JSON-RPC messages.
5. The same process instance is reused for all operations in that session.

---

## 2. Directory Structure & the Manifest (`.tabularium`)

A Tabularis plugin is distributed as a `.zip` file. When extracted into the plugins folder, it must have the following structure:

```text
plugins/
└── duckdb/
    ├── .tabularium  (or legacy manifest.json)
    └── duckdb-plugin  (or duckdb-plugin.exe on Windows)
```

### The `.tabularium` manifest

One manifest tells Tabularis everything about your plugin — and, when you publish, tells the Tabularium registry how to list it. Its canonical name is **`.tabularium`**; the host still reads a legacy `manifest.json` as a fallback. In a `.tabularium`, `name` is the lowercase slug that identifies the plugin (legacy manifests may keep a separate `id` and a display `name`). When publishing, the registry resolves the manifest from your **release assets** — upload `.tabularium` as a standalone asset (GitHub silently renames the dotfile to `default.tabularium`; the registry accepts both names).

> **JSON Schema available:** point `$schema` at the registry's live merged schema (as below) for IDE autocompletion and validation, or at the local [`plugins/manifest.schema.json`](./manifest.schema.json) for legacy `manifest.json` files.

```json
{
  "$schema": "https://registry.tabularis.dev/manifest.schema.json?kind=driver",
  "name": "duckdb",
  "version": "1.0.0",
  "description": "DuckDB file-based analytical database",
  "default_port": null,
  "executable": "duckdb-plugin",
  "capabilities": {
    "schemas": false,
    "views": true,
    "routines": false,
    "file_based": true,
    "connection_string": false,
    "identifier_quote": "\"",
    "alter_primary_key": false
  },
  "data_types": [
    {
      "name": "INTEGER",
      "category": "numeric",
      "requires_length": false,
      "requires_precision": false
    },
    {
      "name": "VARCHAR",
      "category": "string",
      "requires_length": true,
      "requires_precision": false
    }
  ]
}
```

### Manifest Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Lowercase slug identifying the plugin (e.g., `"duckdb"`). Must match the folder name and the registry pattern `^[a-z][a-z0-9-]*$`; it becomes the registry slug and is pinned at first submit. |
| `id` | string | Legacy identifier from `manifest.json`-era plugins. Optional — when absent, identity falls back to `name`. Omit in new `.tabularium` manifests; the registry ignores it. |
| `version` | string | Plugin version (semver, **no leading `v`**). Must equal the release tag with any `v` prefix stripped — the registry rejects tag/manifest mismatches. |
| `description` | string | Short description shown in the plugins list. Optional for the registry; max **280 chars**. |
| `default_port` | number \| null | Default TCP port. Use `null` for file-based databases. |
| `executable` | string | Relative path to the executable inside the plugin folder. |
| `capabilities` | object | Feature flags (see below). |
| `data_types` | array | List of supported data types (see below). |
| `type_mappings` | object \| null | Optional map of generic inferred type names to driver-specific types. Used during paste/import to map generic types (e.g. `DATETIME`) to driver-native equivalents (e.g. `TIMESTAMP`). See [Type Mappings](#type-mappings) below. |

### Capabilities

| Flag | Type | Description |
|------|------|-------------|
| `schemas` | bool | `true` if the database supports named schemas (like PostgreSQL). Controls whether the schema selector is shown in the UI. |
| `views` | bool | `true` if the database supports views. Enables the views section in the explorer. |
| `materialized_views` | bool | `true` if the database supports materialized views. Enables the materialized views section in the explorer (see [Materialized Views](#materialized-views)). Defaults to `false`. |
| `routines` | bool | `true` if the database supports stored procedures/functions. |
| `triggers` | bool | `true` if the database supports triggers. Enables trigger-related UI for drivers that implement the trigger RPCs. |
| `file_based` | bool | `true` for local file databases (e.g., SQLite, DuckDB). Replaces host/port with a file path input in the connection form. |
| `folder_based` | bool | `true` for plugins that connect to a directory rather than a single file (e.g. CSV plugin). Replaces host/port with a folder picker. |
| `no_connection_required` | bool | `true` for API-based plugins that need no host, port, or credentials (e.g. a public REST API). Hides the entire connection form — the user only fills in the connection name. |
| `connection_string` | bool | Set `false` to hide the connection string import UI for this driver. Defaults to `true` for network drivers. `file_based` and `folder_based` drivers skip the import UI automatically regardless of this flag. |
| `connection_string_example` | string | Optional placeholder example shown in the connection string import field (e.g. `"clickhouse://user:pass@localhost:9000/db"`). Also accepted as camelCase `connectionStringExample`. |
| `identifier_quote` | string | Character used to quote SQL identifiers. Use `"\""` for ANSI standard or `` "`" `` for MySQL style. |
| `sql_dialect` | string | Optional statement-splitting dialect: `postgres`, `mysql`, `mssql`, `sqlite`, `oracle`, or `generic`. Oracle-like plugins, including DM/Dameng, should use `"oracle"`. |
| `alter_primary_key` | bool | `true` if the database supports altering primary keys after table creation. |
| `manage_tables` | bool | `true` to enable table and column management UI (Create Table, Add/Modify/Drop Column, Drop Table). Does not control index or FK operations. Defaults to `true`. |
| `readonly` | bool | When `true`, the driver is read-only: all data modification operations (INSERT, UPDATE, DELETE) are disabled in the UI. The add/delete row buttons, inline cell editing, and context menu edit actions are hidden. Table and column management is also hidden regardless of `manage_tables`. Defaults to `false`. |
| `explain` | bool | `true` if the driver implements the `explain_query` method (EXPLAIN / query plan support). Enables the Visual EXPLAIN button in the SQL editor and notebook cells; when `false` or omitted, the Visual EXPLAIN UI is hidden for connections using this driver. Defaults to `false`. |
| `supports_ssl` | bool | `true` to show the SSL/TLS configuration tab (mode + CA/client cert/key) in the connection modal. The values are forwarded to the plugin as `ssl_mode`, `ssl_ca`, `ssl_cert`, and `ssl_key` in `ConnectionParams`. Network drivers only. Also accepted as camelCase `supportsSsl`. Defaults to `false`. |

### Data Types

Each entry in `data_types` describes a type the driver supports for column creation in the UI:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | SQL type name (e.g., `"VARCHAR"`, `"BIGINT"`). |
| `category` | string | UI grouping category (see below). |
| `requires_length` | bool | `true` if this type requires a length argument (e.g., `VARCHAR(255)`). |
| `requires_precision` | bool | `true` if this type requires a precision/scale argument (e.g., `DECIMAL(10,2)`). |
| `default_length` | string? | Optional default length pre-filled in the UI (e.g., `"255"` for `VARCHAR`). |

**Type Categories:**

| Category | Examples |
|----------|----------|
| `numeric` | INTEGER, BIGINT, DECIMAL, FLOAT, DOUBLE |
| `string` | VARCHAR, TEXT, CHAR |
| `date` | DATE, TIME, TIMESTAMP, DATETIME |
| `binary` | BLOB, BYTEA, VARBINARY |
| `json` | JSON, JSONB |
| `spatial` | GEOMETRY, POINT, POLYGON |
| `other` | BOOLEAN, UUID |

---

### Type Mappings

The optional `type_mappings` field lets your plugin declare how generic inferred type names should be mapped to driver-specific types. This is used during paste/import operations where Tabularis infers column types from data (e.g., detects a date column as `DATETIME`) and needs to translate that to a driver-native type.

Since `map_inferred_type()` is a synchronous trait method that cannot issue an RPC call, the mapping is declared statically in the manifest and resolved by the host at lookup time.

**Example for a PostgreSQL plugin:**

```json
{
  "type_mappings": {
    "DATETIME": "TIMESTAMP",
    "JSON": "JSONB"
  }
}
```

**Rules:**
- Keys are uppercase generic type names (the inferred type before mapping)
- Values are the driver-native equivalents to use instead
- Lookup is case-insensitive (the host uppercases the input before matching)
- If a type has no mapping, it passes through unchanged
- If `type_mappings` is omitted or empty, all types pass through unchanged

---

## 3. Plugin Settings

Plugins can declare custom configuration fields that Tabularis renders in the **Settings → gear icon** modal for that plugin. Users fill in the values, Tabularis persists them in `config.json`, and passes them to the plugin at startup via an `initialize` RPC call.

### Declaring settings in the manifest

Add an optional `settings` array at the top level of your manifest:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A custom plugin with settings",
  "executable": "my-plugin",
  "capabilities": { ... },
  "data_types": [ ... ],
  "settings": [
    {
      "key": "api_key",
      "label": "API Key",
      "type": "string",
      "required": true,
      "description": "Your API key for authentication."
    },
    {
      "key": "region",
      "label": "Region",
      "type": "select",
      "options": ["us-east-1", "eu-west-1", "ap-southeast-1"],
      "default": "us-east-1",
      "description": "Deployment region."
    },
    {
      "key": "max_connections",
      "label": "Max Connections",
      "type": "number",
      "default": 10
    },
    {
      "key": "ssl",
      "label": "Enable SSL",
      "type": "boolean",
      "default": true
    }
  ]
}
```

### Setting definition fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | yes | Unique identifier used as the key in the settings map. |
| `label` | string | yes | Human-readable label shown in the UI. |
| `type` | string | yes | One of: `"string"`, `"boolean"`, `"number"`, `"select"`. |
| `default` | any | no | Default value pre-filled when no saved value exists. |
| `description` | string | no | Optional hint displayed below the field. |
| `required` | boolean | no | If `true`, saving the modal is blocked until the field is filled. |
| `options` | string[] | no | For `"select"` type: the list of choices shown in the dropdown. |

### The `initialize` RPC method

Immediately after spawning the plugin process, Tabularis sends an `initialize` call:

```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "settings": {
      "api_key": "abc123",
      "region": "eu-west-1",
      "max_connections": 10,
      "ssl": true
    }
  },
  "id": 1
}
```

- The `settings` object contains only the keys the user has configured (merged with defaults).
- Returning an error response is safe — Tabularis silently ignores any `initialize` failure.
- Plugins that do not implement `initialize` are unaffected (the error is ignored).
- Use `initialize` to store settings in your plugin's state before any query arrives.

#### Handling `initialize` in Rust

```rust
"initialize" => {
    let settings = &params["settings"];
    // Store settings in your plugin state, e.g.:
    // API_KEY.set(settings["api_key"].as_str().unwrap_or("").to_string());
    json!({
        "jsonrpc": "2.0",
        "result": null,
        "id": id
    })
}
```

#### Handling `initialize` in Python

```python
elif method == "initialize":
    settings = params.get("settings", {})
    # Store settings for later use:
    # api_key = settings.get("api_key", "")
    send_response({"result": None, "id": req_id})
```

---

## 3b. UI Extensions

Plugins can inject custom React components into the host UI through a **slot-based extension system**. This is entirely optional — plugins without UI extensions continue to work as before.

### Declaring UI Extensions

Add an optional `ui_extensions` array to your manifest:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "ui_extensions": [
    {
      "slot": "row-editor-sidebar.field.after",
      "module": "ui/field-preview.js",
      "order": 50
    },
    {
      "slot": "data-grid.toolbar.actions",
      "module": "ui/export-button.js"
    },
    {
      "slot": "settings.plugin.before_settings",
      "module": "ui/auth-panel.js",
      "driver": "my-plugin"
    }
  ]
}
```

#### Extension entry fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slot` | string | yes | Target slot name (see table below). |
| `module` | string | yes | Relative path to the pre-built IIFE JavaScript bundle inside the plugin folder. |
| `order` | number | no | Sort order within the slot. Lower values render first. Default: `100`. |
| `driver` | string | no | If set, the contribution is only active when the active connection's driver matches this value. Useful for plugins that should only appear for their own driver. |

### Available Slots

| Slot Name | Location | Context Data | Use Cases |
|-----------|----------|--------------|-----------|
| `row-edit-modal.field.after` | After each field in New Row modal | `connectionId`, `tableName`, `schema`, `driver`, `columnName`, `rowData`, `isInsertion` | Validation hints, field previews |
| `row-edit-modal.footer.before` | Before Save/Cancel in New Row modal | `connectionId`, `tableName`, `schema`, `driver`, `rowData`, `isInsertion` | Batch actions, templates |
| `row-editor-sidebar.field.after` | After each field in Row Editor sidebar | `connectionId`, `tableName`, `schema`, `driver`, `columnName`, `rowData`, `rowIndex` | Field-level previews, lookups |
| `row-editor-sidebar.header.actions` | Sidebar header action buttons | `connectionId`, `tableName`, `schema`, `driver`, `rowData`, `rowIndex` | "Copy as JSON", audit links |
| `data-grid.toolbar.actions` | Table toolbar (right side) | `connectionId`, `tableName`, `schema`, `driver` | Export buttons, analysis tools |
| `data-grid.context-menu.items` | Right-click context menu on grid rows | `connectionId`, `tableName`, `schema`, `driver`, `columnName`, `rowIndex`, `rowData` | Row-level custom actions |
| `sidebar.footer.actions` | Explorer sidebar footer | `connectionId`, `driver` | Status indicators, quick actions |
| `settings.plugin.actions` | Per-plugin actions in Settings modal | `targetPluginId` | Diagnostics, re-auth buttons |
| `settings.plugin.before_settings` | Content above plugin settings form | `targetPluginId` | OAuth panels, status banners |
| `connection-modal.connection_content` | Inside the connection form | `driver` | Custom connection fields |
| `connection-modal.extra_fields` | Below host/port in the connection form | `driver`, `extra`, `setExtraField` | Plugin-specific connection fields (e.g. AWS region) |

### SlotContext

Every slot component receives a `context` object with the fields listed above. The available fields depend on the slot — for example, `rowData` is only present for row-level slots. All fields are optional.

```typescript
interface SlotContext {
  connectionId?: string | null;
  tableName?: string | null;
  schema?: string | null;
  driver?: string | null;
  rowData?: Record<string, unknown>;
  columnName?: string;
  rowIndex?: number;
  isInsertion?: boolean;
  targetPluginId?: string;
}
```

### Building UI Extension Bundles

Plugin UI components must be pre-built as **IIFE bundles** (Immediately Invoked Function Expression). The host provides `React`, `ReactJSXRuntime`, and the plugin API as globals — your bundle must **not** bundle its own copies of these.

#### Installing the plugin API types

The `@tabularis/plugin-api` package gives you TypeScript types, hook signatures, and the `defineSlot` helper for slot-aware type inference. Install it as a dev dependency — at runtime the host injects the real implementation, so the package itself ships as thin stubs.

```bash
npm install --save-dev @tabularis/plugin-api
# or: pnpm add -D @tabularis/plugin-api
```

Then `react` and `@tabularis/plugin-api` remain Vite externals in your build config — the installed package is used only for types and autocomplete in your editor.

#### Vite configuration example

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/MyComponent.tsx",
      formats: ["iife"],
      name: "__tabularis_plugin__",
      fileName: () => "ui/my-component.js",
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

> **Key points:**
> - The `name` field **must** be `"__tabularis_plugin__"` — the host looks for this global.
> - The component must be the **default export** of the entry file.
> - Multiple slots can reference the same `module` file.

### Writing a Slot Component

**Recommended: use `defineSlot` for typed context.** The helper infers the exact `context` shape for the slot you target, so fields like `context.columnName` are non-nullable where the host guarantees them:

```tsx
// src/FieldPreview.tsx
import { defineSlot, usePluginConnection } from "@tabularis/plugin-api";

const FieldPreview = defineSlot(
  "row-editor-sidebar.field.after",
  ({ context }) => {
    const { driver } = usePluginConnection();
    if (context.columnName !== "geometry") return null;

    return (
      <div style={{ padding: "4px 0", fontSize: "11px", color: "#888" }}>
        Geometry preview for {String(context.rowData[context.columnName])}
      </div>
    );
  },
);

// The loader expects a default-exported React component.
export default FieldPreview.component;
```

**Legacy form (no typed context).** Older bundles used the loose `SlotComponentProps` shape. Still supported; new plugins should prefer `defineSlot`.

```tsx
import { usePluginConnection } from "@tabularis/plugin-api";
import type { SlotComponentProps } from "@tabularis/plugin-api";

export default function FieldPreview({ context }: SlotComponentProps) {
  const { driver } = usePluginConnection();
  if (context.columnName !== "geometry") return null;
  return <div>Geometry preview for {String(context.rowData?.[context.columnName!])}</div>;
}
```

### Plugin API Hooks

Slot components can import these hooks from `@tabularis/plugin-api`:

| Hook | Returns | Purpose |
|------|---------|---------|
| `usePluginQuery()` | `(query: string) => Promise<{ columns, rows }>` | Execute read-only queries on the active connection |
| `usePluginConnection()` | `{ connectionId, driver, schema }` | Access active connection metadata |
| `usePluginToast()` | `{ showInfo(), showError(), showWarning() }` | Show toast notifications |
| `usePluginModal()` | `{ openModal(options), closeModal() }` | Open host-managed modals with custom content |
| `usePluginSetting(pluginId)` | `{ getSetting(key), setSetting(key, value) }` | Read/write plugin settings |
| `usePluginTheme()` | `{ themeId, themeName, isDark, colors }` | Access current theme info |
| `usePluginTranslation(pluginId)` | `t(key)` | Access plugin-specific i18n translations |
| `openUrl(url)` | `Promise<void>` | Open a URL in the system browser |

#### Plugin Modal

`usePluginModal()` lets you open a host-managed modal from within a slot component:

```tsx
const { openModal, closeModal } = usePluginModal();

openModal({
  title: "OAuth Setup",
  content: <MyOAuthForm onDone={closeModal} />,
  size: "md",  // "sm" | "md" | "lg" | "xl"
});
```

#### Plugin Translations

Plugins can ship locale files at `locales/{lang}.json` inside their plugin folder. The host loads them automatically and registers them under the plugin's namespace.

```
my-plugin/
├── .tabularium
├── my-plugin-binary
├── locales/
│   ├── en.json
│   └── it.json
└── ui/
    └── my-component.js
```

Use `usePluginTranslation("my-plugin")` in components to access translations via `t("key")`.

### Conditional Rendering

You can control when a contribution appears using two mechanisms:

1. **`driver` field in manifest**: Set `"driver": "my-plugin"` to only render when the active connection uses that driver.
2. **Component-level filtering**: Return `null` from your component based on `context` values.

```tsx
export default function PostgresOnly({ context }: SlotComponentProps) {
  // Only render for PostgreSQL connections
  if (context.driver !== "postgres") return null;
  return <div>PostgreSQL-specific action</div>;
}
```

### Security Restrictions

Plugin components **must not**:
- Import from `@tauri-apps/*` directly
- Access `window.__TAURI__` or invoke Tauri commands
- Manipulate the DOM outside their subtree

All host interaction goes through `@tabularis/plugin-api`.

### Error Isolation

Each contribution is wrapped in a `SlotErrorBoundary`. If your component throws, a small error badge is shown instead — other plugins and the host continue working normally.

For the full specification, see [`plugin-ui-extensions-spec.md`](https://tabularis.dev/docs/plugin-ui-extensions-spec.md).

---

## 4. Implementing the JSON-RPC Interface

Your plugin must run an event loop that:
1. Reads one JSON line from `stdin`.
2. Parses the JSON-RPC request.
3. Executes the requested database operation.
4. Writes a JSON-RPC response to `stdout` followed by `\n`.

### Request Format

```json
{
  "jsonrpc": "2.0",
  "method": "get_tables",
  "params": {
    "params": {
      "driver": "duckdb",
      "host": null,
      "port": null,
      "database": "/path/to/my_database.duckdb",
      "username": null,
      "password": null,
      "ssl_mode": null
    },
    "schema": null
  },
  "id": 1
}
```

The `params.params` object is a `ConnectionParams` — the same values the user entered in the connection form. The top-level `params` may contain additional method-specific fields (e.g., `schema`, `table`, `column_name`, etc.).

### Successful Response

```json
{
  "jsonrpc": "2.0",
  "result": [
    { "name": "users", "schema": "main", "comment": null }
  ],
  "id": 1
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Database file not found or inaccessible."
  },
  "id": 1
}
```

**Standard JSON-RPC error codes:**

| Code | Meaning |
|------|---------|
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |

---

## 5. Required Methods

Your plugin must respond to the following JSON-RPC methods. For unsupported features, return an empty array `[]` or a `-32601` (Method not found) error.

### Connection

#### `test_connection`

Test whether a connection can be established.

**Params:** `{ "params": ConnectionParams }`

**Result:** `{ "success": true }` or an error response.

---

#### `ping` *(optional)*

Lightweight health check called periodically (every N seconds, configurable) on active connections. If Tabularis does not receive a successful response after 2 consecutive attempts, the connection is considered dead and automatically disconnected.

**Params:** `{ "params": ConnectionParams }`

**Result:** `null` (or any value) on success, or an error response if the connection is no longer alive.

> If your plugin does not implement `ping`, Tabularis falls back to calling `test_connection` instead. Implementing `ping` is recommended for plugins that can perform a cheaper connectivity check than a full `test_connection` (e.g. reusing an existing connection/session rather than opening a new one).

---

### Schema Discovery

#### `get_databases`

List available databases.

**Params:** `{ "params": ConnectionParams }`

**Result:** `["db1", "db2"]`

---

#### `get_schemas`

List schemas within the current database.

**Params:** `{ "params": ConnectionParams }`

**Result:** `["public", "private"]`

> Return `[]` if `capabilities.schemas` is `false`.

---

#### `get_tables`

List tables in a schema/database.

**Params:** `{ "params": ConnectionParams, "schema": string | null }`

**Result:**
```json
[
  { "name": "users", "schema": "public", "comment": "User accounts" }
]
```

---

#### `get_columns`

Get column information for a table.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string }`

**Result:**
```json
[
  {
    "name": "id",
    "data_type": "INTEGER",
    "is_nullable": false,
    "default_value": null,
    "is_pk": true,
    "is_auto_increment": true,
    "comment": null
  }
]
```

> **JSON / JSONB columns:** Set `data_type` to `"JSON"` or `"JSONB"` (matched case-insensitively) to make Tabularis render the cell with syntax highlighting and expose the JSON editor window. In `execute_query` row data, send the cell as either a native JSON value (object/array/scalar) or a JSON-formatted string — both are accepted. For text-typed columns that hold JSON, end users can opt in per connection via the **Detect JSON in text columns** setting; no plugin change required.

---

#### `get_foreign_keys`

Get foreign key relationships for a table.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string }`

**Result:**
```json
[
  {
    "constraint_name": "fk_user_id",
    "column_name": "user_id",
    "referenced_table": "users",
    "referenced_column": "id",
    "on_update": "CASCADE",
    "on_delete": "SET NULL"
  }
]
```

---

#### `get_indexes`

Get indexes for a table.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string }`

**Result:**
```json
[
  {
    "index_name": "idx_email",
    "columns": ["email"],
    "is_unique": true,
    "is_primary": false
  }
]
```

---

### Views

#### `get_views`

List views in a schema/database.

**Params:** `{ "params": ConnectionParams, "schema": string | null }`

**Result:** `[{ "name": "active_users", "schema": "public" }]`

---

#### `get_view_definition`

Get the SQL definition of a view.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "view": string }`

**Result:** `"SELECT * FROM users WHERE active = true"`

---

#### `get_view_columns`

Get column information for a view.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "view": string }`

**Result:** Same structure as `get_columns`.

---

#### `create_view`

Create a new view.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "name": string, "definition": string }`

**Result:** `null` on success, or an error.

---

#### `alter_view`

Replace or modify an existing view.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "name": string, "definition": string }`

**Result:** `null` on success, or an error.

---

#### `drop_view`

Drop a view.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "name": string }`

**Result:** `null` on success, or an error.

---

### Materialized Views

These methods are optional. Declare `materialized_views: true` in capabilities to enable the UI. If your plugin returns `-32601` (method not found), the host falls back to empty results for `get_materialized_views` and `get_materialized_view_columns`; `get_materialized_view_definition` and `refresh_materialized_view` surface a "not supported by this driver" error instead.

#### `get_materialized_views`

List materialized views in a schema.

**Params:** `{ "params": ConnectionParams, "schema": string | null }`

**Result:** `[{ "name": string, "schema": string | null }]`

#### `get_materialized_view_columns`

Get columns of a materialized view.

**Params:** `{ "params": ConnectionParams, "view_name": string, "schema": string | null }`

**Result:** `[TableColumn]` (same shape as `get_columns`)

#### `get_materialized_view_definition`

Get the SQL definition of a materialized view.

**Params:** `{ "params": ConnectionParams, "view_name": string, "schema": string | null }`

**Result:** `string` (the SQL definition)

#### `refresh_materialized_view`

Refresh a materialized view's data.

**Params:** `{ "params": ConnectionParams, "view_name": string, "schema": string | null }`

**Result:** `null` on success, or an error.

---

### Routines

#### `get_routines`

List stored procedures and functions.

**Params:** `{ "params": ConnectionParams, "schema": string | null }`

**Result:**
```json
[
  { "name": "calculate_total", "routine_type": "FUNCTION", "schema": "public" }
]
```

---

#### `get_routine_parameters`

Get parameters of a stored routine.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "routine": string }`

**Result:**
```json
[
  { "name": "p_user_id", "data_type": "INTEGER", "mode": "IN" }
]
```

---

#### `get_routine_definition`

Get the SQL body of a stored routine.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "routine": string }`

**Result:** `"BEGIN ... END"`

---

### Triggers

Set `capabilities.triggers` to `true` when your driver implements the trigger RPCs. Tabularis uses this flag to show trigger-related UI.

#### `get_triggers`

List triggers in a schema/database.

**Params:** `{ "params": ConnectionParams, "schema": string | null }`

**Result:**
```json
[
  {
    "name": "users_audit_trg",
    "table_name": "users",
    "event": "INSERT OR UPDATE",
    "timing": "AFTER",
    "definition": "CREATE TRIGGER users_audit_trg ..."
  }
]
```

---

#### `get_trigger_definition`

Get the SQL definition of a trigger.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "trigger_name": string, "table_name": string }`

**Result:** `"CREATE TRIGGER users_audit_trg ..."`

---

#### `create_trigger`

Create a trigger from SQL generated by the UI or entered in raw SQL mode.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "trigger_sql": string }`

**Result:** `null` on success, or an error.

---

#### `drop_trigger`

Drop a trigger.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "trigger_name": string, "table_name": string }`

**Result:** `null` on success, or an error.

---

### Query Execution

#### `execute_query`

Execute a SQL query and return results.

**Params:**
```json
{
  "params": ConnectionParams,
  "query": "SELECT * FROM users",
  "page": 1,
  "page_size": 100
}
```

**Result:**
```json
{
  "columns": ["id", "name", "email"],
  "rows": [
    [1, "Alice", "alice@example.com"]
  ],
  "total_count": 1,
  "execution_time_ms": 12
}
```

---

### CRUD Operations

#### `insert_record`

Insert a new row into a table.

**Params:**
```json
{
  "params": ConnectionParams,
  "schema": null,
  "table": "users",
  "data": { "name": "Bob", "email": "bob@example.com" }
}
```

**Result:** `null` on success, or an error.

---

#### `update_record`

Update a single field in a row.

**Params:**
```json
{
  "params": ConnectionParams,
  "schema": null,
  "table": "users",
  "pk_col": "id",
  "pk_val": 42,
  "col_name": "name",
  "new_val": "Robert"
}
```

**Result:** Number of affected rows (e.g. `1`), or an error.

---

#### `delete_record`

Delete a row from a table.

**Params:**
```json
{
  "params": ConnectionParams,
  "schema": null,
  "table": "users",
  "pk_col": "id",
  "pk_val": 42
}
```

**Result:** Number of affected rows (e.g. `1`), or an error.

---

### BLOB Operations

These methods are optional. If your plugin returns `-32601` (method not found), the host shows "BLOB export/preview not supported" to the user.

#### `save_blob_to_file`

Save a binary column value to a file on disk. The plugin receives the file path and is responsible for writing the file directly (since the plugin runs on the same machine as the host).

**Params:**
```json
{
  "params": ConnectionParams,
  "table": "documents",
  "col_name": "content",
  "pk_map": { "id": 42 },
  "schema": "public",
  "file_path": "/tmp/export.pdf"
}
```

**Result:** `null` on success, or an error.

**Contract:** The plugin must:
1. Query the binary column value using the PK map to identify the row
2. Write the raw bytes to `file_path`
3. Return `null` on success or an error string on failure

#### `fetch_blob_as_data_url`

Fetch a binary column value and return it as a displayable string (for preview in the row editor).

**Params:**
```json
{
  "params": ConnectionParams,
  "table": "images",
  "col_name": "data",
  "pk_map": { "id": 7 },
  "schema": "public"
}
```

**Result:** A string in the BLOB wire format: `"BLOB:<size_bytes>:<mime_type>:<base64_data>"`, or an error.

**Example response:**
```json
{ "result": "BLOB:1024:image/png:iVBORw0KGgo..." }
```

---

### AI Schema Context (Optional)

AI Query Assist obtains metadata through the active database driver. Plugins
that already implement `get_tables`, `get_columns`, and `get_foreign_keys` work
without changes: Tabularis calls those standard methods, limits the result, and
formats the provider-agnostic system prompt in the host.

Plugins may optionally implement `get_ai_schema_context` to replace those
per-table calls with a database-specific batch query. Return JSON-RPC error
`-32601` when the method is not implemented; Tabularis then uses the standard
metadata fallback automatically.

**Params:**
```json
{
  "params": ConnectionParams,
  "schema": "public",
  "max_tables": 20
}
```

**Result:**
```json
{
  "tables": [
    {
      "name": "users",
      "columns": [ /* standard get_columns entries */ ],
      "foreign_keys": [ /* standard get_foreign_keys entries */ ]
    }
  ],
  "total_table_count": 42
}
```

The plugin must respect `max_tables`, but `total_table_count` reports the
number of tables before truncation. Plugins return structured metadata only;
the host owns prompt wording, identifier quoting, and provider dispatch.

---

### Batch / ER Diagram Methods

These methods are used to build ER diagrams efficiently by loading all metadata in one call.

#### `get_schema_snapshot`

Return the complete schema structure (tables + columns + foreign keys).

**Params:** `{ "params": ConnectionParams, "schema": string | null }`

**Result:**
```json
[
  {
    "name": "users",
    "columns": [ /* column list */ ],
    "foreign_keys": [ /* FK list */ ]
  }
]
```

---

#### `get_all_columns_batch`

Return columns for all tables at once.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "tables": ["users", "orders"] }`

**Result:** `{ "users": [ /* columns */ ], "orders": [ /* columns */ ] }`

---

#### `get_all_foreign_keys_batch`

Return foreign keys for all tables at once.

**Params:** `{ "params": ConnectionParams, "schema": string | null, "tables": ["users", "orders"] }`

**Result:** `{ "users": [ /* FKs */ ], "orders": [ /* FKs */ ] }`

---

### DDL Generation

These methods generate SQL statements. Tabularis may display the SQL to the user before executing it.

#### `get_create_table_sql`

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string }`

**Result:** `"CREATE TABLE users (...)"`

---

#### `get_add_column_sql`

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string, "column": ColumnDefinition }`

**Result:** `"ALTER TABLE users ADD COLUMN ..."`

---

#### `get_alter_column_sql`

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string, "column": ColumnDefinition }`

**Result:** `"ALTER TABLE users MODIFY COLUMN ..."`

---

#### `get_create_index_sql`

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string, "index": IndexDefinition }`

**Result:** `"CREATE INDEX idx_email ON users(email)"`

---

#### `get_create_foreign_key_sql`

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string, "fk": ForeignKeyDefinition }`

**Result:** `"ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)"`

---

#### `drop_index`

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string, "index_name": string }`

**Result:** `null` on success, or an error.

---

#### `drop_foreign_key`

**Params:** `{ "params": ConnectionParams, "schema": string | null, "table": string, "constraint_name": string }`

**Result:** `null` on success, or an error.

---

## 6. Example: Building a Minimal Plugin in Rust

Here is a minimal but functional skeleton for a plugin executable in Rust.

```rust
use std::io::{self, BufRead, Write};
use serde_json::{json, Value};

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = line.unwrap();
        if line.trim().is_empty() {
            continue;
        }

        let req: Value = serde_json::from_str(&line).unwrap_or_else(|_| {
            // Ignore unparseable lines
            return Value::Null;
        });

        if req.is_null() {
            continue;
        }

        let id = req["id"].clone();
        let method = req["method"].as_str().unwrap_or("");
        let params = &req["params"];

        let response = dispatch(method, params, id);

        let mut res_str = serde_json::to_string(&response).unwrap();
        res_str.push('\n');
        stdout.write_all(res_str.as_bytes()).unwrap();
        stdout.flush().unwrap();
    }
}

fn dispatch(method: &str, params: &Value, id: Value) -> Value {
    match method {
        "test_connection" => json!({
            "jsonrpc": "2.0",
            "result": { "success": true },
            "id": id
        }),

        // Optional: lightweight health check (called periodically).
        // If omitted, Tabularis falls back to test_connection.
        "ping" => json!({
            "jsonrpc": "2.0",
            "result": null,
            "id": id
        }),

        "get_databases" => json!({
            "jsonrpc": "2.0",
            "result": ["my_database"],
            "id": id
        }),

        "get_schemas" => json!({
            "jsonrpc": "2.0",
            "result": [],
            "id": id
        }),

        "get_tables" => {
            // Connect to the database using params["params"]["database"], etc.
            json!({
                "jsonrpc": "2.0",
                "result": [
                    { "name": "example_table", "schema": null, "comment": null }
                ],
                "id": id
            })
        },

        "execute_query" => {
            let query = params["query"].as_str().unwrap_or("");
            // Execute query and return results
            json!({
                "jsonrpc": "2.0",
                "result": {
                    "columns": ["id", "name"],
                    "rows": [[1, "Alice"]],
                    "total_count": 1,
                    "execution_time_ms": 5
                },
                "id": id
            })
        },

        _ => json!({
            "jsonrpc": "2.0",
            "error": {
                "code": -32601,
                "message": format!("Method '{}' not implemented", method)
            },
            "id": id
        }),
    }
}
```

Add `serde_json` to your `Cargo.toml`:

```toml
[dependencies]
serde_json = "1"
```

---

## 7. Testing Your Plugin

### Manual Testing via Shell

You can test your plugin directly by piping JSON-RPC messages:

```bash
echo '{"jsonrpc":"2.0","method":"get_tables","params":{"params":{"driver":"duckdb","database":"/tmp/test.duckdb"},"schema":null},"id":1}' \
  | ./duckdb-plugin
```

You should see a valid JSON-RPC response on stdout.

### Installing Locally

1. Create the plugin directory in Tabularis's data folder:
   - **Linux:** `~/.local/share/tabularis/plugins/myplugin/`
   - **macOS:** `~/Library/Application Support/tabularis/plugins/myplugin/`
   - **Windows:** `%APPDATA%\tabularis\plugins\myplugin\`
2. Place your `.tabularium` (or legacy `manifest.json`) and the compiled executable in that directory.
3. On Linux/macOS, make the executable runnable: `chmod +x myplugin`
4. Restart Tabularis (or install via Settings to hot-reload without restart).
5. Open **Settings → Installed Plugins** — your driver should appear.
6. Try creating a new connection using your driver from the connection form.

---

## 8. Publishing Your Plugin

To make your plugin available in the official registry:

1. Build release binaries for all supported platforms.
2. Package each platform binary with your `.tabularium` into a `.zip` file (the scaffolded release workflow does this).
3. Create a GitHub Release with the ZIP files attached — **plus `.tabularium` as a standalone asset** (GitHub renames it to `default.tabularium`; the registry accepts both). The registry resolves the manifest from release assets, and the tag stripped of `v` must equal the manifest `version`.
4. Submit your plugin at [registry.tabularis.dev/submit](https://registry.tabularis.dev/submit) — ownership is verified via OAuth against your linked repository, and CI can pre-validate the manifest via `POST /api/manifest/validate`. A manifest that fails validation is rejected with **HTTP 422** — there is no silent fallback. The registry's [plugin development page](https://registry.tabularis.dev/docs/plugin-development) documents every `.tabularium` field; the full author docs live at [docs.tabularium.wiki](https://docs.tabularium.wiki/manifest/).
5. Installs are verified client-side: Tabularis checks the registry's JWS signature and the download's SHA-256 before anything runs.

The legacy path — a pull request adding an entry to `plugins/registry.json` (format in [README.md](./README.md)) — still works during the transition; new plugins should submit to the registry directly.

> **Note:** `min_tabularis_version` is specified per-release inside the `releases[]` array,
> not at the root plugin level. This allows older Tabularis installs to install an older
> compatible release even when a newer release requires a higher app version.
