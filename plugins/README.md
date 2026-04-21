# Tabularis Plugin Registry

This directory contains the official plugin registry and documentation for the Tabularis external plugin system.

## Quick start — build a plugin

**First time?** Read [`PLUGIN_TUTORIAL.md`](./PLUGIN_TUTORIAL.md) — a 20-minute walkthrough that ends with a working Google Sheets driver in your local Tabularis.

**Already know the system?**

```bash
npm create @tabularis/plugin@latest my-driver
cd my-driver
just dev-install
```

Your driver appears in the Tabularis connection picker immediately. Fill in the handlers as you go — full reference in [`PLUGIN_GUIDE.md`](./PLUGIN_GUIDE.md). Scaffolder source and options: [`packages/create-plugin/`](../packages/create-plugin/).

## Directory Contents

```
plugins/
├── registry.json     # Official plugin registry (fetched by the app at runtime)
├── README.md         # This file
└── PLUGIN_GUIDE.md   # Developer guide for building a plugin
```

## Plugin System Overview

Tabularis supports extending its database support via an **external plugin system**. Plugins are standalone executables that communicate with the app through **JSON-RPC 2.0 over stdin/stdout**. They can be written in any programming language and distributed independently of the main application.

Built-in drivers (MySQL, PostgreSQL, SQLite) are compiled into the binary. All additional databases (DuckDB, MongoDB, etc.) are supported through plugins.

### How It Works

1. At startup, Tabularis scans the user's plugins directory for subdirectories containing a `manifest.json`.
2. For each valid plugin, it creates an RPC bridge to the plugin executable and registers it as a driver.
3. When the user connects to a database using a plugin driver, Tabularis spawns the executable and routes all requests through JSON-RPC.
4. Plugins can be installed, updated, and uninstalled from **Settings → Available Plugins** without restarting the app.

### Plugin Installation Directory

| OS      | Path |
|---------|------|
| Linux   | `~/.local/share/tabularis/plugins/` |
| macOS   | `~/Library/Application Support/com.debba.tabularis/plugins/` |
| Windows | `%APPDATA%\com.debba.tabularis\plugins\` |

Each plugin lives in its own subdirectory:

```
plugins/
└── duckdb/
    ├── manifest.json
    └── duckdb-plugin-executable
```

---

## `registry.json` Format

The registry file is fetched from this repository by the app to display available plugins in the Settings UI.

```json
{
  "schema_version": 1,
  "plugins": [
    {
      "id": "duckdb",
      "name": "DuckDB",
      "description": "DuckDB local analytical database",
      "author": "Author Name <https://github.com/author>",
      "homepage": "https://github.com/author/repo",
      "latest_version": "1.1.0",
      "releases": [
        {
          "version": "1.0.0",
          "min_tabularis_version": "0.8.15",
          "assets": {
            "linux-x64": "https://example.com/plugin-linux-x64-1.0.0.zip",
            "darwin-arm64": "https://example.com/plugin-darwin-arm64-1.0.0.zip",
            "darwin-x64": "https://example.com/plugin-darwin-x64-1.0.0.zip",
            "win-x64": "https://example.com/plugin-win-x64-1.0.0.zip"
          }
        },
        {
          "version": "1.1.0",
          "min_tabularis_version": "0.9.0",
          "assets": {
            "linux-x64": "https://example.com/plugin-linux-x64-1.1.0.zip",
            "darwin-arm64": "https://example.com/plugin-darwin-arm64-1.1.0.zip",
            "darwin-x64": "https://example.com/plugin-darwin-x64-1.1.0.zip",
            "win-x64": "https://example.com/plugin-win-x64-1.1.0.zip"
          }
        }
      ]
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique driver identifier, must match the `id` in `manifest.json` |
| `name` | string | Display name shown in the UI |
| `description` | string | Short description shown in the plugins list |
| `author` | string | Author name and URL in the format `"Name <https://url>"` |
| `homepage` | string | URL to the plugin repository or documentation |
| `latest_version` | string | Latest released version (semver) |
| `releases[].version` | string | Version string for this release |
| `releases[].min_tabularis_version` | string | Minimum app version required for this specific release |
| `releases[].assets` | object | Map of platform key → ZIP download URL |

### Platform Keys

| Key | Platform |
|-----|----------|
| `linux-x64` | Linux x86-64 |
| `darwin-arm64` | macOS Apple Silicon |
| `darwin-x64` | macOS Intel |
| `win-x64` | Windows x86-64 |

Omit a platform key if your plugin does not support that platform. The app will show a "not supported" message for that platform.

---

## Publishing a Plugin

To add your plugin to the official registry:

1. Build and release your plugin as a `.zip` file for each supported platform. The ZIP must extract to a directory containing `manifest.json` and the executable.
2. Host the release assets (e.g., GitHub Releases).
3. Open a pull request adding your plugin entry to `registry.json`.
4. Ensure your `manifest.json` matches the format described in [PLUGIN_GUIDE.md](./PLUGIN_GUIDE.md).

---

## Available Plugins

The full list is maintained in [`registry.json`](./registry.json).

---

## UI Extensions (Phase 2)

Starting with v0.9.15, plugins can also inject custom UI components into the Tabularis interface through a slot-based extension system. Plugins declare a `ui_extensions` array in their manifest, targeting predefined insertion points (slots) such as the toolbar, context menu, row editor, sidebar, and plugin settings page.

This is entirely optional — plugins without `ui_extensions` continue to work identically.

For details, see:
- [Plugin UI Extensions Spec](https://tabularis.dev/docs/plugin-ui-extensions-spec.md) — Full specification
- [PLUGIN_GUIDE.md](./PLUGIN_GUIDE.md) § 3b — Quick-start guide for UI extensions

---

## Development Resources

- [PLUGIN_GUIDE.md](./PLUGIN_GUIDE.md) — Complete guide for implementing a plugin executable
- [Plugin UI Extensions Spec](https://tabularis.dev/docs/plugin-ui-extensions-spec.md) — UI extension system specification
- [Driver Trait](../src-tauri/src/drivers/driver_trait.rs) — Rust trait all drivers implement
- [RPC Protocol](../src-tauri/src/plugins/rpc.rs) — JSON-RPC types used for communication
