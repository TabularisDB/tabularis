# Installable themes: clean local baseline

## Status and provenance

This is a **baseline checkpoint**, not the implementation or final acceptance
report for #791 / PR #793. No production TypeScript/Rust function has changed.
Fixtures were captured from `main` at
`d044381c536a3b9e4b576b1ed33fcce39efcf4b1` before runtime edits.

The old PR head `9864ddf864d817b7e998840a8c9f6470c487ad50` contained only two
temporary hosted-verification files. The local feature branch was reset to
`main` in an isolated worktree after preserving a backup reference. The remote
branch has not been rewritten; final delivery must preserve its ancestry
without force-pushing and remove the obsolete verification files explicitly.

All new checks below ran **locally**, not in GitHub Actions. No registry download
endpoint, production data, personal profile, release or merge operation was used.

## Current behavior map

| Concern | Current implementation and compatibility boundary |
| --- | --- |
| Builtin catalog | `src/themes/themeRegistry.ts`: eagerly imports 12 presets, offline default `tabularis-dark`; original order and complete descriptors are captured. |
| Personal CRUD | `ThemeProvider` exposes create/update/delete/duplicate/import/export; pure helpers in `src/utils/themeManagement.ts` provide similar operations. Native wrappers are registered in `src-tauri/src/lib.rs`. No current Appearance CRUD/import/export buttons were found: those callbacks are exposed by the provider, but the current tab uses theme pickers. |
| Native files | `theme_commands.rs`: personal files under the application config directory's `themes/<id>.json`; `get_all_themes` skips parse/read failures. `get_themes_dir` creates the directory on access. Installed themes have no separate catalog/storage yet. |
| Public commands | `get_all_themes`, `get_theme`, `save_custom_theme`, `delete_custom_theme`, `import_theme`, `export_theme`. Existing builtin data is frontend-owned, not returned by native personal-file listing. |
| Hydration | `ThemeProvider.loadThemes`: reads config, optionally migrates `tabularis_theme_settings`, detects an initial theme, then loads custom files and resolves the effective selection. |
| Persistence | Native `config::save_config` merges supplied optional fields. Provider effects save `currentTheme.id` after loading and on effective-theme changes; persisted preferences and fallback/preview state are not separated yet. |
| System appearance | Linux portal + native event, then Tauri theme/media-query fallbacks in `ThemeProvider`; other platforms use native theme events. Existing async revision/disposal guards must survive. |
| Editor override | `useEditorTheme`: `settings.editorTheme` resolves independently through `allThemes`, otherwise follows the app theme; unavailable editor IDs temporarily use the app theme. Monaco is global within its module instance. |
| CSS | `applyThemeToCSS`: backgrounds, surfaces, text, accents, borders, most semantic colors, font families, four border radii and color scheme. It does **not** apply theme `fontSize`, `spacing` or connection-active/inactive semantic tokens. Separate settings typography/layout behavior must remain intact. |
| Monaco | `loadMonacoTheme`: a recognized `themeName` completely selects the named asset; otherwise generated rules/colors. Module-global `Set<string>` caches definitions by ID, not content or Monaco instance. |
| Generated editor precedence | Explicit `monacoTheme.colors` override generated colors; SQL string rules are appended after supplied rules. Alpha defaults currently append hex suffixes to strings. Preserve builtin output; new-format color handling needs explicit bounds and tests. |
| Appearance | `AppearanceTab` / `ThemePicker`: static/system light+dark selection, independent editor theme, typography controls; no package lifecycle or preview transaction yet. |
| Registry transport | `plugins/tabularium.rs`: SDK detail/list/readme, integrity/JWKS verification and tracked explicit/latest URL construction. `RegistryPlugin` already carries optional `kind` and `downloads`. |
| Installation | `plugins/commands.rs::install_plugin` resolves the asset then calls `installer::download_and_install`, followed by driver loading/refresh. Existing cancellation guards must be retained. |
| Startup | `manager::load_plugins_with_configs` scans plugin directories and calls `load_plugin_from_dir`; enable/install/task-manager restart are additional callers. Kind dispatch must precede executable/parser/UI-extension activation. |
| Archive boundary | Existing driver installer checks SHA, manifest identity/version/minimum runtime, uses `enclosed_name`, honors Unix modes, and removes old installation before rename. It does not meet the new hostile-theme archive/rollback contract: bounded expansion, strict entry rejection and transactional replacement need explicit implementation. |
| Author tools | `packages/create-plugin`: existing driver scaffold/build/smoke, `.tabularium` templates and release workflow; driver defaults must not be changed by theme mode. |

