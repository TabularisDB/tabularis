# Startup optimization results

Baseline: `100f50229362f1d277ceb90da3abf38eefd6d3e9` (`main`).
Implementation: `perf/startup-optimization`.

The connections screen now starts without loading Monaco, the editor, graph and
chart screens, inactive connection dialogs, or every translation dictionary.
Driver manifests and catalogue requests are shared across consumers. Optional
AI discovery and idle plugin initialization no longer gate application setup.

## Measured comparison

These are **production frontend measurements in Chromium with simulated Tauri
IPC**, not end-to-end native Tauri launch times. Both builds use the same fixture,
machine and benchmark. Nine runs per build alternate order, each in a fresh
incognito context with the HTTP cache disabled. The browser process and OS file
cache remain warm. There is no CPU throttling.

Environment: macOS arm64, Chrome `152.0.7977.83`, Node `24.15.0`. Scenario: empty
connections screen, English, AI disabled, auto-connect disabled, no active
external plugins, existing welcome flow completed. Every simulated IPC call
resolves after 5 ms; remote changelog fetches receive an empty local response.

| Metric | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Initial static JavaScript | 8,792,506 B | 1,425,258 B | 83.8% |
| Initial JavaScript, gzip size estimate | 2,368,906 B | 387,438 B | 83.6% |
| Initial JavaScript requests | 9 | 2 | 77.8% |
| CSS in the initial import graph | 344,087 B | 181,311 B | 47.3% |
| Connections screen ready, median | 190.3 ms | 85.3 ms | 55.2% |
| First contentful paint, median | 176 ms | 68 ms | 61.4% |
| Initial IPC calls | 49 | 29 | 40.8% |
| Remote changelog requests | 1 | 0 | 100% |

Screen-ready samples range from 180.8–209.6 ms before and 76.6–93.3 ms after.
The marker waits for the Connections heading and two animation frames. IPC
counts include event registration and are collected for 500 ms after that
marker. The benchmark also checks for uncaught errors and unmocked IPC commands;
both were zero in every run. Gzip is a size estimate, not the transfer encoding
used by the local benchmark or a claim about Tauri's asset protocol.

The manifest's initial import graph is traversed recursively and deduplicated.
Worker bundles, source maps, lazy screens and unselected locales are excluded.
The browser's observed JavaScript resource sizes corroborate that graph. An
additional selected locale adds its own bundled dictionary; opening the editor
loads Monaco and its workers at that point.

| Bootstrap command | Before | After |
| --- | ---: | ---: |
| `get_registered_drivers` | 7 | 1 |
| `get_installed_plugins` | 4 | 1 |
| `get_connections_with_groups` | 4 | 1 |
| `get_config` | 2 | 1 |
| `fetch_plugin_registry` | 3 | 0 |
| `save_config` during theme hydration | 1 | 0 |

See [individual measurements and command counts](../benchmarks/startup-2026-09-18.json).

## Changes and behavioral limits

- Routes, schema explorer, row editor, connection/import/migration dialogs and
  the AI approval dialog load on demand. The approval event listener still mounts
  immediately. A shared Monaco loader configures bundled workers before mounting
  either the regular editor or diff editor; offline behavior is retained.
- Removed manual vendor grouping that pulled shared runtime helpers into Monaco
  and made a dynamic editor import effectively eager. Vite/CommonJS helpers now
  have their own small chunk; Rollup splits the remaining graph automatically.
- English remains the bundled fallback. Other languages load through a local
  i18next backend, including the Filipino alias and Brazilian Portuguese.
- `useDrivers` shares requests and one activation listener. An activation during
  a pending read triggers a follow-up refresh. Catalogue data is shared by
  registry URL and fetched when needed; migrations still request it when saved
  built-in connections require it.
- Settings and theme share overlapping config reads. Preset colors can apply
  before custom themes finish loading. Initial hydration does not rewrite the
  selected theme or overwrite the font cache with defaults. Optional AI discovery
  publishes results after persisted settings are ready and respects intervening
  user edits.
