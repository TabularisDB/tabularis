# Plan — Web UI feature parity via `tabularis web`

## 1. Goal

Deliver a browser-based Tabularis UI with functional parity with the desktop application while preserving one implementation of business logic.

Target user experience:

```bash
tabularis web
# Tabularis Web is available at http://127.0.0.1:8080
```

The implementation will live on the long-running branch `feat/web-ui`. The existing React application will ultimately become the workspace package `packages/web-ui`; it will remain the single UI used by both Tauri and browsers.

### Success criteria

- `tabularis` continues to launch the desktop application.
- `tabularis web` starts an HTTP server and serves `packages/web-ui/dist` without creating a desktop window.
- Desktop and web use the same React components, contexts, hooks, types, translations, and styles.
- Tauri IPC and HTTP/WebSocket are transport adapters over the same Rust application services.
- Database drivers, connection management, persistence, credentials, plugins, AI, imports, exports, and query logic are not duplicated.
- Every desktop capability is classified as:
  - **identical**: same behavior in desktop and web;
  - **web-adapted**: equivalent browser workflow;
  - **not applicable**: desktop-only lifecycle behavior with a documented web replacement.
- Tests verify the same API contract through both transports.
- Remote network exposure is opt-in and protected by authentication.

## 2. Verified baseline

Current repository facts relevant to this plan:

- React 19, TypeScript, Vite, and Tauri 2 are already used.
- The pnpm workspace already includes `packages/*`.
- The frontend currently lives in root `src/` and builds to root `dist/`.
- The Tauri application registers approximately 255 Rust commands.
- The frontend references 224 distinct `invoke()` command names across approximately 362 call sites.
- 85 frontend files import `@tauri-apps/api/core` directly.
- 106 frontend files import at least one `@tauri-apps/*` API.
- Native dependencies include IPC, events, windows, dialogs, filesystem access, clipboard access, notifications, updater, deep links, and URL opening.
- The CLI already supports `--mcp`, `--debug`, and `--explain` in `src-tauri/src/cli.rs`.
- Startup, driver registration, state registration, plugin loading, schedulers, and the full Tauri command registry are currently concentrated in `src-tauri/src/lib.rs::run`.
- Existing frontend coverage is substantial, and Rust has dedicated test modules for major backend areas.

This makes a visual rewrite unnecessary. The primary work is platform separation and backend transport extraction.

## 3. Non-goals and constraints

### Non-goals

- Do not create a second React implementation.
- Do not maintain separate desktop and web business rules.
- Do not expose raw database credentials to the browser.
- Do not make internet-facing access the default.
- Do not reproduce desktop-only window chrome in a browser when a route or browser tab is equivalent.
- Do not convert all command APIs to REST resources. A command/RPC contract is a better fit for existing semantics and avoids duplicate endpoint modeling.

### Constraints

- Code, comments, and repository documentation remain in English.
- `pnpm` remains the only JavaScript package manager.
- No explicit TypeScript `any`.
- Existing React hook and Fast Refresh rules remain mandatory.
- Desktop compatibility must remain green after every task.
- Existing data locations and migrations must be preserved.

## 4. Target architecture

```text
                         packages/web-ui
                    ┌────────────────────────┐
                    │ Shared React UI        │
                    │                        │
                    │ TabularisClient        │
                    │ PlatformCapabilities   │
                    └───────────┬────────────┘
                                │
                 ┌──────────────┴──────────────┐
                 │                             │
       TauriTransport                 HttpWsTransport
       TauriCapabilities              BrowserCapabilities
                 │                             │
                 └──────────────┬──────────────┘
                                │
                     Shared command contract
                                │
                    ┌───────────┴───────────┐
                    │ Rust application API │
                    │ services + domain    │
                    └───────────┬───────────┘
                                │
         drivers / pools / persistence / keychain / plugins / AI
```

### 4.1 `packages/web-ui`

`packages/web-ui` is not a second UI. The current root frontend is moved there after transport boundaries are established.

Proposed structure:

