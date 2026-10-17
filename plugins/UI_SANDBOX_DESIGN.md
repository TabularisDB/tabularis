# UI plugin sandbox design

## Boundary

Each UI extension module runs in a sandboxed `tabularis-plugin` iframe with
scripts enabled, same-origin access disabled, and a guest CSP that blocks
direct network connections. Google OAuth token exchange is the one network
operation proxied by the host to a fixed endpoint and fixed form-field
allow-list. The host and guest communicate over a transferred
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
- Plugin-authored React modals rendered inside that plugin's iframe.

The frame receives no connection credentials, filesystem interface, or generic
backend command proxy. Query results are available to the plugin that requested
them. Host callbacks such as `onDatabaseChange`, `setExtraField`, and
`setCredentialFieldsHidden` are represented by plain context data and
slot-specific RPC methods; functions are never sent through `postMessage`.

Most RPC requests time out after 30 seconds; plugin SQL queries may take up to
five minutes before the guest stops waiting. The host query is not cancelled
when the guest times out. Internal guest resources use reserved
`__runtime__.js` and `__host.css__` paths so plugin files named `runtime.js` or
`host.css` remain addressable.

## Plugin migration

Plugins continue to import hooks from `@tabularis/plugin-api`; rebuild against
API `0.3.0` and require host API `0.3.0`. `setSetting` and `setSettings` now
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

The published Tabularium catalogue currently has five plugins with UI slots:

| Plugin | Existing UI behavior | Sandbox compatibility |
| --- | --- | --- |
| [DynamoDB](https://github.com/TabularisDB/tabularis-dynamodb-plugin) | Extra connection fields via `setExtraField` | Supported through the slot callback RPC. |
| [Elasticsearch](https://github.com/TabularisDB/tabularis-elasticsearch-plugin) | Database field via `onDatabaseChange` | Supported through the slot callback RPC. |
| [Cloudflare D1](https://github.com/josejorge/tabularis_cloudflare_d1_plugin) | Help text, translations, and `openUrl` | Supported by the guest API, including the `defaultValue` translation fallback. |
| [SQL Server](https://github.com/TabularisDB/tabularis-sqlserver-plugin) | Extra field and credential visibility callbacks | Supported through the slot callback RPC. |
| [Google Sheets](https://github.com/TabularisDB/tabularis-google-sheets-plugin) | OAuth settings modal and database field | The slot APIs are supported; the OAuth code exchange must migrate from direct `fetch` to `exchangeGoogleOAuthToken` before upgrading to the sandboxed host. |

This audit is based on the public registry's plugin manifests and the UI source
in each linked plugin repository. The Google Sheets plugin needs a companion
release containing the OAuth migration before this sandbox change ships.
