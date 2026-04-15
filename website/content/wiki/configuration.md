---
title: "Configuration"
order: 3
excerpt: "Adjust Tabularis to your workflow: language settings, AI providers, and general application behavior."
category: "Customization"
---

# Configuration

Tabularis is designed to work perfectly out-of-the-box, but offers extensive configuration options via the UI **Settings** panel and an underlying `config.json` file.

## Accessing Settings

Open the Settings panel from:
- **Sidebar**: Click the gear icon at the bottom of the left sidebar

## General Settings

![General settings panel with data editor, ping interval, and ER diagram layout options](/img/tabularis-settings-general.png)

- **Language Support**: Native translations for **English**, **Italian**, **Spanish**, and **Chinese (Simplified)**. The app defaults to your OS locale, and changing the language applies immediately.
- **Update Checks**: Enable or disable automatic update checks on startup. Checks query the GitHub Releases API — no version data is sent, only a GET request is made.

## Storage Paths & config.json

Tabularis stores non-sensitive configuration, UI preferences, and connection metadata in a central `config.json`. **Passwords and SSH passphrases are NEVER stored here** — they live exclusively in your OS keychain.

### File Locations

| Platform | Path |
| :--- | :--- |
| **Windows** | `%APPDATA%\tabularis\config.json` |
| **macOS** | `~/Library/Application Support/tabularis/config.json` |
| **Linux** | `~/.config/tabularis/config.json` |

### Manually Editing config.json

You can edit the file manually while **the application is closed**. Editing while Tabularis is running will likely result in your changes being overwritten when the app writes its state on exit.

A minimal valid `config.json` looks like:
```json
{
  "language": "auto",
  "fontSize": 14,
  "aiEnabled": false
}
```

Any key omitted from the file falls back to its default value. You do not need a complete file.