### Builtin identities and editor assets

Builtin IDs in registry order:

1. `tabularis-dark`
2. `tabularis-light`
3. `monokai`
4. `one-dark-pro`
5. `nord`
6. `dracula`
7. `github-dark`
8. `solarized-dark`
9. `solarized-light`
10. `high-contrast`
11. `gruvbox-material-dark`
12. `gruvbox-material-light`

The loader recognizes 11 named assets: Monokai, Dracula, Nord, GitHub Dark,
GitHub Light, Solarized-dark, Solarized-light, One Dark Pro, Night Owl,
Gruvbox Material Dark and Gruvbox Material Light. The high-contrast builtin
uses Night Owl; do not silently substitute a different editor palette.
`Tomorrow-Night-Eighties.json` is checked in but not in the loader map.

### Legacy wire formats and limitations

The frontend accepts JSON via a cast and issues fresh timestamp-based custom
IDs; native commands deserialize `theme_models::Theme`. These are not currently
identical contracts. Rust uses `connection_active` / `connection_inactive`
(required), and `font_style` (optional), whereas the frontend uses camel case.
Unknown serde fields are not preserved automatically. The compatibility
fixtures deliberately retain both shapes plus optional/null native variants.

Native save/delete protection currently trusts the serialized `isPreset` flag;
IDs are interpolated into paths and installed ownership does not exist. These
are inspected source limitations, not completed exploitation/hostile-input
tests. New-format validation must not become a retroactive validator for valid
historical files. Read-only ownership must come from host context.

See the [fixture README](README.md)
for the exact golden checks and their limitations. The new native tests cover
wire/config serialization only, **not** transactional storage or command writes.

## Local verification evidence

Host frontend toolchain: Node 24.18.0, pnpm 10.30.3; locked install succeeded.
Native: local Debian bookworm container, mounted Rust 1.98.0 toolchain, 4 CPU
limit, 12 GiB memory limit; fresh Cargo home/target and isolated HOME under the
project volume. Cargo dependencies were fetched first; the container was then
disconnected from the network for tests, Clippy and binary build. No host
GTK/WebKit installation was performed.

| Check on unmodified runtime | Result |
| --- | --- |
| `pnpm exec vitest run --maxWorkers=2` | **PASS**: 4,545 tests / 285 files before new compatibility tests. |
| `pnpm run typecheck`, `lint`, `build` | **PASS**, including the application build's TypeScript project build. |
| `typecheck:explain`, `check:plugin-api` | **PASS**. |
| `build:create-plugin`, `smoke:create-plugin` | **PASS**. |
| `cargo test --locked --offline --no-fail-fast -- --test-threads=2` | **PASS**: 1,298 native tests; **197 ignored** (5 library, 10 PostgreSQL integration, 182 existing integration). Ignored tests did not pass. |
| `cargo test --locked --offline --lib` with default thread count | **PASS**: 1,298 passed / 5 ignored. Separate diagnostic run, not additional unique test coverage. |
| `cargo build --locked --offline --bin tabularis` | **PASS**, Linux x64 **debug** binary; not a signed release/package or cross-platform build. |
| Built binary `--version` | **PASS**: `tabularis 0.24.0`. Not a GUI/manual smoke test. |
| `cargo fmt --all -- --check` | **FAIL** on the baseline: 82 existing files. No mass reformat performed. |
| `cargo clippy --locked --offline --all-targets -- -D warnings` | **FAIL**: 122 library diagnostics / 129 library-test diagnostics, overlapping (do not add them). No warnings suppressed. |
| New frontend compatibility replay | **PASS**: 15 tests, including all builtin descriptors/CSS/generated editor output/actual editor-definition hashes and all named assets. |
| New native compatibility replay | **PASS**: 4 tests, including historical native/null/omitted fields and five configuration examples. |
| Full checkpoint rerun including new tests | **PASS**: frontend 4,560 / 286 files; native 1,302 unique tests / 197 ignored. |
| Explicit app/node TypeScript projects; new test lint/format | **PASS**: `tsc -p tsconfig.app.json --noEmit`, `tsc -p tsconfig.node.json --noEmit`, ESLint with `--no-ignore` for the new frontend test, and rustfmt for the new native test. |
| Manual Linux/macOS/Windows behavior | **NOT RUN**. Remains a release gate. |
| Full feature/author/installed/registry journeys | **NOT IMPLEMENTED / NOT RUN**. |

