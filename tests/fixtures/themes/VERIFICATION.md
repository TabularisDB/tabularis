# #791 / PR #793 — implementation and verification

## Verdict and scope

**Implementation delivered for review; request acceptance evidence before merge /
public rollout.** Automated checks below are not Linux/macOS/Windows GUI acceptance,
a real published author journey or proof that an assigned older release is safe.
The PR must remain OPEN/unmerged. No production kind, schema, database, counter,
package release or operator setting was changed during this work.

Core work is on `feat/791-installable-theme-packages`, in the isolated
`tabularis-pr793-clean` worktree, based on
`d044381c536a3b9e4b576b1ed33fcce39efcf4b1`. Original remote PR ancestry
`9864ddf864d817b7e998840a8c9f6470c487ad50` is retained; its two temporary verification
files are intentionally excluded from the delivered tree. The separate approved
Tabularium change is `fix/theme-download-counts`, based on
`f92f0fd7b5b27dc9b05e401e23721151bd42faf8`, limited to frontend count presentation.

## Requirement → implementation → evidence

| Area | Delivered behavior | Evidence |
| --- | --- | --- |
| Existing rendering | All 12 offline builtin identities, CSS output, actual editor definitions and named-asset precedence retained | Immutable pre-change golden fixtures; `compatibilityBaseline.test.ts`, native `theme_compatibility` |
| Declarative contract | Closed v1 manifest/definitions, frozen offline bases, supported color/font/radius/SQL editor controls, no author trust or executable authority | Public schemas, 34 shared validation vectors, resolver/parity tests |
| Runtime | Shared legacy/v1 resolver; injective private Monaco names; ordered rule coalescing, explicit style reset, correct alpha materialization | Real Monaco engine replay, including the previously failing 1024-rule and colon-ID cases |
| Native security | ZIP structural preflight before library indexing, hard bounds, allowlisted payloads, safe paths, links/special/executable rejection | `archive`, `zip_layout`, storage and catalog safety tests |
| Transactions | Namespaced locks, staging/journal/backup/rename, cancellation, rollback, explicit idempotent recovery | Native storage/lifecycle/transport failure injection; no implicit recovery on reads |
| Catalog / personal CRUD | Native ownership and stable IDs; read-only builtin/installed entries; raw historical metadata preserved; revision-checked modern edits | Catalog/snapshot tests, opaque large-number and marker-collision cases, boundary-import rejection |
| Exact snapshots | Additive portable container retains raw legacy source separately from exact editor; old clients reject rather than misrender | Actual engine fidelity test, native round trip/edit tests, 16 shared editor-schema vectors |
| Selection | Saved preference, effective fallback and transient preview separated; no hydration/OS/catalog repair writes; unavailable IDs restore on return | Provider tests, root StrictMode, queued/failed saves and stale-response cases |
| Management | Grouped Appearance UI, missing-selection diagnostics, preview/apply/cancel, duplicate/edit/export/delete, enable/remove/recovery | Component tests, real native author ZIP lifecycle journeys; GUI matrix still open |
| Registry | Operator kind keys, bounded theme pagination, universal-only assets, registry-bound package updates and direct deep-link lookup | Native fake HTTP, SDK-backed loopback fixture and dispatch tests |
| Downloads | Discovery, metadata, README, preview, local install and selection do not count; latest/pinned registry requests use tracked routes exactly once | Fixture counts include requests even without redirect=1; integrity/asset paths excluded |
| Read-only previews | Bounded sanitized theme README, no auto remote media, explicit safe screenshot links; driver README unchanged | DOM sanitizer/focus tests and native bounded metadata tests |
| Driver coexistence | Theme/unknown kinds rejected before executable handling; absent kind remains legacy driver/UI-extension compatible | Installer/kind tests plus real offline network/file/UI driver scaffold cargo-check smoke |
| VS Code | Local JSON/JSONC only; no includes, network, VSIX or execution; explicit mode and loss acknowledgement; useful recognized controls only | Converter/UI tests and generated imported-author ZIPs |
| Author tools | Separate `tabularis-theme` binary; actual-file offline validation, deterministic ZIP, two variants, pinned draft-release workflow, notices and guide | 37 package tests, real author smoke, native consumption of generated artifacts |
| Localization | All theme labels and diagnostics across 11 locales, including placeholders | Leaf-key/nonempty/interpolation parity tests |
| Binary export | Main-window write operation, only save-dialog-granted paths; no filesystem scope expansion | Narrow Tauri capability test; actual native save dialog remains a GUI check |
| Registry companion | Compact/exact accessible counts and explicit loading/empty/unavailable/populated states with disposed-request protection | 35 Bun tests / 59 assertions, Svelte check, build, scoped lint/format; no API/operator change |

## Final automated replay