- Session restore waits for persisted preferences, tries the last active
  connection first, opens the editor after its success, and restores remaining
  connections without changing the active connection/table. Dedicated connection
  windows retain their URL-driven restore path. Bootstrap connection-list reads
  share one in-flight request. Explicit reloads fetch fresh data and supersede
  any pending older snapshot, including a read started before a user edit.
- Rust setup reuses one config snapshot for decorations, plugins, ping interval
  and maximize behavior (five synchronous config loads become one by code
  inspection). Background services still read current config where appropriate.
- External plugin processes are still spawned and spawn errors still surface
  during registration. The `initialize` handshake is deferred until the first
  RPC for that plugin, shared across concurrent calls through `OnceCell`, and
  precedes all database operations. Its existing 15-second timeout and legacy
  method-not-found compatibility remain. Therefore an idle unresponsive plugin
  no longer adds its handshake timeout to GUI/MCP setup. **That waiting cost is
  deferred to the first use of the affected plugin, not eliminated.**

## Validation

- Production TypeScript build and Vite bundle succeeded.
- Frontend suite: 280 files, 4,451 tests passed.
- Rust library suite: 1,273 tests passed, 4 intentionally ignored.
- ESLint passed for changed production TypeScript and the benchmark script;
  `git diff --check` passed.
- Browser smoke check navigated from the connections screen to the lazy MCP
  route, rendered the real Monaco JSON editor, and loaded its local JSON worker.
  No editor CDN fetches, uncaught errors or unmocked commands were observed.
- New regression coverage includes shared reads/refresh races, activation events,
  settings hydration versus AI discovery, session-restore ordering and background
  focus, lazy regular/diff editors, offline Monaco configuration, locale loading,
  and plugin initialization ordering/concurrency/legacy compatibility. A real
  unresponsive subprocess is registered without waiting for a handshake.
- GitNexus impact checks preceded symbol edits; final change analysis identifies
  the expected startup, settings, catalogue, editor/notebook and plugin flows.
  Context APIs and plugin lifecycle have high impact, so their existing suites
  were run in addition to the new cases.

The initial Rust run encountered local-environment failures: a custom storage
path invalidated a default-directory assertion, macOS's long temporary path
exceeded a UNIX socket path limit, and the sandbox blocked local sockets.
The complete suite passed using a short canonical temporary directory, an
isolated `TABULARIS_DATA_DIR`, and permission to open local test sockets. No
application code or assertions were weakened to make those tests pass.

## Reproduction

Build the baseline and branch separately, using their respective checkouts:

```sh
pnpm exec vite build --outDir /tmp/tabularis-startup-before --manifest --sourcemap
pnpm exec vite build --outDir /tmp/tabularis-startup-after --manifest --sourcemap
STARTUP_SMOKE=1 node scripts/benchmark-startup.mjs \
  /tmp/tabularis-startup-before /tmp/tabularis-startup-after \
  /tmp/tabularis-startup-metrics.json 9
```

The benchmark uses a temporary Chrome profile and localhost server. Set
`CHROME_BIN` for a Chrome/Chromium executable at a different path. It does not
read personal application data or make real database connections. Local process
and socket permissions are required. It intentionally retains the temporary
profile for inspection; it can be removed after the run.

```sh
pnpm exec tsc -b
pnpm exec vitest run
mkdir -p /private/tmp/tabularis-tests/tabularis
cd src-tauri
TMPDIR=/private/tmp/tabularis-tests \
TABULARIS_DATA_DIR=/private/tmp/tabularis-tests/tabularis cargo test --lib
```

The environment's pnpm wrapper could not verify its pinned package-manager
release against the registry. These runs used the already installed local
TypeScript, Vite and Vitest CLI entry points directly, without changing the lockfile
or installing dependencies.

## Remaining measurements and opportunities

### Audit inventory

The audit found the following startup costs. Unmeasured items are candidates
for profiling, not additional claimed savings.

