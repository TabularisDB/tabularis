# Neon integration prototype

A Tabularis driver with native explorer services for an existing Neon project. Scaffolded
with the Tabularis CLI, then adapted to Node.js to use Neon's SDKs. Requires
Node.js 22+, pnpm, and the `feat/neon-integration` Core changes on upstream
Tabularis 0.30.0. The public 0.30.0 release alone does not yet include the new
`usePluginRpc` API (SDK package 0.4.0, runtime API 0.2.0).

## Build and install from this repository

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:plugin-api
cd plugins/neon
pnpm install --frozen-lockfile
pnpm --dir ui install --frozen-lockfile
pnpm build
pnpm test
pnpm --dir ui typecheck
pnpm --dir ui test
node scripts/install.mjs
```

`pnpm build` builds **both** the stdio runtime and the UI bundle. The installer
copies an explicit whitelist into the current `plugins/drivers/neon` directory,
including its runtime dependencies and UI, and excludes credentials. It refuses
to replace another installation. Restart Tabularis or re-enable Neon to load it.
The destination is a real directory: current Tabularis discovery ignores symlinks.

To produce a self-contained ZIP containing runtime dependencies and UI:

```sh
pnpm package
```

The ZIP still requires Node.js 22+ on the target machine. It does not contain a
Node runtime. It includes no `.env`, `.neon`, test accounts or checkout symlinks.
Release publication/signing is outside this prototype.

## Configure a connection

### Connect an existing Neon account

On **Connections**, click **Connect Neon**. Enter a Neon API key with access to
the intended organization/project. The key is stored in the host's secret store
(OS keyring on desktop), separately from database connections. Select the
organization, project, branch, database and role, then import the connection.
The host saves the SQL password and discovered service credentials internally;
the UI receives only the connection ID, display name and any warnings.

The importer discovers existing Auth, Storage, AI Gateway, Functions and Realtime
resources. It does not enable or deploy services. **Create service credentials**
is off by default. Enabling it explicitly creates one branch-scoped credential
for the enabled Storage/AI services; otherwise their endpoints are discovered
but those services still need a credential import. Existing Realtime secrets
can be retrieved without rotation. API permission failures appear as warnings.

Disconnecting the account removes the locally stored account key. Imported
connections retain their independent SQL/service access. It does not revoke the
remote API key or delete remote service credentials. One account credential is
stored per provider plugin in this prototype; replacing it does not modify
existing connections.

Neon's partner OAuth client is not available yet, so this entry uses an API key
and does not pretend to perform a Neon browser sign-in. A later OAuth connector
can use the same account/resource selection and host import interface.

### Import credentials manually

Select Neon in the connection picker and import its Postgres URL. SQL always
uses the saved connection's credentials and verified TLS. Expand **Neon** in the
Structure explorer and open a service. Each service has its own normal editor
tab, beside SQL consoles and tables. Reopening a service focuses its existing
tab; connection scope is preserved across reloads.

In **Connection / Setup**, paste a complete `.env` bundle or JSON object from
`neon env pull`. Saving **replaces** that connection's bundle in the host's secret
store (OS keyring on desktop). Omitted fields are removed; stored values cannot
be read back by the UI. Never place service tokens in ordinary plugin settings.

Required service variables:

- `NEON_BRANCH`
- `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`
- `NEON_FUNCTION_HELLO_BASE_URL`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`
- `NEON_AI_GATEWAY_TOKEN`, `NEON_AI_GATEWAY_BASE_URL`
- `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET`

Optional: `NEON_PROJECT_ID` and `NEON_API_KEY` enable project branch listing.
A project API key is distinct from a branch service credential. Native account
OAuth requires Neon's partner registration and is not fabricated here. Branch
creation/switching is not implemented. Account import selects a branch and saves
a separate connection; manually pasted SQL/service credentials must refer to
the same intended branch.

The repository's `.env.local` is only used by explicit local CLI/test runs.
Host-scoped service calls never fall back to it. Generic extension calls and secret writes require LocalAdmin authorization in the web transport; stored field names require database access. SQL credentials are derived
from the active saved connection, not a pasted `DATABASE_URL`.

### Local prototype data and Linux development connection

The existing project is `solitary-leaf-07190439`, branch `production`. The
configuration in `neon.ts` preserves all six services and includes the demo's
protected analysis Function. To provision/update it:

