# UI plugin sandbox design

## Boundary

Each UI extension module runs in a sandboxed `tabularis-plugin` iframe with
scripts enabled, same-origin access disabled, and a guest CSP that blocks
plugin `fetch`/XHR connections. CSP does not prevent a plugin from navigating
its own iframe, but the sandbox prevents top-level navigation and grants no
same-origin access. Google OAuth token exchange is the one network operation
proxied by the host to a fixed endpoint and fixed form-field allow-list. The
host and guest communicate over a transferred
`MessagePort`. Host requests are checked against an explicit method allow-list;
there is no generic Tauri command or `invoke` method in the guest API.

## Exposed capabilities

- Slot context, active connection metadata, theme data, and the plugin's own
  settings and translations.
- SQL on the currently active connection. The host rejects statements the
  Rust classifier does not identify as read-only, and supported built-in
  drivers also run each query inside a database-enforced read-only context.
  Drivers without that capability fail closed. This does not replace
  read-only database credentials against unusual side-effecting functions.
- Writes to the calling plugin's own JSON settings, capped at 64 KiB per value.
- Non-modal info, warning, and error toasts; opening HTTP(S) URLs without URL
  credentials.
- Plugin-authored React modals rendered inside that plugin's iframe. While a
  modal is open, the host promotes that iframe to a full-viewport overlay so
  modal content is not clipped by the inline slot height.

The frame receives no connection credentials, filesystem interface, or generic
backend command proxy. Query results are available to the plugin that requested
them. Host callbacks such as `onDatabaseChange`, `setExtraField`,
`setCredentialFieldsHidden`, and `setSecretField` are represented by plain
context data and slot-specific RPC methods; functions are never sent through
`postMessage`. Secret-field keys and values are validated on the host.

Most RPC requests time out after 30 seconds; plugin SQL queries may take up to
five minutes before the guest stops waiting. The host query is not cancelled
when the guest times out. Internal guest resources use reserved
`__runtime__.js` and `__host.css__` paths so plugin files named `runtime.js` or
`host.css` remain addressable.

## Plugin migration

Plugins continue to import hooks from `@tabularis/plugin-api`; rebuild against
API `0.4.0` and require host API `0.4.0`. A restricted `getHost()` shim
remains available to older bundles and returns only the guest API facade.
`setSetting` and `setSettings` now
return promises, so await them when subsequent work depends on persistence.
Modals remain React-based, but render within the plugin iframe rather than the
host React tree. Translation lookup supports dotted keys and `{{name}}`
interpolation; plugins that rely on advanced i18next features need to provide
their own formatting or simplify those entries. `openUrl` accepts only HTTP(S)
URLs and rejects embedded credentials. Replace direct Google token-endpoint
`fetch` calls with `exchangeGoogleOAuthToken`; other guest network requests
remain blocked. `usePluginQuery` uses the Rust query classifier and a
database-enforced read-only execution path for built-in SQLite, PostgreSQL,
and MySQL drivers. Drivers that do not support that mode reject plugin queries.
The Google OAuth exchange is currently restricted to the `google-sheets`
plugin id.

## Related connection-export hardening

This branch also changes connection export: secrets are omitted by default,
and requesting them requires native confirmation. The backup flow uses the
separate internal `export_connections_payload_unconfirmed` path only after its
own explicit backup action. This is related credential-exposure hardening, but
it is separate from the iframe RPC boundary.

Plugins must not import Tauri APIs or use `window.__TAURI__` directly. The host
injects `__TABULARIS_API__` only in the guest frame; `__TABULARIS_EXPLAIN__` is
also available there for EXPLAIN parser bundles.

## Published UI plugin compatibility audit

The published Tabularium catalogue audit covers seven plugins with UI slots or
EXPLAIN parsers:

| Plugin | Existing UI behavior | Sandbox compatibility |
| --- | --- | --- |
| [DynamoDB](https://github.com/TabularisDB/tabularis-dynamodb-plugin) | Extra connection fields via `setExtraField` | Supported through the slot callback RPC. |
| [Elasticsearch](https://github.com/TabularisDB/tabularis-elasticsearch-plugin) | Database field via `onDatabaseChange` | Supported through the slot callback RPC. |
| [Cloudflare D1](https://github.com/josejorge/tabularis_cloudflare_d1_plugin) | Help text, translations, and `openUrl` | Supported by the guest API, including the `defaultValue` translation fallback. |
| [SQL Server](https://github.com/TabularisDB/tabularis-sqlserver-plugin) | Extra field, credential visibility callbacks, and custom EXPLAIN parser | UI callbacks use the slot RPC; the parser loads in the sandbox. |
| [Google Sheets](https://github.com/TabularisDB/tabularis-google-sheets-plugin) | OAuth settings modal and database field | Companion PR uses `exchangeGoogleOAuthToken` and requires Tabularis 0.29.0. A restricted `getHost()` compatibility shim keeps the released 0.3.0 bundle working during migration. |
| Google BigQuery 0.2.0 | `connection-modal.extra_fields`; hides Password and stores its credential with `setSecretField`; custom EXPLAIN parser | Supported after forwarding `secretFields` and `setSecretField` over validated slot RPC; parser loads in the sandbox. |
| Oracle | Custom EXPLAIN parser | Released parser bundle loads in the sandbox. |

This audit is based on the public registry's plugin manifests and released
bundles for UI extensions and EXPLAIN parsers. The Google Sheets companion
release must ship before this sandbox change so existing installs keep working.