| Bottleneck and source | Change in this PR / next improvement scenario |
| --- | --- |
| Serial external-driver initialization (`plugins/driver.rs`, `plugins/manager.rs`) | Handshake deferred until that driver's first RPC. Executables still spawn at startup; lazy spawning is a further opportunity for many installed plugins. |
| Eager Monaco and shared chunk dependencies (`main.tsx`, `monacoLoader.ts`, `vite.config.ts`) | Removed from initial graph. A restricted SQL/JSON Monaco build could reduce first-editor cost further. |
| Secondary routes and hidden tools (`App.tsx`, shared layouts) | Routes, heavy panels and closed dialogs load on demand. First visits pay their loading cost. |
| Every locale imported (`i18n/config.ts`) | Only English is initially bundled; selected locales load locally as needed. |
| Session restore waits for all connections (`pages/Connections.tsx`) | Last active connection has priority; its editor opens before remaining connections finish, with stable focus. |
| Metadata gates connection readiness (`contexts/DatabaseProvider.tsx`) | Unchanged: slow routine/view/trigger discovery can still delay the selected connection. Split transport readiness from explorer readiness and load metadata incrementally in a follow-up. |
| Disposable connection preflight (`commands.rs`, built-in drivers) | Unchanged: remote TLS/authentication can precede another pooled connection. Validate and reuse the actual session, preserving explicit Test Connection, scripts and tunnel behavior. |
| Duplicate driver and connection discovery (`useDrivers.ts`, connection consumers) | Shared bootstrap reads and activation invalidation. Each individual connect still reads saved connection details; an indexed backend lookup could reduce large-profile work. |
| Closed modal triggers catalogue requests (`pages/Connections.tsx`) | Dialog mounts on demand; no registry request in the measured empty-profile startup. Built-in connection migration still fetches the catalogue when required. |
| Serial catalogue network stages (`plugins/compat.rs`, `plugins/tabularium.rs`) | Frontend shares results by registry URL. Backend sources/detail lookups remain serial; bounded parallel fetching, persistent TTL cache and reusable HTTP clients would help slow/offline catalogues. |
| Repeated config/file reads and migrations (`lib.rs`, `config.rs`, connection commands) | One native setup snapshot and shared frontend bootstrap read. General command caching, migration versioning and filesystem scheduling remain candidates for slow/cloud-backed storage. |
| Auto-connect races saved preferences (`pages/Connections.tsx`) | Restore waits for settings hydration; dedicated windows skip main-session restoration. |
| Optional AI discovery gates settings (`SettingsProvider.tsx`) | Settings publish first; key checks run concurrently and model lookup supplies `forceRefresh: false`. Results cannot overwrite intervening provider/model edits. |
| Theme enumeration and initial rewrite (`ThemeProvider.tsx`) | Presets apply before custom theme enumeration finishes; hydration no longer rewrites config. Loading only the selected custom theme and caching its initial paint remain opportunities. |
| Restore churns tabs/history/context (`DatabaseProvider.tsx`, editor/history providers) | Background connections no longer activate themselves. Incremental notebook migration, on-demand history and narrower context subscriptions require separate profiling. |
| Enabled plugin UI and parsers load eagerly (`PluginSlotProvider.tsx`) | Unchanged: heavy extension scripts may stall after paint. Load driver-specific contributions on demand and publish global contributions progressively. |
| Full provider stack in secondary windows (`main.tsx`, `App.tsx`) | Lazy route bundles and restore guard help. Selecting a minimal provider stack by window role would remove more unused work. |
| Optional jobs/platform setup (`useChangelog.ts`, updates, backups, Linux registration) | Changelog loads when opened. Update checks were already delayed; backup and platform-registration costs need native measurements before changing scheduling. |

An instrumented release build on WKWebView/WebView2/WebKitGTK is still needed
for true process-launch-to-interactive numbers, cold OS caches, and memory use.
The Chromium result must not be presented as a measured native launch speedup.
Real-world startup with many connections depends on keychain, SSH, driver and
server latency. Connection preflight checks and metadata discovery still retain
their existing semantics; this change prioritizes the useful connection rather
than weakening validation. Plugin process spawning, global providers in
secondary windows, and extension loading are further candidates for a separate
profile-driven change.