Commands ran against the implementation branch/tree, not the old remote CI-only
head. Native tests/build used a disposable Linux container with GTK/WebKit
prerequisites, persistent caches under `/projects`, and network disconnected.
No host prerequisites or real application profiles were changed. Cargo was
locked/offline; driver scaffold checks used `CARGO_NET_OFFLINE=true`.

| Check | Result |
| --- | --- |
| `pnpm test` and CI `pnpm run test:coverage` | **4,931 passed / 314 files** in both; overall V8 coverage 54.75% statements / 49.67% branches / 45.56% functions / 55.48% lines |
| `pnpm exec tsc --noEmit -p tsconfig.app.json` | Passed |
| `pnpm lint` | Passed; only generated create-plugin dist excluded, not source/tests |
| `pnpm build` | Passed |
| `cargo test --locked --offline` | **1,378 library + 4 compatibility passed; 198 ignored** |
| Separate opt-in manual fixture SDK/installer test | Passed once for original and once for imported fixture family |
| `cargo build --locked --offline --bin tabularis` | Passed; development binary reports `tabularis 0.24.0` |
| Author package test/build and `smoke:theme` | **37 / 4 files passed**; real scaffold/edit/validate/package/export smoke passed |
| Existing driver scaffold smoke | Network, file and UI-only templates cargo-check successfully offline |
| Tabularium frontend Bun tests | **35 passed / 59 assertions** |
| Tabularium `bun run --cwd apps/frontend check` / `build` | Passed; Svelte **0 errors / 0 warnings** |
| Scoped registry Biome / Svelte Prettier | Passed |
| Full native formatting | Still fails in 82 baseline files; owned changed-line rustfmt comparison is clean; no baseline-wide cleanup performed |
| Strict all-target native Clippy | Still fails: 122 library / 129 library-test baseline diagnostics (overlapping); no new owned diagnostics in final comparison |

The ignored native count is the existing 197 plus one newly added explicitly
opt-in human-fixture test; that new test was actually run separately twice.
Ignored integration/platform cases are not counted as passed. An existing
connection-metadata ordering flake was independently reproduced on untouched
main; a later green run is not a fix for it.

Earlier failures remain in the local evidence journal: incomplete Appearance
mocks, exporter/close-selector cases, an inert-DocumentFragment DOMPurify error,
a malformed snapshot schema, one new MSRV lint, and a driver smoke launched
without its offline environment. These were corrected or replayed accurately;
none was suppressed by weakening assertions or broad rule disables. A Bun command
that printed usage with exit zero was **not** counted as check/build evidence;
the actual commands above were rerun successfully.

## Review and impact

Fresh full GitNexus rebuilds, rather than the previously unreliable incremental
index, were used for both worktrees. Core source index: 24,460 nodes / 57,822 edges,
1,020 reported flows before final documentation/format refresh. The broad theme /
Monaco / native registration changes are **CRITICAL** scope, as authorized:
`loadMonacoTheme` has 17 resolved direct callers and 20 affected reported flows.
Registry companion scope is **MEDIUM**, 11 files / 24 symbols / 2 reported flows.
The final pre-commit scope check is recorded in the local journal/PR handoff.

These graphs explicitly report truncated flow exploration and unresolved Tauri /
object-property edges. Empty caller lists were not treated as proof of safety.
Command registrations, argument shapes, editor consumers and driver manifest /
startup paths were inspected in source. Shared-file edits are bounded to the
feature; unrelated baseline formatting/Clippy remediation remains excluded.

## Release gates — not satisfied by automated tests

1. Assign the actual first supporting runtime and tooling releases. Development
   `0.24.0` and earlier illustrative `0.99.0` fixtures are **not** promises that a
   public binary supports this feature. Do not publish fixture packages as-is.
2. Resolve old-client profile safety. The frozen original provider replay proves
   it overwrites an unavailable new selection with its fallback on startup.
   A passing hazard test is not safe downgrade acceptance. Backport protection or
   isolate profiles; use stopped-app backups and explicit restoration, never an
   automatic rewrite over deliberate user preferences.
3. Test older registry/list/install routes and kind visibility before operator
   enablement. The new client's guard does not retrofit older binaries. A runtime
   floor alone does not protect shared profiles or all legacy installer paths.
4. Publish schemas/tooling only with that release decision, then rehearse staging
   operator kind registration (theme extensions replace driver extensions),
   admission validation, tracked redirects, rollout order and rollback. Hiding
   discovery alone does not revoke direct URLs or repair old-client settings.
5. Complete the packaged Linux/macOS/Windows and two real author-activation
   journeys in [MANUAL-TEST-PLAN.md](./MANUAL-TEST-PLAN.md), including focus, OS
   appearance, permissions, actual file dialogs and all Monaco surfaces.

The original/imported author artifacts and loopback server are reproducible
inputs for those checks, not publication evidence. Third-party conversion does
not grant redistribution rights. Earlier `*-CHECKPOINT.md` reports are historical;
this document supersedes their “integration unfinished” status, not their retained
baseline failures or unperformed acceptance gates.
