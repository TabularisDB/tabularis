# PR #793: isolated manual acceptance

**Status: prepared, not GUI/platform acceptance.** Use a disposable OS account or
VM with no real profile, credentials or connections. Block outbound traffic
except loopback before first launch; unrelated normal startup code may contact
its configured registry. Never run these tests against production counters.
Do not enable an operator kind or publish a package/release during this plan.

The development binary and these fixtures say `0.24.0`. That is **not** an assigned
first supporting public version. Old released binaries must not share this test
profile: see `pre-feature/README.md` for the demonstrated selection-overwrite hazard.

For a source-build check **inside that disposable account/VM**, after following
the repository's normal build prerequisites:

```sh
# Linux/macOS shell, from the repository root:
theme_profile=$(mktemp -d "${TMPDIR:-/tmp}/tabularis-pr793-XXXXXX")
TABULARIS_DATA_DIR="$theme_profile" pnpm tauri dev
# After the app is stopped and evidence saved:
# rm -r -- "$theme_profile"
```

```powershell
# Windows PowerShell, inside the disposable account/VM:
$themeProfile = Join-Path $env:TEMP ("tabularis-pr793-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $themeProfile | Out-Null
$env:TABULARIS_DATA_DIR = $themeProfile
pnpm tauri dev
# After stopping and saving evidence:
# Remove-Item -Recurse -LiteralPath $themeProfile
# Remove-Item Env:TABULARIS_DATA_DIR
```

The storage override alone is **not full isolation**: installed executable drivers
remain in the default per-user data directory. Do not use this recipe in a real
user account and assume it isolates those drivers. Repeat with packaged binaries
for final platform acceptance; a development launch is not a substitute.

## Staged data and backend proof

- `author/original-v1.zip`, `original-v2.zip`: real offline CLI scaffold/edit /
  validate/package output with light/dark variants and a changed accent in v2.
- `author/imported-v1.zip`, `imported-v2.zip`: invented VS Code conversion followed
  by a personal edit and the application's shared archive exporter.
- `author/import-example.jsonc`: usable invented import, with an ignored include,
  SQL-scope approximation and semantic-token warning; no redistribution grant.
- `author/invalid.zip`: deliberately not a ZIP, for non-writing rejection.
- `author/corrupt-personal.json`: invalid modern personal storage document.
- `legacy-frontend.json`, `legacy-native.json`, `legacy-native-nullable.json`:
  historical formats and optional/null fields; no real user data.

The native `author_journeys` tests consume the actual valid ZIP bytes. The
`manual_fixture` tests reject the staged corrupt inputs without repairing saved
preferences. The loopback service below was separately exercised for **both**
original/imported families using the real SDK, theme installer and catalog:
metadata/README did not increment counters; latest and pinned installs did.
This is stronger than mocked IPC, but still not a packaged GUI test.

## Start the loopback-only registry

From the repository root (Node installed in the disposable environment):

```sh
node tests/fixtures/themes/manual-registry.mjs original 49179
# For the independent imported-theme journey, use a fresh profile and:
node tests/fixtures/themes/manual-registry.mjs imported 49180
```

Each process binds **only 127.0.0.1**, reads committed ZIPs, writes no files and
makes no upstream requests. Copy its printed `base` into the disposable app's
registry setting explicitly. Commands in that terminal:

| Command | Effect |
| --- | --- |
| `counts` | Print local request counts; never a production statistics call |
| `next` / `first` | Advertise latest 2.0.0 / 1.0.0; both pinned fixtures remain available |
| `tamper` | Toggle incorrect advertised SHA-256 for integrity-failure testing |
| `slow` | Toggle slow loopback ZIP streaming so Cancel is actionable |
| `quit` | Stop the fixture service |

The two fixture families deliberately use the same package slug. Their different
loopback registry URLs produce different native namespaces; do not conflate them
when testing update identity. The service is intentionally not a full Tabularium
replacement. Its fake metadata URLs use `example.invalid`, not public assets.

Optional SDK/backend reproduction while that service runs, from `src-tauri/`:

```sh
THEME_TEST_REGISTRY_URL=http://127.0.0.1:49179 cargo test --locked --offline --lib \
  theme_packages::tests::manual_fixture::manual_node_fixture_is_usable_by_the_real_sdk_and_theme_installer \
  -- --ignored --exact
```

This opt-in test uses temporary storage, refuses non-loopback URLs, verifies the
fixture response header, installs latest then pinned 2.0.0, and leaves no app
configuration or driver directory. It deliberately increments only local counts.

## Manual matrix — record actual results, do not pre-check

