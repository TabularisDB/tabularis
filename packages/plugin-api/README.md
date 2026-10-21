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
| `usePluginQuery()` | `{ executeQuery, loading, error }` | Execute classified read-only SQL on supported built-in drivers; unsupported drivers reject the call |
| `usePluginConnection()` | `{ connectionId, driver, schema }` | Active connection metadata |
| `usePluginToast()` | `{ showInfo, showError, showWarning }` | System notifications |
| `usePluginModal()` | `{ openModal, closeModal }` | Modal with custom React content rendered inside the plugin iframe |
| `usePluginSetting(pluginId)` | `{ getSetting, setSetting, setSettings }` | Read/write the plugin's own settings |
| `usePluginTheme()` | `{ themeId, themeName, isDark, colors }` | Current theme tokens |
| `usePluginTranslation(pluginId)` | `t(key)` | Plugin-scoped i18next translator |
| `openUrl(url)` | `Promise<void>` | Open a URL in the system browser |
| `exchangeGoogleOAuthToken(request)` | `Promise<GoogleOAuthTokenResponse>` | Exchange or refresh Google OAuth tokens through the fixed Google token endpoint |

Plugin UI runs in a sandboxed iframe and has no direct Tauri `invoke` access.
The host exposes only the operations represented by these APIs. The guest CSP
blocks plugin `fetch`/XHR connections; it does not prevent the iframe from
navigating itself. Google OAuth is proxied to one fixed endpoint, with an
allow-list of form fields. Modal content stays inside the plugin iframe, and
the host expands that iframe to a full-viewport overlay while the modal is open.
Setting writes are asynchronous; await `setSetting` or `setSettings` when
subsequent work depends on persistence.

`usePluginQuery` rejects statement types that the host classifier recognizes as
writes. The host repeats this check with its Rust classifier and runs the query
in a database-enforced read-only context for built-in SQLite, PostgreSQL, and
MySQL drivers. Drivers that do not support this mode reject the call. Use
read-only database credentials as an additional safeguard, especially when
the database exposes custom side-effecting functions. The API returns all rows
provided by the driver; it does not silently cap results at 100 rows. Add a
`LIMIT` clause when a plugin only needs a bounded result set.

For a Google OAuth token exchange, import `exchangeGoogleOAuthToken` and pass
the form fields needed for an `authorization_code` or `refresh_token` grant.
The host fixes the destination to `https://oauth2.googleapis.com/token`; plugins
cannot choose a URL or HTTP method. Replace direct `fetch` token exchanges with
this API when migrating an OAuth UI extension.

All hooks must run inside a React component loaded by Tabularis. Calling them outside the host throws a clear error instead of failing silently.

## Compatibility

The package exports `API_VERSION` and `MIN_HOST_VERSION`. Plugin authors can opt in to a fail-fast compatibility check at component entry:

```ts
import { assertHostCompat } from "@tabularis/plugin-api";
assertHostCompat(); // throws if the running Tabularis is older than MIN_HOST_VERSION
```

| Package version | Minimum Tabularis API | Notes |
|-----------------|-----------------------|-------|
| `0.3.0`         | `0.3.0` | Sandboxed UI API and callback RPC |
| `0.4.0`         | `0.4.0` | Secret-field slot callback and fixed Google OAuth exchange |

## Slot reference

See the full slot list and context contracts in [`plugins/PLUGIN_GUIDE.md` § 3b](https://github.com/TabularisDB/tabularis/blob/main/plugins/PLUGIN_GUIDE.md) and the typed `SlotContextMap` in `src/slots.ts`.

## License

Apache-2.0, same as Tabularis.
