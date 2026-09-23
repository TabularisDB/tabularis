# Native catalog and selection checkpoint — not release acceptance

This supersedes the implementation-status section of checkpoint 3, not its
historical evidence. The feature is still incomplete and no issue acceptance
checkbox is satisfied by this document alone.

## Implemented locally

- One native catalog combines all 12 offline builtins, historical personal files,
  modern personal snapshots/definitions and namespaced installed variants.
- Native provenance, immutable builtin/package ownership, host-issued import and
  duplicate IDs, raw legacy metadata preservation and v1 optimistic revisions.
- Reads never create directories, repair transactions or save preferences. Catalog
  enumeration, retained/source bytes and JSON parsing are bounded; symlinks and
  special files (including FIFO locks) are rejected before opening.
- Native commands for validated standalone/local-ZIP preview, local/registry
  installation, cancellation, package disable/enable/uninstall and explicit
  recovery. Registry discovery binds installs to its native registry fingerprint.
  Universal assets and existing SDK/integrity/tracked routes are used.
- Executable plugin paths reject theme/unknown kinds before extraction permissions
  and registration. Missing kind remains the explicit legacy driver/UI-only rule.
  Kind refusal does not fall back to the legacy registry.
- ThemeProvider consumes the native catalog through the shared resolver. Saved,
  effective and preview choices are separate. Hydration, OS events, package
  refresh and missing-package fallback never save configuration. Explicit writes
  are queued; missing package choices survive removal/disable and recover when
  contributions become available again.
- Native-issued personal creation replaces timestamp IDs. Explicit legacy personal
  deletion still resets its referenced choices; package removal does not.
- Same-ID changes, post-commit refresh failures, stale catalog responses, original
  editor revisions, StrictMode and system changes during preview have tests.
- Pure bounded VS Code conversion is implemented, with strict JSONC separation,
  null-prototype AST values and honest conversion diagnostics. See
  `VSCODE-IMPORT-CONTRACT.md`. No importer UI exists yet.

## Actual local verification

| Check | Result |
| --- | --- |
| Full frontend | 4,849 tests / 296 files passed |
| Frontend lint / application typecheck / production build | Passed |
| Actual Monaco engine / golden replay after alpha correction | Passed |
| Full native locked/offline replay | 1,356 passed / 197 ignored |
| Earlier native replay | Failed only on independently reproduced baseline metadata-cache ordering flake |
| Strict all-target Clippy | Fails: baseline 122 library / 129 library-test diagnostics; no checkpoint-owned module diagnostics in the inspected run |
| Task-owned native formatting | Scoped formatting applied; repository-wide baseline formatting is not repaired |
| Linux debug binary / --version | Built and ran; reports 0.24.0, not an assigned supporting release |
| GUI / complete lifecycle / author journeys / macOS / Windows | Not run |

Frontend output retains the three existing jsdom canvas warnings. The earlier
native cache failure remains visible and unfixed; a later passing run is not a
fix. No tests were disabled to obtain passing output.

The replay found and fixed an error-prefix regression in the driver compatibility
path and a missing edit/export path for newly duplicated legacy snapshots. The
initial failing logs are retained. Monaco also proved that its token engine drops
alpha: new v1 resolution now explicitly flattens token opacity against the base
editor background. Source RGBA remains intact; selection highlights do not
recomposite token opacity. All legacy golden rendering remains unchanged.

## Unfinished boundaries and review priorities

- No grouped Appearance manager, accessible preview workflow, registry discovery
  UI, deep-link dispatch, local package controls or explicit author package export.
- No fake-HTTP replay of explicit/latest tracked downloads, redirect/integrity,
  registry races, update/cancellation or complete driver/UI-extension lifecycle.
- No author scaffold, offline tool distribution, deterministic packager, generated
  release workflow, publishing guide or complete original/imported author journey.
- Historical standalone export of a modern legacy snapshot still exports its raw
  legacy source, which may contain a named asset alias. The out-of-band exact
  editor snapshot is retained in modern storage, not in that historical export.
  Faithful snapshot export/roundtrip behavior needs explicit design and real-engine
  tests before acceptance; do not describe it as complete portability.
- Review editor snapshot validation and compatibility wrappers alongside the GUI,
  not only the new provider path. Snapshot metadata is visual data, never authority.
- Upgrade/downgrade preservation and the actual first supporting version remain
  unresolved release gates. 0.99.0 remains fixture-only. Old clients must not be
  assumed to understand new selection IDs or modern personal storage.
- Schema publication, operator-only kind enablement/rollback, platform evidence,
  final full-diff PR skill review and ancestry-preserving delivery are not done.

All code remains local/uncommitted. No code push, Actions dispatch, release,
production counter/admin call, real-profile test or merge occurred. PR #793 stays
open; its remote code is not this local checkpoint.