Run on Linux, macOS and Windows packaged builds. Include keyboard-only operation,
light/dark OS appearance, a genuine old profile copy, and multiple mounted editors.

| Input / action | Expected result |
| --- | --- |
| Cold launch offline | All 12 builtins selectable; no package/network dependency |
| Historical static, system light/dark, custom and independent editor preferences | Same visuals/editor precedence; startup and OS changes do not save/repair preferences |
| Legacy JSON import/export, including nullable/native field spellings | Readable, editable personal copy; original file untouched; opaque metadata retained; optional chosen import name respected |
| Duplicate a named builtin, edit its separate exact editor JSON, export/reimport | New personal identity, no builtin overwrite; SQL rendering remains exact rather than regenerating source rules |
| Preview then Cancel / Escape while OS appearance changes | Real app + SQL preview; current saved/OS selection restored; no persistence |
| Apply a preview | One explicit preference save; becomes static choice, retaining light/dark/editor choices |
| Import JSONC; inspect warnings; Cancel first | No include read/fetch; no saved file or changed selection |
| Re-import JSONC, acknowledge limitations, Save without Apply | Editable native personal theme; no automatic activation; original VS Code file unchanged |
| Export author ZIP to an explicitly chosen save-dialog path | ZIP actually written from main window; no wider filesystem grant |
| Preview `invalid.zip` | Actionable rejection; no package directories or preference writes |
| Preview valid local v1 ZIP, Cancel, then install | Preview is read-only; explicit install creates package; selection unchanged; no download count |
| Discover, search, view versions/README, close details | Counts unchanged; no auto media fetch; keyboard focus returns to invoking button |
| Install registry Latest at `first` | Exactly one tracked latest request; all variants installed, none auto-selected |
| Select installed dark variant and an independent editor choice | App/editor effective identities are independently respected |
| Type `next`, use that installed package's Update action | Bound package/registry, not generic browsing; exactly one tracked request; stable variant IDs; same-ID CSS/editor revision refresh without restart |
| Select an explicit previous version | One pinned tracked request; deliberate downgrade, no preference migration |
| Change configured registry, then Update an old-registry package | Refusal/instruction to configure the right registry; no cross-registry install |
| `tamper`, attempt replace | Integrity failure; old package/selection retained; counter records request, not successful commit |
| `slow`, begin replace, Cancel before commit | Cancellation leaves old package intact; no false failure after an actual commit |
| Disable / uninstall selected package, restart, reinstall / enable | Saved unavailable IDs retained, offline fallback shown; original preference restored on availability |
| Open/close recovery; then explicitly run it | Opening does nothing; explicit recovery is idempotent, reports diagnostics, never selects a theme |
| Copy corrupt personal fixture as `<isolated-config>/theme-personal-v1/custom-corrupt.json` while stopped | Diagnostic; no rewrite/deletion. If selected in isolated config, preserve saved ID and use fallback |
| Declared-theme / unknown-kind package through driver paths | Rejected before extraction/permissions/startup; existing driver and UI-extension flows unchanged |
| Theme deep link with pinned version / different requested registry | Native theme-only metadata and explicit install; no driver callback, implicit registry change or automatic download |
| Missing registry data and failed metadata request | Honest unavailable/error state, not a fabricated zero count |
| Tabularium companion UI: zero / large / unavailable stats, quick route changes | Correct compact count + exact accessible label; distinct states; disposed response cannot overwrite new page |

Also test focused dialogs in StrictMode, failed save/refresh, all affected Monaco
surfaces (SQL, cell/diff, AI/query/config/MCP/explain), high contrast and long
translated labels. Automated tests cover failure/rollback and
stale-response paths, but native file dialogs, WebView focus, CSP and OS events
still require this real interaction.

## Cleanup and acceptance record

Stop the app and both fixture processes (`quit` or Ctrl-C). Remove only the
specifically created disposable profile/VM and test save-dialog outputs. Keep
logs/screenshots and original backups until review finishes. Do not run broad
cleanup against a real default config/data directory or delete unrelated Docker
containers.

- [ ] Linux packaged GUI matrix, with build SHA and evidence paths
- [ ] macOS packaged GUI matrix, with build SHA and evidence paths
- [ ] Windows packaged GUI matrix, with build SHA and evidence paths
- [ ] Original-author live/published journey after actual supporting release
- [ ] Imported/personal-author live journey with rights reviewed
- [ ] Actual old-client mitigation and protected-profile upgrade/downgrade
- [ ] Operator staging/rollback rehearsal and published schema/tooling availability