```sh
neon init -y --org-id org-empty-pine-21623834 --project-id solitary-leaf-07190439 --branch production --services postgres,auth,ai-gateway,object-storage,functions,realtime
neon deploy --update-existing
```

See [the demo](../../examples/neon-demo/README.md) before running its schema and
seed commands. No existing application schemas are dropped.

On Linux, after pulling the local environment, `pnpm dev:setup` uses `secret-tool`
to save the DB password and service bundle in the OS keyring and adds
**Neon Lab · production** to `connections.dev.json`. It preserves other development
connections and leaves the release `connections.json` alone. For other platforms,
use the connection picker and panel to import credentials.

## Supported prototype features

- SQL editor, multi-statement result sets, row insert/update/delete, introspection
  of databases, schemas, tables, columns, indexes, foreign keys, views and routines.
- Visual EXPLAIN through the shared `@tabularis/explain` parser; `ANALYZE` runs only
  when explicitly requested by the host.
- Workspace sections: service overview, demo SQL data, project Auth users, private Storage,
  AI model catalog/completions, deployed hello Function, bounded live SQL snapshot
  tests, and connection setup. All panel text has English/German translations.
- Realtime waits run concurrently with SQL through the same process; subscriptions
  close on completion or after 30 seconds. Workspace content unmounts when backgrounded or closed and discards stale UI results. Closing it does not immediately cancel an in-flight backend call.

Dedicated table/column DDL management stays hidden (`manage_tables: false`).
Unsupported methods return JSON-RPC `-32601`. Pagination currently materializes
results before slicing, and each SQL request opens its own TLS connection; use
the mature Postgres driver for large exports and session-dependent workflows.
View/routine creation and alteration are not advertised. Auth user listing is
administrative inspection; the separate demo implements end-user sign-in.

## Reusable Core integration

The generic `usePluginAccount` API and `connections.actions` slot let a provider
connect before any database connection exists. The administrator-only Core
account command separates account credentials from connection service bundles,
reserves the secret-bearing import method, and imports credentials atomically
without a plaintext fallback when the secret store fails.

The Core owns `PluginExplorerSection` (native collapsible explorer entries),
`usePluginWorkspace` (connection-scoped service tabs), `PluginWorkspaceShell`
(compact native toolbar/content layout), and `PluginDataGrid` (the real native
read-only grid with the user's copy/privacy settings). `explorer.services` and
owner-filtered `editor.workspace.content` connect those pieces. RPC transport
and credential storage remain shared with other plugins. Service tabs never
execute SQL or show SQL toolbars/results; only safe metadata is persisted.

Neon supplies its sections, small provider mark and service implementations.
There is no colored launch card, provider hero, or second navigation inside a
tab. Auth, Storage, AI and the other entries live directly in the same explorer
as schemas/tables. The former `services` workspace ID still opens Overview.

Supabase, Firebase RTDB, Appwrite or other plugins can reuse these Core pieces
with their own sections and APIs. The workspace UI requires no SQL-shaped
service contract. Those provider integrations are not implemented here.

## Verification

```sh
pnpm test
pnpm test:e2e
pnpm test:scoped
pnpm test:host
# Read-only real account/import checks; uses an existing API key:
NEON_API_KEY=... node tests/account-host-e2e.mjs
```

E2E tests launch the real stdio executable. They cover SQL/metadata/CRUD/EXPLAIN,
Auth signup/signin/session/signout, Storage upload/list/download/delete, AI model
catalog and real completion, the deployed Function, and a live subscription
observing an UPDATE **through the same plugin process**. Test resources have
unique names and are cleaned up. `test:scoped` exercises the Core RPC envelope
against all six services and proves missing scoped credentials cannot use the
process-wide environment. E2E makes a small billable AI request.

`test:host` additionally starts the real compiled Core web server with an isolated encrypted secret store, authenticates, saves a connection, exercises all services through HTTP RPC, verifies credential clearing on retargeting, and opens the actual Tabularis Neon main tab in Chrome, checks focus deduplication, return to SQL, persisted restoration and responsive layout. Build the Core and frontend first (`cargo build --manifest-path src-tauri/Cargo.toml`, `pnpm build`); Chrome and the root Playwright dependency must be installed. The test cleans its temporary connection/store.

The demo adds browser/API tests, cross-user denials and real live updates. Its
README documents the Vercel environment and exact trusted-origin setup.
