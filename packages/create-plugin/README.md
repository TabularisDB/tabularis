# @tabularis/create-plugin

Scaffold a new [Tabularis](https://github.com/TabularisDB/tabularis) database driver plugin in seconds.

```bash
npm create @tabularis/plugin@latest my-driver
```

(Works the same with `pnpm create @tabularis/plugin@latest my-driver` or `yarn create @tabularis/plugin my-driver`.)

## What you get

A runnable Rust project with:

- **`.tabularium`** bundle manifest aligned with the Tabularis plugin schema.
- **33 JSON-RPC handlers pre-wired** — metadata methods return empty arrays (plugin loads cleanly), query/CRUD/DDL methods return `-32601` until you implement them.
- **`test_connection` placeholder** that returns success, so your driver appears in the connection picker immediately after `just dev-install`.
- **Working utilities**: `quote_identifier`, `paginate` — with unit tests — ready to use from your handlers.
- **Cross-platform GitHub Actions release workflow** for Linux x64/arm64, macOS x64/arm64, and Windows x64.
- **Local REPL (`just repl`)** for debugging without restarting Tabularis.
- **Optional UI extension subworkspace** (`--with-ui`) pre-configured with Vite IIFE + `@tabularis/plugin-api`.

## Usage

```bash
npm create @tabularis/plugin@latest [--] [options] <name>
```

`--` separates the package name from the flags so they reach the CLI instead of npm. If you prefer the direct form:

```bash
npx @tabularis/create-plugin [options] <name>
```

### Options

| Flag | Values | Default | Purpose |
|------|--------|---------|---------|
| `--db-type` | `network` \| `file` \| `folder` \| `api` | `network` | Shapes the connection form and capabilities |
| `--quote` | `"` \| `` ` `` | `"` | SQL identifier quote character |
| `--with-ui` | boolean | off | Also scaffold a `ui/` subworkspace using `@tabularis/plugin-api` |
| `--no-git` | boolean | off | Skip `git init` |
| `--dir` | path | `./<name>` | Target directory |

### Examples

```bash
# Network driver (host/port/user/pass connection form)
npm create @tabularis/plugin@latest my-pg-like

# File-based driver (SQLite, DuckDB shape)
npm create @tabularis/plugin@latest duckdb-clone -- --db-type=file

# API-based plugin (no connection form; public REST-ish data source)
npm create @tabularis/plugin@latest my-api -- --db-type=api

# With UI extension scaffold
npm create @tabularis/plugin@latest mine -- --with-ui
```

## Next steps after scaffolding

```bash
cd my-driver
just dev-install              # builds and installs into ~/.local/share/tabularis/plugins/my-driver
# open Tabularis → your driver is in the connection picker
```

From there, fill in handlers in `src/handlers/metadata.rs`, then `query.rs`, then the rest. The generated `README.md` includes a feature-by-feature roadmap.

## Migrating an existing plugin

Plugins built before the registry cutover ship a `manifest.json`. The host now
reads a `.tabularium` bundle manifest (the `manifest.json` path survives only as
a deprecated fallback). To convert a project in place:

```bash
npx @tabularis/create-plugin migrate            # current directory
npx @tabularis/create-plugin migrate ./my-driver
```

This writes `.tabularium` from your `manifest.json`, removes the old file, and
updates the `manifest.json` references in `release.yml`, `justfile`, and
`README.md`. It keeps a `id` that differs from `name` (the host uses it as the
plugin identity) and refuses to run if the manifest has no semver `version`,
which the registry requires.

By default the release workflow is left as-is (only its `manifest.json`
reference is renamed so the build keeps working). The hosted Tabularium registry
resolves the manifest from the **release assets**, so it needs `.tabularium`
published as a standalone asset. Add `--ci` to regenerate `release.yml` from the
registry-ready template:

```bash
npx @tabularis/create-plugin migrate ./my-driver --ci
```

`--ci` overwrites `release.yml` (re-apply any custom CI steps) and derives the
binary name from the manifest's `executable` field. Commit the result and
republish.

## Layout of the generated project

```
my-driver/
├── Cargo.toml
├── .tabularium
├── README.md
├── justfile            # just build / test / dev-install / repl / lint / fmt
├── rust-toolchain.toml
├── .github/workflows/release.yml
└── src/
    ├── main.rs         # stdio JSON-RPC loop
    ├── rpc.rs          # method dispatch
    ├── client.rs       # TODO: your DB client
    ├── error.rs
    ├── models.rs
    ├── handlers/{metadata,query,crud,ddl}.rs
    ├── utils/{identifiers,pagination}.rs
    └── bin/test_plugin.rs
```

With `--with-ui`:

```
my-driver/ui/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/index.tsx     # defineSlot("data-grid.toolbar.actions", …)
```

## Requirements

- Node 18.17 or newer.
- Rust stable (for building the generated plugin).
- `just` (optional but recommended — the generated `justfile` wraps the common tasks).

## Related

- **[Plugin guide](https://github.com/TabularisDB/tabularis/blob/main/plugins/PLUGIN_GUIDE.md)** — authoritative reference for JSON-RPC methods, capabilities, slots.
- **[`@tabularis/plugin-api`](https://www.npmjs.com/package/@tabularis/plugin-api)** — TypeScript types + hooks for UI extensions.
- **[Tabularis repo](https://github.com/TabularisDB/tabularis)** — the host app.

## License

Apache-2.0