```text
packages/web-ui/
├── package.json
├── index.html
├── vite.config.ts
├── vitest.config.ts
├── tsconfig*.json
├── public/
└── src/
    ├── api/
    │   ├── client.ts
    │   ├── contract.ts
    │   ├── errors.ts
    │   ├── events.ts
    │   └── transports/
    │       ├── tauriTransport.ts
    │       └── httpTransport.ts
    ├── platform/
    │   ├── capabilities.ts
    │   ├── tauriCapabilities.ts
    │   └── browserCapabilities.ts
    ├── components/
    ├── contexts/
    ├── hooks/
    ├── i18n/
    ├── pages/
    ├── themes/
    ├── types/
    └── utils/
```

The root package remains a workspace orchestrator. Root scripts delegate to `@tabularis/web-ui` and `src-tauri`.

### 4.2 Frontend API boundary

Replace direct calls such as:

```ts
invoke<QueryResult>("execute_query", payload)
```

with one typed client:

```ts
client.call("execute_query", payload)
```

The command name and request/result types are defined once in a `CommandMap`. Both transports implement the same interface:

```ts
interface TabularisTransport {
  call<K extends CommandName>(
    command: K,
    payload: CommandMap[K]["request"],
  ): Promise<CommandMap[K]["response"]>;

  subscribe<K extends EventName>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): Promise<Unsubscribe>;
}
```

Temporary compatibility is allowed: `TauriTransport.call()` may delegate directly to `invoke()` while callers are migrated. No component should select a transport itself.

### 4.3 Rust application boundary

Tauri commands currently contain a mix of transport concerns and business logic. Migrate incrementally to:

```text
transport/tauri -> application service <- transport/web
```

Proposed backend modules:

```text
src-tauri/src/
├── application/
│   ├── context.rs
│   ├── connections.rs
│   ├── queries.rs
│   ├── metadata.rs
│   ├── persistence.rs
│   ├── plugins.rs
│   ├── ai.rs
│   └── ...
├── runtime/
│   ├── bootstrap.rs
│   ├── events.rs
│   ├── paths.rs
│   ├── secrets.rs
│   └── state.rs
└── transport/
    ├── tauri/
    └── web/
        ├── auth.rs
        ├── events.rs
        ├── rpc.rs
        ├── static_assets.rs
        └── server.rs
```

Do not perform a big-bang move. Extract one capability group at a time. Existing public Tauri command names remain stable and become thin wrappers.

### 4.4 Web protocol

Use a versioned command RPC instead of creating hundreds of unrelated REST routes:

```http
POST /api/v1/rpc/execute_query
Content-Type: application/json
Authorization: Bearer <session-token>
```

