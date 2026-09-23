# Historical checkpoint 3: schemas, resolver and storage primitives

For subsequent catalog/lifecycle/selection work and current limitations, see
[CATALOG-CHECKPOINT.md](./CATALOG-CHECKPOINT.md). Results below describe checkpoint 3.

This is **partial implementation evidence**, not end-to-end acceptance of #791.
The working tree is uncommitted and has not been pushed. PR #793 remains open.

## Implemented in this checkpoint

- Bundled local assets under `src/schemas/`: definition, manifest, concrete
  limits, frozen light/dark/high-contrast fallback bases and an operator-only
  theme kind extension example. `$id` URLs identify the schemas; publication
  at those URLs has NOT been performed or verified.
- New definitions expose implemented app palette leaves, local font-family
  lists, numeric border radii, registered Monaco colors and a bounded subset
  of actual SQL tokens. Unsupported fields, ownership flags, named asset
  aliases, external inheritance and executable declarations are rejected.
- V1 defaults are frozen independently of future builtin changes. Palette
  leaves merge; font lists replace; generated editor defaults precede explicit
  colors/rules. Ordered rule updates are coalesced by token before Monaco's
  color-ID allocation; otherwise 1,024 valid overwrites overflow its bit fields.
  Original source rule order is retained. Alpha is composed numerically.
  CSS generic font families remain unquoted, including ui-monospace and cursive.
- Host contribution descriptors are separate from source definitions and
  resolved themes. Original legacy values are retained separately. The
  builtin registry now uses the legacy compatibility adapter, preserving all
  golden visual outputs and named editor assets.
- Resolved editor data is associated with runtime objects through a WeakMap,
  not an author-serializable flag. Monaco definition caching is per module
  instance and actual content, allowing same-ID updates and retries.
- Selection IDs containing colons cannot be used directly as Monaco names.
  A collision-free private UTF-16-based name adapter is used by the loader and
  all 11 editor bindings. Ordinary builtin/legacy names remain unchanged;
  stored IDs are never rewritten. Reserved renderer-prefix names are encoded
  too, preventing a legacy ID from colliding with an installed renderer name.
  Monaco builtin base names are protected from author overrides. Previously
  invalid renderer names now resolve without relying on exception fallback;
  this is intentional renderer hardening, not an on-disk identity migration.
- Actual Monaco engine tests cover light/dark/high-contrast bundled/installed
  equivalence, SQL foregrounds/styles, same-ID updates and high rule counts.
  Named assets are matched only against own registered properties, never
  inherited members such as constructor or __proto__.
  Token backgrounds are rejected in v1: Monaco can encode them, but its normal
  DOM token renderer does not paint them. Legacy fields are not removed.
- TS and Rust use the same schemas and 34 validation vectors. Parsers reject
  duplicate decoded keys, malformed Unicode, excessive bytes/depth/nodes and
  non-finite numbers. SemVer build metadata does not alter version precedence.
- Native registry keys hash the host's parsed HTTP(S) base URL with canonical
  host/default port handling and trailing slashes removed. Credentials, query
  strings and fragments are rejected. Different base paths remain distinct;
  registry aliases are not automatically migrated or equated.
- Native universal ZIP validation checks actual definitions, identity,
  version/floor, paths, modes, CRC/decompression errors and concrete limits
  before staging. Referenced definitions plus `.tabularium`, optional README
  and license text are the only regular payload files allowed.
- ZIP preflight occurs **before** constructing `ZipArchive`: its IndexMap
  otherwise coalesces duplicate central-directory names. The supported profile
  is single-disk stored/deflated ZIP, with ordinary headers or signed data
  descriptors. ZIP64, SFX/prefixed/hidden payloads, alternate-name metadata,
  encryption, links, special/executable files, path collisions and unexpected
  files/directories are rejected. Unknown benign ZIP metadata is not extracted.