The historical hosted connection-metadata cache assertion failure did not
reproduce in either local thread configuration. This is **not a fix or waiver**;
thread/toolchain/environment sensitivity is still unisolated.

## Read-only registry assessment

Inspected sibling Tabularium at `f92f0fd7b5b27dc9b05e401e23721151bd42faf8`;
no files modified, no services started, no production requests.

- `apps/api/src/lib/manifest-schema.ts::getEffectiveExtensions`: a nonempty
  kind-specific extension schema **replaces** global extensions. An empty
  override falls back to global extensions. Theme requirements must live in an
  explicit nonempty kind override, not the global driver schema.
- `packages/manifest/src/schema.ts::buildSchema`: kind-scoped discovery uses
  `?kind=theme`; extension `required: true` is promoted to the root required
  list. Unscoped schemas additionally apply kind clauses and global required
  fields. The host/author tooling must validate the actual kind-specific
  schema, not assume unscoped and scoped behavior are identical.
- Both `latest.ts` and `releases/[version]/index.ts` choose the requested
  platform first, then `universal`. Both increment package downloads and emit
  download events **even without `redirect=1`**. Discovery/preview must never
  call them as harmless metadata probes. Integrity/detail endpoints are
  separate; do not add a second counter request.
- `PluginCard.svelte` does not render download counts.
- Plugin detail does show aggregate downloads, but `loadDownloadStats` silently
  retains null on failure and the template renders the same empty state for
  unavailable and zero per-version statistics.

The last two UI gaps block the registry portion of acceptance. Per issue #791,
request **separate explicit maintainer approval** before changing Tabularium.
No theme kind was configured or enabled. No integration tests have yet proven
this static assessment against an isolated running registry.

## Impact analysis and decisions before implementation

GitNexus 1.6.12 runs in a local container. An incremental index update produced
invalid UTF-8 paths and mismatched IDs; those outputs were rejected. A fresh
full rebuild without parse-cache reuse restored coherent symbol identities;
the following analysis was rerun against that index. Keep graph limitations
in mind: Tauri string dispatch and process truncation can hide callers.

| Proposed symbol change | Graph result | Direct callers / processes |
| --- | --- | --- |
| `loadMonacoTheme` | **CRITICAL** | 16 / 18; SQL/cell/diff editors, previews, visual explain and AI/config/MCP/query modals. |
| `generateMonacoTheme` | **CRITICAL** | 1 / 7; through `loadMonacoTheme`. |
| `load_plugin_from_dir` | **HIGH** | 4 / 2; enable, install, startup scan and task-manager restart. |
| `download_and_install` | LOW | 1 / 1; `install_plugin` (native execution/rollback still security-sensitive). |
| `ThemeProvider`, `applyThemeToCSS` | LOW in graph | 1 each; React context consumers increase the real application surface. |
| `get_theme`, `save_custom_theme` | UNKNOWN | No graph callers; registered public Tauri commands, not unused code. |

Checkpoint `detect-changes --scope all` reported only new test symbols, zero
affected execution processes and LOW risk. No commit or push was made; the full
feature PR review is still pending.

HIGH/CRITICAL risks were reported before any affected runtime edits. Proposed
mitigation: preserve golden outputs through adapters, then add targeted
same-ID/multi-instance/persistence tests; implement explicit package-kind guards
before any theme archive can reach the driver path. Do not proceed with a
monolithic loader rewrite.

Subsequent maintainer decisions:

1. The bounded high-impact implementation approach above is **approved**.
2. Baseline-wide formatting/Clippy remediation is explicitly **declined**.
   Do not perform it, including as a separate cleanup task. Report existing
   failures accurately rather than calling the corresponding checks passed.
3. Separately scoped Tabularium download-count card/detail UI correction is
   **approved**. No production administration or unrelated sibling changes
   are authorized. See [the registry checkpoint](REGISTRY-CHECKPOINT.md).

First supporting app version, operator rollout/rollback and manual platform
hosts remain unresolved later gates. `0.24.0` above is the baseline binary's
version, **not** a declared first supporting release.