### `config.json` Full Reference

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `theme` | `string` | `null` | Active UI theme ID. See [Themes](/wiki/themes). |
| `language` | `string` | `"auto"` | Preferred locale: `en`, `it`, `es`, or `auto` (follows OS). |
| `resultPageSize` | `number` | `500` | Rows fetched per pagination request in the Data Grid. |
| `fontFamily` | `string` | `"System"` | Editor font. Must be installed on the system. |
| `fontSize` | `number` | `14` | Editor font size in pixels. |
| `aiEnabled` | `boolean` | `false` | Master toggle for all AI features. |
| `aiProvider` | `string` | `null` | Active AI provider: `openai`, `anthropic`, `minimax`, `ollama`, `openrouter`, `custom-openai`. |
| `aiModel` | `string` | `null` | The model identifier string sent to the provider. |
| `aiCustomModels` | `object` | `null` | Custom model lists per provider (map of provider ID → string[]). |
| `aiOllamaPort` | `number` | `11434` | Local port for the Ollama daemon. |
| `aiCustomOpenaiUrl` | `string` | `null` | Base URL for OpenAI-compatible endpoints (e.g., LM Studio, vLLM). |
| `aiCustomOpenaiModel` | `string` | `null` | Model name to use with the custom OpenAI-compatible endpoint. |
| `checkForUpdates` | `boolean` | `true` | Enable or disable update checks entirely. |
| `autoCheckUpdatesOnStartup` | `boolean` | `true` | Checks GitHub Releases API on boot. |
| `lastDismissedVersion` | `string` | `null` | Version string of the last dismissed update notification. |
| `erDiagramDefaultLayout` | `string` | `"LR"` | `TB` (Top-Bottom) or `LR` (Left-Right) for Dagre layout. |
| `schemaPreferences` | `object` | `{}` | Per-connection active schema for DDL operations (map of connection ID → schema name). |
| `selectedSchemas` | `object` | `{}` | Per-connection visible schemas in the sidebar (map of connection ID → string[]). |
| `queryHistoryMaxEntries` | `number` | `500` | Maximum number of query history entries retained per connection. |
| `maxBlobSize` | `number` | `1048576` | Max bytes to load into UI for BLOB/bytea columns (default 1 MB). |
| `copyFormat` | `string` | `"csv"` | Default row copy format: `csv` or `json`. |
| `csvDelimiter` | `string` | `","` | Default delimiter used when copying or exporting CSV. |
| `pingInterval` | `number` | `30` | Connection health check interval in seconds. `0` disables pings. See [Connection Health Check](/wiki/connections#connection-health-check). |
| `activeExternalDrivers` | `string[]` | `[]` | List of plugin driver IDs loaded at startup. |
| `customRegistryUrl` | `string` | `null` | Custom URL for the plugin registry. Overrides the default official registry when fetching and installing plugins. |
| `plugins` | `object` | `{}` | Per-plugin config, including optional interpreter overrides and plugin settings values. |
| `editorTheme` | `string` | `null` | Monaco editor theme ID. |
| `editorFontFamily` | `string` | `"JetBrains Mono"` | SQL editor font family. |
| `editorFontSize` | `number` | `14` | SQL editor font size in pixels. |
| `editorLineHeight` | `number` | `1.5` | SQL editor line height multiplier. |
| `editorTabSize` | `number` | `2` | SQL editor tab width. |
| `editorWordWrap` | `boolean` | `true` | Whether the SQL editor wraps long lines. |
| `editorShowLineNumbers` | `boolean` | `true` | Whether the SQL editor shows line numbers. |

The in-app log viewer has its own backend settings and commands, but those are not stored as `loggingEnabled` or `maxLogEntries` fields in `config.json`.

## Application Logs

For debugging connection failures, plugin crashes, or unexpected behavior, Tabularis writes structured logs.

### Log File Locations

| Platform | Path |
| :--- | :--- |
| **macOS** | `~/Library/Logs/tabularis/` |
| **Windows** | `%APPDATA%\tabularis\logs\` |
| **Linux** | `~/.cache/tabularis/` |

### Runtime Debug Logging

Launch Tabularis from the terminal with the `RUST_LOG` environment variable for real-time debug output:

```bash
# All debug messages from the Tabularis crate
RUST_LOG=tabularis=debug tabularis

# Debug messages from all crates (very verbose)
RUST_LOG=debug tabularis

# Only errors and warnings
RUST_LOG=warn tabularis
```

The `RUST_LOG` directive supports `error`, `warn`, `info`, `debug`, and `trace` levels, with `info` being the default for production builds.

### What to Look for in Logs

When troubleshooting a connection issue, search the log file for entries related to the connection UUID:

```bash
grep "conn-" ~/Library/Logs/tabularis/tabularis.log | tail -50
```

SSH tunnel events are prefixed with `[ssh]`, database driver events with `[driver]`, and plugin events with `[plugin:<plugin-id>]`.

## Privacy & Telemetry

Tabularis is built with a strict zero-telemetry policy.

- **No analytics SDKs**: We do not embed Google Analytics, Mixpanel, Sentry (in production), or any third-party tracking library.
- **No crash reporting**: Panics are written to the local log file only. No automatic crash reports are sent anywhere.
- **No usage data**: Feature usage, query counts, session duration — none of this is tracked or transmitted.
- **Network requests made by Tabularis**:
  - Your configured database host(s)
  - `api.github.com/repos/debba/tabularis/releases/latest` (for update checks, if enabled)
  - Your chosen AI provider endpoint (only if AI is enabled and you trigger it)
  - Any URLs referenced in plugins you have installed

You can verify all outgoing network connections using `lsof -i` (macOS/Linux) or Resource Monitor (Windows) while the application runs.

## Resetting to Defaults

To reset all settings to factory defaults:
1. Close Tabularis completely.
2. Delete or rename the `config.json` file.
3. Relaunch Tabularis. A fresh `config.json` with all defaults will be created.

**Important**: This does NOT delete saved connections. Connection metadata is stored in a separate `connections.json` file in the same directory. To also remove connections, delete `connections.json`. Passwords stored in the OS keychain must be removed manually (via Keychain Access on macOS, Credential Manager on Windows, or `secret-tool` on Linux).
