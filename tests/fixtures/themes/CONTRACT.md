# Theme packages v1: additive contract

Status: implemented additive contract for #791; see `VERIFICATION.md` for actual
evidence and outstanding release gates. This is not a platform/rollout acceptance
claim. Legacy `Theme` JSON remains a
separate compatibility input. Do not run strict new-format validation against
historical personal files or change existing builtin IDs.

## Ownership and identity

Three different objects must remain explicit:

1. An author definition contains visual data and optional attribution only.
2. A contribution descriptor is issued by the host: origin, mutability,
   installed registry/package identity, stable variant ID and content revision.
3. A resolved runtime theme contains complete CSS/editor data ready for the
   single application pipeline.

Installed selection IDs are `theme:<registry-key>:<package-name>:<variant-id>`.
`registry-key` is the lowercase SHA-256 hex of the canonical registry URL,
computed and stored by native code, not supplied in a downloaded manifest.
The URL canonicalization and trust binding must be verified natively before
issuing this key. Package and variant slugs are lowercase ASCII, start with a
letter, have at most 64 characters, and exclude Windows reserved device names.
Colons are never allowed in slug components. This ID is for preferences, never
an OS filename. Installed directories are separate from personal files and
use only validated registry keys/slugs as path components.

Version/content changes do not change the variant selection ID. Descriptors
carry a revision derived from validated package contents. Different registries
remain distinct. Renaming a variant is removal/addition, not an implicit
migration. Existing builtin and personal IDs are retained, and collisions are
rejected instead of renaming historical data.

Missing/disabled/uninstalled package selections retain their saved ID. The
host resolves an offline fallback without persisting it; reinstall restores
the saved preference. Installing never selects a variant. Preview state is
memory-only and independent of persisted static/system/editor preferences.

## New manifest and definitions

The root archive manifest remains `.tabularium`, with `kind: "theme"`, the
registry's canonical `name`/`version`, and a required exact SemVer
`min_runtime_version`. Do not inherit the legacy driver's permissive invalid-
version/dev-build bypass for new theme packages. The actual first supporting
release is still a maintainer rollout decision, not the current baseline's
`0.24.0`.

A theme-specific, nonempty registry extension schema adds:

- `theme_schema_version`: integer `1`;
- `theme_variants`: 1–32 entries with unique `{ id, name, file }`;
- each referenced definition is a relative `.json` path under `themes/`.

This **replaces**, rather than augments, global driver extensions in the
registry's kind-scoped schema. No theme requirements are added to driver
schemas/defaults. Local schemas and the operator-only extension example are in
`src/schemas/`. An offline check against Tabularium's actual schema library
passes; public schema publication and operator enablement have not occurred.
See `VERIFICATION.md` for current evidence; the earlier checkpoint reports are historical.

Definitions use `schemaVersion: 1` and `mode: light | dark | high-contrast`.
Host-owned permanent offline bases supply omitted values. No cross-package
inheritance, builtin aliases, executable properties, CSS/JS, remote fonts,
custom native icon paths or author-owned trust/mutability flags are permitted.

Supported override surfaces must correspond to implemented application effects:
current application color tokens (excluding unused connection-active/inactive
fields), local font-family choices, border radii, and a bounded supported Monaco
color/rule subset. Do not expose legacy `fontSize`/`spacing` fields as working
new-format tokens while they have no application effect. Unknown new fields
are errors, not silently discarded. Legacy adapters retain their complete
visual/metadata payload instead of going through this strict shape.

Resolver rules: scalar overrides replace; supported nested objects merge by
known leaf token; rule arrays keep author order with later explicit rules
winning per leaf. Source order is retained; the v1 runtime coalesces these
updates into one rule per token before Monaco allocates limited-width color
IDs. Rules support foreground and fontStyle, not backgrounds that the DOM
renderer ignores. Explicit editor overrides win over generated defaults. Named
legacy Monaco assets retain their current precedence through the compatibility
adapter. Existing builtin output must continue to match the golden fixtures.
Alpha is parsed and composed numerically, never created by blindly appending
hex digits. Monaco discards token alpha itself. V1 materializes token foreground
opacity against the effective editor base background (editor over application
over the frozen opaque mode base), including generated and explicit rules.
These are opaque runtime token colors: later selection/highlight backgrounds
do not recomposite them. The original RGBA source is retained for export; CSS
and editor color properties retain their original alpha. Legacy runtime data
is deliberately unchanged. Same-ID revisions invalidate CSS/editor application caches for
every Monaco instance, not just the first mounted editor. Stored selection IDs
are separate from private Monaco names: its identifier grammar forbids colons.
The loader and every React editor binding use the same collision-free name
adapter, without changing preference IDs or allowing builtin base overrides.