- Storage primitives keep each package under `<root>/<registry-key>/<package>`.
  They use a cross-process namespace lock, private staging, original file
  bytes, a host journal, rename replacement and rollback. Failed rollback
  retains the backup and journal for explicit, idempotent recovery. Catalog
  reads will not be responsible for recovery side effects.
- Cancellation is honored before commit. Once the non-interruptible commit
  section begins, success is reported as committed even if a later cancel
  request arrives. Cleanup warnings must not disguise a committed update as
  failure or suppress its eventual refresh event.

## Actual verification

| Check | Result |
| --- | --- |
| Full frontend suite | 4,807 passed / 292 files |
| Targeted theme coverage | 396 tests across 12 files, included in the full passing run |
| Frontend lint and explicit app typecheck | Passed |
| Production frontend build | Passed |
| New native module tests | 31 passed, no ignored tests |
| Full native baseline-protocol run (`--test-threads=2`) | 1,333 passed / 197 ignored |
| Another full native run | Failed one pre-existing intermittent cache test; see below |
| Formatting, new native files only | Passed |
| Repository-wide native formatting | Failed in the same 82 baseline files; no cleanup performed |
| Strict all-target Clippy | Failed: 122 lib / 129 lib-test diagnostics (overlapping), zero new-module diagnostics |
| Linux debug binary build and `--version` | Passed, reports 0.24.0; not a GUI/platform acceptance test |
| Actual Tabularium schema library, offline | Two valid theme manifests accepted under kind-specific replacement; driver/global rules unchanged |

The 31 native tests include multiple hostile-archive cases, deterministic ZIP
header bit mutations, six precommit cancellation points, injected replacement
and rollback failures, lock contention, namespace isolation, corrupt recovery
records, symlinked storage paths and untouched personal/config sentinel files.
They do not establish full application lifecycle or preference behavior.
The 18-test Monaco runtime suite covers the actual theme/token engine in
jsdom and the renderer-ID helper, not a complete mounted browser editor,
screenshot comparison or native GUI session.

### Newly reproduced baseline test intermittency

`plugins::connection_metadata::tests::cache_distinguishes_connection_parameters_and_canonicalizes_extras`
failed in one full run. An isolated snapshot of main commit
`d044381c536a3b9e4b576b1ed33fcce39efcf4b1` reproduced the same assertion on the
third standalone invocation. Source/test SHA-256 hashes match the feature tree.
Both dependency graphs enable `serde_json/preserve_order` through the existing
`toon-format` dependency; the cache's assumption that conversion through Value
sorts HashMap keys is therefore invalid. This is not caused by the new schema
dependency, and lowering test parallelism does NOT fix its nondeterminism.

The failure and successful run are both retained as evidence. No cache code,
assertion or dependency feature was altered to manufacture a passing suite.

## Important unfinished boundaries

These native functions are exported Rust primitives, **not registered theme
installation/catalog commands**. They are not yet integrated into registry
transport, driver kind dispatch, native theme ownership or the Appearance UI.
No real user profile or production registry was used.

Still required:

1. Combined native catalog, immutable builtin/package boundaries, safe legacy
   CRUD/roundtrips, independent duplication and additive personal storage.
2. Kind-aware transport/startup isolation, integrity/universal asset selection,
   download/cancellation wiring, events and package disable/uninstall/update.
3. Persisted versus effective versus preview selections, non-mutating hydration,
   missing/reinstall behavior and upgrade/downgrade protection.
4. Translated accessible Appearance/discovery, VS Code conversion, author tools,
   faithful package export, publishing guide and isolated full author journeys.
5. Registry card/detail browser, accessibility and request-race integration for
   the separately authorized UI patch; no API/operator changes are authorized.
6. Full feature review and manual Linux/macOS/Windows evidence. The actual first
   supporting release is unassigned: **0.99.0 is only a test fixture floor**.
   Old-client safety, operator enablement, schema publication, deployment order
   and rollback remain release gates.

Full logs, impact analyses, source snapshots, hashes and local binary artifacts
are retained in the task journal at `.git/pr793/` in the original checkout.
No Actions, push, release, production counter/admin calls or merge occurred.
