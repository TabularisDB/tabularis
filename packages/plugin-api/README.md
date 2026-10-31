# @tabularis/plugin-api

Public API surface for [Tabularis](https://github.com/TabularisDB/tabularis) plugin UI extensions.

Plugin bundles import hooks, the `defineSlot` helper, and shared types from this package. The Tabularis host injects the actual runtime implementation — the published package ships as thin stubs, so your bundle stays small and the host remains the single source of truth.

## Install

```bash
npm install --save-dev @tabularis/plugin-api
# or: pnpm add -D @tabularis/plugin-api
```

Treat `@tabularis/plugin-api` and `react` as Vite externals when building your IIFE bundle — the host provides both at runtime.

## Quick start — a typed slot component

```tsx
import { defineSlot, usePluginConnection } from "@tabularis/plugin-api";

const MySlot = defineSlot(
  "row-editor-sidebar.field.after",
  ({ context }) => {
    const { driver } = usePluginConnection();
    // context.columnName is `string` (not `string | undefined`) because the
    // chosen slot always provides it.
    return <div>{driver} · {context.columnName}</div>;
  },
);

export default MySlot.component;
```

## Hooks

| Hook | Returns | Purpose |
|------|---------|---------|
| `usePluginAccount(pluginId)` | `{ connect, secretFields, disconnect, call, importConnection }` | Provider account onboarding before a database connection exists |
| `usePluginRpc(pluginId, connectionId?)` | `{ call, saveSecrets, secretFields, deleteSecrets }` | Connection-scoped services and write-only secret storage |
| `usePluginQuery()` | `{ executeQuery, loading, error }` | Execute read-only queries on the active connection |
| `usePluginConnection()` | `{ connectionId, driver, schema }` | Active connection metadata |
| `usePluginToast()` | `{ showInfo, showError, showWarning }` | System notifications |
| `usePluginWorkspace(pluginId)` | `{ openWorkspace({id, title, connectionId?}) }` | Open or focus a connection-bound main editor workspace |
| `usePluginModal()` | `{ openModal, closeModal }` | Host-managed modal with custom content |
| `usePluginSetting(pluginId)` | `{ getSetting, setSetting, setSettings }` | Read/write the plugin's own settings |
| `usePluginTheme()` | `{ themeId, themeName, isDark, colors }` | Current theme tokens |
| `usePluginTranslation(pluginId)` | `t(key)` | Plugin-scoped i18next translator |
| `openUrl(url)` | `Promise<void>` | Open a URL in the system browser |

All hooks must run inside a React component loaded by Tabularis. Calling them outside the host throws a clear error instead of failing silently.

## Provider account connections

`connections.actions` mounts provider-owned actions beside Add Connection and supplies
`onConnectionCreated()`. Use `usePluginAccount(pluginId)` there to store account
credentials in the host secret store, list safe account metadata, and import a
connection without returning SQL passwords or service secrets to UI code. A single
account bundle is stored per provider. All account operations require `local-admin`
authorization in the web host.

`connect(secrets)` replaces the provider's account bundle, `secretFields()` returns
names only, and `disconnect()` removes it. `call(method, args)` sends a trusted
plugin process an account-scoped extension envelope. `importConnection(args)` calls
its `account_import` method and lets the host save the returned connection and
service credentials, returning only `{id, name, warnings}`. The hook refreshes shared
connection state after import, including when launched from Settings. The optional
`onConnectionCreated()` callback lets an entry point refresh additional local state. Disconnecting an
account does not revoke remote credentials or remove previously imported connections.

## Connection-scoped plugin services

`usePluginRpc` uses the active saved connection unless an explicit connection ID is supplied. The host checks that the enabled external plugin owns that connection and sends its resolved saved parameters and stored secrets only to that plugin process. The UI cannot supply connection credentials in the envelope or read stored secret values.

```tsx
const services = usePluginRpc("my-plugin");
await services.saveSecrets({ API_TOKEN: token });
const configuredFields = await services.secretFields(); // ["API_TOKEN"], never values
const result = await services.call<{ ready: boolean }>("service_status");
await services.deleteSecrets();
```

The driver receives JSON-RPC method `extension` with `{ method, args, params, secrets, context: { plugin_id, connection_id } }`. Extension methods must be namespaced identifiers, and arguments must be an object of at most 1 MiB. Secret bundles contain 1–64 nonempty string fields, totaling at most 64 KiB. Saving replaces the complete bundle.

In the web host, extension calls and secret writes/deletion require `local-admin` authorization because opaque plugin methods may mutate resources. Listing configured field names requires `database` authorization. Both desktop and browser UI use the same typed host client.

## Compatibility

The package exports `API_VERSION` and `MIN_HOST_VERSION`. Declare `API_VERSION` as `api_version` on each manifest `ui_extensions` entry so the host can reject incompatible bundles before executing them. Plugin authors can also opt in to a fail-fast compatibility check at component entry:

```ts
import { assertHostCompat } from "@tabularis/plugin-api";
assertHostCompat(); // throws if the running Tabularis is older than MIN_HOST_VERSION
```

| Package version | Minimum host API | Notes |
|-----------------|-------------------|-------|
| `0.1.0`         | `0.1.0` | Initial release |
| `0.1.1`         | `0.1.0` | Typed slots and automatic manifest compatibility gate |
| `0.4.0`         | `0.2.0` | Connection-scoped extension calls and secret storage |

## Slot reference

See the full slot list and context contracts in [`plugins/PLUGIN_GUIDE.md` § 3b](https://github.com/TabularisDB/tabularis/blob/main/plugins/PLUGIN_GUIDE.md) and the typed `SlotContextMap` in `src/slots.ts`.

## License

Apache-2.0, same as Tabularis.

## Provider workspaces

Register an `editor.workspace.content` slot and open it from a connection action:

```tsx
const {openWorkspace} = usePluginWorkspace("my-plugin");
openWorkspace({id: "services", title: "My provider", connectionId: context.connectionId});
```

Only the owning plugin's contributions render. The same workspace and connection
focus the existing tab; other connections are isolated. `connectionId` must match
the active slot and editor connection; the hook throws on a mismatch. IDs and tab
metadata are persisted, never React content or runtime service state. Avoid secrets
in IDs and titles. Content unmounts when backgrounded or closed: effect cleanup
must cancel polling, subscriptions and pending requests. Use
`usePluginRpc(pluginId, context.connectionId)` for stable service binding.

Use `PluginExplorerSection` in `explorer.services` with `pluginId`, `providerName`,
optional `connectionId`/`icon`/`disabled`, and `items: [{id, label, icon?}]`. Each
service opens a separate native main tab titled `Provider · Service`; repeated
clicks focus it. Supported icons: `overview`, `database`, `users`, `storage`,
`functions`, `ai`, `realtime`, `settings`, `documents`, `security` (unknown: document).

`PluginWorkspaceShell` renders a compact native header and full-width scrolling
content. Pass a title, optional subtitle/icon/actions, and children. Internal tabs
are optional; existing `tabs`, `activeTab`, `onTabChange` callers remain supported.
Optional `brandColor` only affects their navigation indicator.

`PluginDataGrid` uses the actual host read-only grid with `columns: string[]`,
`rows: unknown[][]`, optional `connectionId: string | null`, and optional `label`.
It provides native copy settings and column resizing in a bounded view, without
mutation callbacks or SQL generation. `PluginConnectionAction` remains supported.
