---
name: tabularis-plugin-driver
description: "Use when creating or updating a Tabularis database driver plugin in Rust. Covers modern manifest fields, JSON-RPC over stdio, modular plugin layout, MySQL-level feature coverage targets, optional UI extensions, and validation against Tabularis repo rules."
---

# Tabularis Plugin Driver

Use this skill when building or updating a database plugin for Tabularis.

The skill is optimized for this repository. Follow `AGENTS.md`, the files in `.rules/`, and the current plugin-system behavior in `src-tauri/src/plugins/` and `src/types/plugins.ts`.

## Goals

- Build a Rust plugin that speaks Tabularis JSON-RPC over stdin/stdout
- Use the modern plugin manifest, not the old minimal format
- Aim for broad feature coverage comparable to the built-in MySQL driver where the target database supports it
- Keep the plugin modular instead of concentrating logic in a single `main.rs`
- Add unit tests for pure utilities and SQL generation

## Default Repo Layout

Prefer this structure for a new plugin repository:

```text
plugin-root/
├── Cargo.toml
├── manifest.json
├── README.md
├── src/
│   ├── main.rs
│   ├── rpc.rs
│   ├── client.rs
│   ├── error.rs
│   ├── models.rs
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── metadata.rs
│   │   ├── query.rs
│   │   ├── crud.rs
│   │   └── ddl.rs
│   └── utils/
│       ├── mod.rs
│       ├── identifiers.rs
│       ├── values.rs
│       ├── types.rs
│       └── pagination.rs
├── src/bin/
│   └── test_plugin.rs
└── tests/                # only if integration tests are worth the overhead
```

Keep `src/main.rs` thin. It should mostly parse requests, dispatch methods, and serialize responses.

## Required Research Before Coding

1. Read the current plugin manifest shape in:
   - `plugins/manifest.schema.json`
   - `src/types/plugins.ts`
   - `src-tauri/src/plugins/manager.rs`
2. Read the JSON-RPC expectations in:
   - `plugins/PLUGIN_GUIDE.md`
   - `src-tauri/src/plugins/driver.rs`
   - `src-tauri/src/plugins/rpc.rs`
3. Read a built-in driver with broad coverage to understand expected behaviors:
   - `src-tauri/src/drivers/mysql/mod.rs`
4. Read plugin-loading behavior and modern feature flags in:
   - `src/hooks/useDrivers.ts`
   - `src/utils/connectionStringParser.ts`
   - `src/utils/driverCapabilities.ts`

## Implementation Workflow

### 1. Define plugin scope

Decide which capabilities are truly supported by the target database and driver library:

- `schemas`
- `views`
- `routines`
- `file_based`
- `folder_based`
- `connection_string`
- `connection_string_example`
- `identifier_quote`
- `alter_primary_key`
- `alter_column`
- `create_foreign_keys`
- `manage_tables`
- `readonly`
- `no_connection_required`

Do not advertise support you cannot back with working handlers.

### 2. Create a modern manifest

At minimum define:

- `id`
- `name`
- `version`
- `description`
- `default_port`
- `executable`
- `capabilities`
- `data_types`
- `default_username`
- `color`
- `icon`

Use modern optional fields when useful:

- `settings`
- `ui_extensions`

See [references/manifest-checklist.md](./references/manifest-checklist.md).

### 3. Build a modular RPC surface

Implement the request loop in `main.rs`, but move logic out immediately:

- `rpc.rs`: request parsing, success/error helpers, method routing support
- `client.rs`: connection config, client creation, pooling or reuse key logic
- `handlers/metadata.rs`: databases, schemas, tables, columns, indexes, foreign keys, views, routines
- `handlers/query.rs`: `test_connection`, `ping`, `execute_query`, `count_query`, `explain_query_plan` if possible
- `handlers/crud.rs`: `insert_record`, `update_record`, `delete_record`
- `handlers/ddl.rs`: SQL generation helpers and DDL RPC methods
- `utils/*`: quoting, escaping, value formatting, type normalization, pagination math

### 4. Target broad feature coverage

Use the built-in MySQL driver as the feature benchmark, not as text to copy.

For each feature area, classify it:

- `supported`: implement fully
- `partially_supported`: implement with explicit limitations
- `unsupported`: return an accurate error or empty result as appropriate

Prioritize these methods:

- `test_connection`
- `get_databases`
- `get_schemas`
- `get_tables`
- `get_columns`
- `get_foreign_keys`
- `get_indexes`
- `get_views`
- `get_view_definition`
- `get_view_columns`
- `get_routines`
- `get_routine_parameters`
- `get_routine_definition`
- `execute_query`
- `insert_record`
- `update_record`
- `delete_record`
- `get_schema_snapshot`
- `get_all_columns_batch`
- `get_all_foreign_keys_batch`
- `get_create_table_sql`
- `get_add_column_sql`
- `get_alter_column_sql`
- `get_create_index_sql`
- `get_create_foreign_key_sql`
- `drop_index`
- `drop_foreign_key`

If a method is not safe to emulate, fail explicitly instead of faking success.

### 5. Add settings only when they solve a real problem

Typical useful settings:

- DSN name
- driver/library path
- default schema
- TLS mode
- extra connection properties

Keep settings in the manifest and resolve them in a dedicated config path, not inline in handlers.

### 6. Add UI extensions only when the database needs them

Examples of good reasons:

- a custom connection helper for DSN-based setup
- an advanced settings panel for database-specific options
- contextual UI for unsupported-but-important caveats

Avoid UI extensions that only decorate the product without improving DB-specific workflows.

## Testing Strategy

Always add unit tests for pure logic:

- identifier quoting
- SQL builders
- type normalization
- pagination helpers
- value serialization
- capability-driven helper decisions

Prefer pure utility modules so tests stay fast and deterministic.

If the plugin includes a JSON-RPC smoke binary like `src/bin/test_plugin.rs`, use it to simulate Tabularis requests over stdio.

## Validation Checklist

Before finishing:

- `cargo test`
- `cargo build --release`
- smoke test at least one JSON-RPC request through stdin/stdout
- verify `manifest.json` matches current Tabularis schema and capabilities
- verify any advertised capability has corresponding handler behavior
- verify unsupported operations return clear errors

## Tabularis-Specific Rules

- Comments and docs must be in English
- Keep code split by responsibility; avoid a monolithic `main.rs`
- Add unit tests for extracted utility logic
- When updating this repo itself, follow `AGENTS.md` requirements including GitNexus impact analysis before editing existing symbols
- Use `pnpm` for frontend-side validation in this repo and `cargo` for plugin validation

## Common Mistakes

- copying old plugin manifests that omit modern fields
- putting connection logic, SQL generation, RPC parsing, and metadata extraction in one file
- advertising `manage_tables` or `alter_column` without implementing the related methods
- returning fake empty success for operations that should surface unsupported behavior
- skipping tests for identifier quoting and SQL generation

## References

- Manifest details: [references/manifest-checklist.md](./references/manifest-checklist.md)