Response envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "QUERY_FAILED",
    "message": "...",
    "details": null,
    "requestId": "..."
  }
}
```

Additional endpoints:

- `GET /healthz`: process liveness only, no sensitive data.
- `GET /api/v1/session`: session and capability negotiation.
- `GET /api/v1/events`: WebSocket connection for events and progress.
- `POST /api/v1/uploads`: browser upload to an opaque temporary file token.
- `GET /api/v1/downloads/:token`: single-use or expiring download.
- `GET /assets/plugins/...`: authenticated plugin UI assets with strict CSP.
- `GET /*`: static UI assets with SPA fallback to `index.html`.

### 4.5 Platform capabilities

Native operations must be represented by semantic capabilities rather than imported directly in components:

- `chooseInputFile()`
- `chooseSaveTarget()`
- `readClipboard()` / `writeClipboard()`
- `downloadFile()`
- `openExternalUrl()`
- `notify()`
- `openRoute()` / `closeRoute()`
- `requestAttention()`
- `restartApplication()`

Desktop implementations use Tauri plugins. Browser implementations use browser APIs, upload/download tokens, routes, and tabs. Unsupported capabilities are explicitly reported by session negotiation; they must not fail through missing globals.

## 5. Security model

### 5.1 Defaults

```bash
tabularis web
```

means:

- bind to `127.0.0.1`;
- choose port `8080`, or the next free port if explicitly configured to allow fallback;
- generate an ephemeral high-entropy session token;
- open a URL containing a one-time bootstrap token;
- exchange the bootstrap token for an HttpOnly, SameSite=Strict session cookie;
- redact tokens from logs;
- reject cross-origin requests.

### 5.2 Remote mode

Binding to a non-loopback interface must require an explicit option:

```bash
tabularis web --host 0.0.0.0 --auth password
```

Remote mode acceptance requirements:

- password or external reverse-proxy authentication is mandatory;
- TLS is required directly or documented as a reverse-proxy requirement;
- allowed origins are explicit;
- secure cookies are enabled under TLS;
- login attempts are rate-limited;
- database, SSH, K8s, plugin, filesystem, MCP, and AI operations are authorization-scoped;
- audit logs identify session and request IDs without recording secrets or full SQL result payloads.

Remote mode should be implemented after local parity, not as part of the first MVP.

### 5.3 Filesystem safety

Browser-provided paths are never trusted as server paths. Import flows use uploaded temporary files. Export flows use generated download tokens. Any optional server-side path access requires a separate local/admin capability and canonical path validation.

## 6. Feature-parity matrix

The matrix is a tracked artifact in the branch. Every row must end with automated tests and a manual check.

| Area | Web behavior | Parity type | Primary transport needs |
|---|---|---|---|
| Application startup | `tabularis web`, static serving, browser open | Adapted | CLI/HTTP |
| Remote access | Password or trusted-proxy authentication, HTTPS origin allowlist, restricted-by-default capability policy | Adapted/security-scoped | CLI/HTTP/audit |
| Connections and groups | Full CRUD, tags, icons, duplicate/import/export | Identical/adapted files | RPC/upload/download |
| MySQL/PostgreSQL/SQLite | Existing drivers and pools | Identical | Shared services |
| SSH tunnels and askpass | Prompt delivered to active authorized web session | Adapted | RPC/WebSocket |
| K8s tunnels | Existing backend commands and progress | Identical | RPC/WebSocket |
| Schema explorer | Databases, schemas, tables, views, routines, triggers | Identical | RPC |
| SQL editor | Execute, batch, count, cancel, history, saved queries | Identical | RPC/WebSocket |
| Results/data grid | Edit, insert, delete, blobs, referenced records | Identical/adapted files | RPC/upload/download |
| Multiple result windows | Browser route/tab with session ID | Adapted | Routes/RPC/events |
| ER/schema diagram | Browser route/tab and download | Adapted | RPC/download |
| Views/routines/triggers | Existing create/edit/drop behavior | Identical | RPC |
| User management | Existing users/grants/privileges behavior | Identical | RPC |
| Notebooks | CRUD, execution, import/export, charts | Identical/adapted files | RPC/upload/download |
| Dump/import | Server-side jobs, browser upload/download, progress | Adapted | RPC/events/streaming |
| Clipboard import | Browser clipboard permission and shared parser/backend | Adapted | Browser capability/RPC |
| AI features | Queries, explanations, plans, names, approvals/activity | Identical | RPC/WebSocket |
| Settings/keybindings/themes | Same persisted settings and custom themes | Identical | RPC |
| Credentials/keychain | Secrets remain backend-side | Identical security outcome | Shared secret service |
| Plugin drivers | Existing subprocess/JSON-RPC backend | Identical | Shared services |
| Plugin registry/install | Existing registry and installer with progress | Identical | RPC/WebSocket |
| Plugin UI extensions | Authenticated asset loading and same host API | Adapted loader | Static assets/CSP |
| Logs/task manager | Same backend information and actions | Identical | RPC/events |
| Backups | Same scheduler and manual execution | Identical/adapted files | RPC/download |
| MCP configuration | Local host operation only; hidden/blocked remotely by default | Adapted/security-scoped | RPC |
| Deep links | Browser URL or explicit install route | Adapted | Routing |
| Updater | Desktop updater; web shows server version/upgrade guidance | Not applicable/adapted | Capability flag |
| DevTools/window title | Browser-native behavior | Not applicable | Capability flag |
| Performance and resilience | Bounded RPC, results, events, transfers, jobs, sessions, and recovery paths | Identical/adapted lifecycle | RPC/events/runtime/CI |

## 7. Standard task loop

Run this loop for **every task**, including migration tasks. A task is not complete until the loop closes.

### LOOP-01 — Select and baseline

1. Select exactly one task ID from this plan.
2. Confirm `git status` and do not include unrelated changes.
3. Pull/rebase `feat/web-ui` on the agreed base.
4. Re-run GitNexus analysis if stale.
5. Record affected symbols and current behavior.
6. Run focused baseline tests before changing code.

### LOOP-02 — Impact and contract

1. Run upstream impact analysis for every existing symbol to be edited.
2. Report HIGH or CRITICAL risk before editing.
3. Write or update the command/capability contract first.
4. Add a failing test for the desired behavior.
5. Define desktop and web acceptance criteria.

### LOOP-03 — Implement minimally

1. Implement the smallest vertical change.
2. Keep the Tauri command name and payload backward compatible unless the task explicitly versions the contract.
3. Extract shared logic before adding the web adapter.
4. Do not copy existing business logic into the HTTP handler.
5. Keep feature flags or capability checks explicit.

### LOOP-04 — Verify

Run, as applicable:

```bash
pnpm typecheck
pnpm lint
pnpm test --run <focused-test>
pnpm --filter @tabularis/web-ui build
pnpm test:rust
pnpm build
```

For transport tasks, run the same contract test against Tauri mocks and the real HTTP test server.

### LOOP-05 — Inspect and commit

1. Run GitNexus change detection against `main` and inspect affected flows.
2. Review `git diff --check` and the complete task diff.
3. Update the parity matrix and task status.
4. Add manual-test evidence where required.
5. Create one conventional commit for the task.
6. Push `feat/web-ui` and continue only from a green state.

Suggested commit format:

```text
feat(web): add typed RPC transport
refactor(api): extract shared query service
feat(web): adapt notebook downloads
```

### Definition of done for each migrated command group

- No direct business logic exists in the HTTP transport.
- Desktop tests still pass.
- Web contract tests pass.
- Request and response types are explicit.
- Errors use the shared error envelope.
- Events are tested where relevant.
- Authorization requirements are declared.
- Feature matrix status is updated.
- No new direct Tauri import is introduced outside Tauri adapters.

## 8. Branch and delivery strategy

### Initial branch setup

Do not create the branch from a dirty working tree. The current checkout has an unrelated modification to `AGENTS.md`; preserve it outside this feature branch before starting.

```bash
git status --short
git switch main
git pull --ff-only
git switch -c feat/web-ui
```

If the existing local change belongs elsewhere, commit it on its own branch or stash it before creating `feat/web-ui`.

### Integration strategy

- Keep `feat/web-ui` buildable after every commit.
- Use small vertical commits instead of one final migration commit.
- Merge/rebase `main` regularly because the branch is expected to be long-lived.
- Hide incomplete web functionality behind capability negotiation, not scattered environment checks.
- Do not merge until desktop CI, web CI, Rust tests, security tests, and the agreed parity gate pass.
- If the branch becomes too large for review, open stacked PRs from milestone branches into `feat/web-ui`, then one final PR from `feat/web-ui` into `main`.

## 9. Execution backlog

Each backlog item lives in a separate file under `../tasks/`. The task runner
uses `../tasks/PROGRESS.md` as the completion ledger and skips validated
`COMPLETED` tasks unless `--force` is supplied.

| Phase | Task |
|---|---|
| Phase 0 — Governance and measurable baseline (3–5 days) | [WEB-000 — Create `feat/web-ui`](../tasks/WEB-000.md) |
| Phase 0 — Governance and measurable baseline (3–5 days) | [WEB-001 — Generate the API inventory](../tasks/WEB-001.md) |
| Phase 0 — Governance and measurable baseline (3–5 days) | [WEB-002 — Add architecture decision records](../tasks/WEB-002.md) |
| Phase 1 — Frontend transport seam (8–12 days) | [WEB-010 — Define typed command and event contracts](../tasks/WEB-010.md) |
| Phase 1 — Frontend transport seam (8–12 days) | [WEB-011 — Add `TabularisClientProvider`](../tasks/WEB-011.md) |
| Phase 1 — Frontend transport seam (8–12 days) | [WEB-012 — Define platform capabilities](../tasks/WEB-012.md) |
| Phase 1 — Frontend transport seam (8–12 days) | [WEB-013 — Migrate a representative vertical slice](../tasks/WEB-013.md) |
| Phase 1 — Frontend transport seam (8–12 days) | [WEB-014 — Enforce frontend boundaries](../tasks/WEB-014.md) |
| Phase 2 — Create `packages/web-ui` without duplication (5–8 days) | [WEB-020 — Scaffold workspace package](../tasks/WEB-020.md) |
| Phase 2 — Create `packages/web-ui` without duplication (5–8 days) | [WEB-021 — Move frontend source and assets](../tasks/WEB-021.md) |
| Phase 2 — Create `packages/web-ui` without duplication (5–8 days) | [WEB-022 — Make routing server-safe](../tasks/WEB-022.md) |
| Phase 3 — Headless backend bootstrap (8–12 days) | [WEB-030 — Extend CLI](../tasks/WEB-030.md) |
| Phase 3 — Headless backend bootstrap (8–12 days) | [WEB-031 — Extract shared bootstrap](../tasks/WEB-031.md) |
| Phase 3 — Headless backend bootstrap (8–12 days) | [WEB-032 — Add HTTP server skeleton](../tasks/WEB-032.md) |
| Phase 3 — Headless backend bootstrap (8–12 days) | [WEB-033 — Local session security](../tasks/WEB-033.md) |
| Phase 4 — RPC and event infrastructure (8–12 days) | [WEB-040 — Implement versioned RPC dispatcher](../tasks/WEB-040.md) |
| Phase 4 — RPC and event infrastructure (8–12 days) | [WEB-041 — Implement WebSocket event bus](../tasks/WEB-041.md) |
| Phase 4 — RPC and event infrastructure (8–12 days) | [WEB-042 — Implement browser HTTP transport](../tasks/WEB-042.md) |
| Phase 4 — RPC and event infrastructure (8–12 days) | [WEB-043 — Add dual-transport contract harness](../tasks/WEB-043.md) |
| Phase 5 — Core database parity (15–22 days) | [WEB-050 — Connections, groups, tags, and appearance](../tasks/WEB-050.md) |
| Phase 5 — Core database parity (15–22 days) | [WEB-051 — SSH and K8s connections](../tasks/WEB-051.md) |
| Phase 5 — Core database parity (15–22 days) | [WEB-052 — Metadata explorer](../tasks/WEB-052.md) |
| Phase 5 — Core database parity (15–22 days) | [WEB-053 — Query execution](../tasks/WEB-053.md) |
| Phase 5 — Core database parity (15–22 days) | [WEB-054 — Data editing and blobs](../tasks/WEB-054.md) |
| Phase 5 — Core database parity (15–22 days) | [WEB-055 — Database objects and user management](../tasks/WEB-055.md) |
| Phase 6 — Persistence and productivity parity (10–15 days) | [WEB-060 — Settings, keybindings, and themes](../tasks/WEB-060.md) |
| Phase 6 — Persistence and productivity parity (10–15 days) | [WEB-061 — Saved queries and query history](../tasks/WEB-061.md) |
| Phase 6 — Persistence and productivity parity (10–15 days) | [WEB-062 — Notebooks](../tasks/WEB-062.md) |
| Phase 6 — Persistence and productivity parity (10–15 days) | [WEB-063 — Secondary windows](../tasks/WEB-063.md) |
| Phase 7 — Files, jobs, backup, and import/export parity (12–18 days) | [WEB-070 — Upload/download token service](../tasks/WEB-070.md) |
| Phase 7 — Files, jobs, backup, and import/export parity (12–18 days) | [WEB-071 — Connection import/export and backup](../tasks/WEB-071.md) |
| Phase 7 — Files, jobs, backup, and import/export parity (12–18 days) | [WEB-072 — Database dump/import](../tasks/WEB-072.md) |
| Phase 7 — Files, jobs, backup, and import/export parity (12–18 days) | [WEB-073 — Generic exports and logs](../tasks/WEB-073.md) |
| Phase 8 — AI, plugins, and operational parity (15–22 days) | [WEB-080 — AI and approval flows](../tasks/WEB-080.md) |
| Phase 8 — AI, plugins, and operational parity (15–22 days) | [WEB-081 — Plugin driver lifecycle](../tasks/WEB-081.md) |
| Phase 8 — AI, plugins, and operational parity (15–22 days) | [WEB-082 — Plugin UI extensions](../tasks/WEB-082.md) |
| Phase 8 — AI, plugins, and operational parity (15–22 days) | [WEB-083 — Logs and task manager](../tasks/WEB-083.md) |
| Phase 8 — AI, plugins, and operational parity (15–22 days) | [WEB-084 — MCP behavior](../tasks/WEB-084.md) |
| Phase 9 — Browser adaptations and release hardening (12–18 days) | [WEB-090 — Clipboard, dialogs, notifications, and external URLs](../tasks/WEB-090.md) |
| Phase 9 — Browser adaptations and release hardening (12–18 days) | [WEB-091 — Deep links and install links](../tasks/WEB-091.md) |
| Phase 9 — Browser adaptations and release hardening (12–18 days) | [WEB-092 — Updater adaptation](../tasks/WEB-092.md) |
| Phase 9 — Browser adaptations and release hardening (12–18 days) | [WEB-093 — Remote authenticated mode](../tasks/WEB-093.md) |
| Phase 9 — Browser adaptations and release hardening (12–18 days) | [WEB-094 — Packaging](../tasks/WEB-094.md) |
| Phase 9 — Browser adaptations and release hardening (12–18 days) | [WEB-095 — Performance and resilience](../tasks/WEB-095.md) |
| Phase 10 — Final parity gate (8–12 days) | [WEB-100 — Automated E2E matrix](../tasks/WEB-100.md) |
| Phase 10 — Final parity gate (8–12 days) | [WEB-101 — Manual parity audit](../tasks/WEB-101.md) |
| Phase 10 — Final parity gate (8–12 days) | [WEB-102 — Documentation](../tasks/WEB-102.md) |
| Phase 10 — Final parity gate (8–12 days) | [WEB-103 — Merge readiness](../tasks/WEB-103.md) |


## 10. Recommended milestone cuts

### Milestone A — Architecture proof

Includes WEB-000 through WEB-043.

Demo:

```bash
tabularis web
```

loads `packages/web-ui` and executes a representative connection/query flow over HTTP/WebSocket. Desktop remains green.

Expected effort: 6–9 weeks.

### Milestone B — Database-manager MVP

Includes Phase 5 and core portions of Phase 6.

Demo:

- connection management;
- schema navigation;
- SQL execution/cancellation;
- editable results;
- database object management;
- saved queries/history.

Expected cumulative effort: 10–14 weeks.

### Milestone C — Broad parity

Includes Phases 6–8.

Demo includes notebooks, imports/exports, dumps, backups, AI, plugins, logs, and task manager.

Expected cumulative effort: 17–23 weeks.

### Milestone D — Release parity

Includes Phases 9–10, security audit, packaging, E2E, and documentation.

Expected cumulative effort: 22–30 engineering weeks for one experienced full-time contributor.

Two contributors can reduce calendar time, but not linearly. A realistic target is 14–20 calendar weeks if one contributor owns Rust/runtime/transport and the other owns frontend adapters/E2E, with shared review of contracts and security.

## 11. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| `AppHandle` coupling prevents headless startup | Critical | Extract runtime context incrementally before HTTP parity work |
| Hundreds of untyped string command calls drift | High | `CommandMap`, inventory script, dual-transport contract tests |
| Browser filesystem semantics differ | High | Upload/download tokens and semantic capability adapters |
| Remote access exposes database administration | Critical | Loopback default, explicit remote mode, auth/TLS/origin/audit controls |
| Large query results exhaust memory | High | Limits, pagination/streaming design, bounded WebSocket queues |
| SSH askpass reaches wrong browser session | Critical | Session ownership, timeout, explicit approval, audit trail |
| Plugin UI executes untrusted JavaScript | High | Existing trust model review, CSP, authenticated assets, version checks |
| Shared settings conflict across sessions | Medium | Separate global, user, and session state explicitly |
| Long-running branch diverges from `main` | High | Small commits, regular rebases, milestone/stacked PRs |
| Moving the frontend breaks release tooling | High | Establish transport seam first, move files in one mechanical task, preserve root delegator scripts |
| “Parity” becomes subjective | High | Machine-readable matrix with explicit adaptation and sign-off |

## 12. Immediate next actions

Execute only these tasks first:

1. Resolve the unrelated `AGENTS.md` working-tree modification outside this feature.
2. Create and push `feat/web-ui` from current `main`.
3. Complete WEB-001 and commit the generated command/parity inventory.
4. Review and approve the ADRs in WEB-002 before choosing the HTTP framework or changing startup.
5. Implement WEB-010 through WEB-013 as a desktop-compatible transport seam.
6. Move the existing frontend to `packages/web-ui` only after the representative slice is green.
7. Stop after Milestone A for architecture and security review before bulk-migrating the remaining command groups.

This ordering avoids a second UI, avoids a second backend API implementation, and validates the hardest assumptions before committing to the full parity migration.