## Safety budget

These are hard policy ceilings, to be enforced in native code as well as
shared author/frontend validation. Validation helpers alone do not establish
native enforcement.

| Resource | Ceiling |
| --- | --- |
| Compressed package | 8 MiB |
| Total expanded regular-file bytes | 16 MiB |
| Archive entries (including directories) | 128 |
| Per-entry and total expansion ratio | 100:1 |
| Manifest UTF-8 bytes | 64 KiB |
| Definition / VS Code input UTF-8 bytes | 256 KiB |
| Referenced definitions | 32 |
| JSON nesting | 16 container levels |
| JSON value nodes | 32,768 |
| Token rules per variant | 1,024 |
| Registry/package/variant display label | 128 characters |
| Relative payload path | 240 ASCII characters / 8 components |

Reject duplicate JSON keys at the bounded native input boundary rather than
letting identity/security fields use inconsistent first/last-value semantics.
Archive enforcement must reject traversal, absolute/drive/UNC/device paths,
backslashes, symlinks, case-colliding or duplicate paths, executable payloads
and unsupported file types. Path syntax checks do not replace filesystem
containment/symlink checks or archive entry validation. An ASCII allowlist
avoids encoded separators, ambiguous trailing spaces/dots and platform-specific
path normalization. Directory entries need the same collision accounting as
regular files. V1 accepts single-disk stored/deflated ZIPs, ordinary headers
or signed data descriptors, and optional archive comments. ZIP64, SFX, alternate
path metadata and hidden/unreferenced local records are unsupported. Payloads
are the root manifest, referenced definitions, and optional UTF-8 `README.md`,
`LICENSE` or `LICENSE.txt`; other files and empty unrelated directories fail.
The original central directory must be inspected before a ZIP library can
coalesce duplicate names or allocate metadata from an unbounded entry count.

Downloads are bounded and actual definitions are validated before storage is
touched. Installation uses disposable unique staging, with cancellation
checks and cleanup on all failures. Existing installation/preferences remain
intact until the replacement commit. Emit catalog refresh only after a
committed package operation. Reuse tracked registry transport/integrity,
without invoking executable permissions, driver startup, parsers or UI bundles
for theme packages. Native storage tests now cover validation, staging,
replacement/rollback failures, cancellation before commit and explicit journal
recovery in temporary directories. Once commit starts it is non-interruptible;
a late cancellation must not report an already committed operation as cancelled.
Transport, kind dispatch, post-commit event wiring and selection integration are
implemented. Loopback HTTP and generated-author-archive tests exercise explicit /
latest tracked redirects and updates without real registry requests. Readme and
screenshot metadata never trigger automatic media/download fetches in the theme
UI; screenshots are explicit external-browser links. Driver README behavior is
unchanged. Platform GUI and fully live author activation remain separate gates.

## Compatibility and rollout

Legacy standalone JSON import/export and public native commands remain
available through compatibility wrappers. Reads must not rewrite files.
Duplication creates a host-issued independent personal ID. Unknown legacy
metadata must survive native storage; strict v1 validation is not a destructive
migration. Native/frontend historical field spellings and null/absent optional
fields are covered by baseline fixtures and adapter regression tests.

New independent legacy snapshots cannot be flattened into historical JSON without
changing generated SQL rules. They use a separate standalone `themeSnapshotVersion: 1`
container: raw original source string plus an exact validated editor object, with
closed top-level fields (8 MiB container; legacy source remains capped at 4 MiB).
See `theme-snapshot-v1.json`. Native preview creates nothing; import issues a new
personal ID; edits retain the source and use an expected revision. Historical
standalone exports remain unchanged. Legacy getters remain for historical
representations; modern definitions/snapshots use the combined catalog. The old
native Theme shape rejects the new container instead of silently misrendering it.

Old-client safety must be demonstrated, not inferred from `kind`. The baseline
installer/startup does not yet enforce theme-kind separation and its version
floor accepts invalid values in the legacy path. Operator enablement therefore
remains blocked until the first supporting version and older-client routes,
configuration, rollout ordering and rollback have been tested. No registry
kind enablement or production request is authorized by this contract. The frozen
pre-feature provider replay now demonstrates a concrete hazard: opening a profile
with an unavailable new ID in the old client writes its fallback to `config.theme`.
A green hazard regression test does not make downgrade safe. See
`pre-feature/README.md` and the rollout section of `VERIFICATION.md`.

Maintainer scope decisions: bounded HIGH/CRITICAL theme/plugin work is approved;
separate Tabularium download-count card/detail UI correction is approved;
baseline-wide formatting/Clippy cleanup is explicitly excluded. Pre-existing
check failures continue to be reported accurately.
