# Making a Tabularis theme

Theme packages are **data, not plugins that execute code**. The theme command is
shipped alongside the existing driver scaffolder, but has its own entry point and
never changes driver defaults, templates, migration or APIs. Its bundled validator
is the same TypeScript validator and schemas used by Tabularis; the native host
independently enforces the same contract. This small companion entry point also
makes the generated repository self-contained and usable offline.

## 1. Try a theme locally

Open **Settings → Appearance → Manage themes**. Builtin themes remain available
offline. Installed packages are read-only; **Duplicate as personal** makes an
independent editable copy. A package operation affects all its variants.

- **Preview** changes the application temporarily and displays a read-only SQL
  sample using the shared Monaco renderer. No query is executed. **Cancel** or
  Escape restores the saved selection, taking the current system mode into account.
- **Apply** explicitly saves the selected application theme. The separate editor
  selection and light/dark system selections remain available above the manager.
- **Edit personal theme** edits supported JSON fields. Preview before saving.
  Modern definitions use revision checks; reload if another edit wins the race.
- **Import Tabularis JSON** retains the existing standalone format. It is not the
  VS Code importer and does not guess the format of arbitrary theme documents.
- **Import from VS Code** accepts local JSON/JSONC, including comments/trailing
  commas. Choose a mode if it is missing/ambiguous. Review and acknowledge the
  conversion diagnostics. Save makes a personal theme; applying it is a separate
  explicit checkbox. Cancel creates no file.

The VS Code converter deliberately does not load includes, `.tmTheme` files,
remote URLs or VSIX bundles, or execute extensions. Semantic tokens and unsupported
scopes/settings are diagnosed. TextMate-to-Monaco SQL mappings are approximations,
not full VS Code parity. Monaco discards token alpha: declarative token colors are
materialized against the base editor background and do not recomposite against
selection highlights. Source RGBA declarations remain editable.

Importing does **not** grant redistribution rights. Retain original attribution
and obtain the necessary license permissions before publishing a derivative.

## 2. Create a two-variant repository

From a Tabularis source checkout (no account needed):

```sh
pnpm install --frozen-lockfile
pnpm --filter @tabularis/create-plugin build
node packages/create-plugin/dist/theme.js --help
node packages/create-plugin/dist/theme.js scaffold my-theme \
  --dir ../my-theme --min-runtime-version <first-supporting-version>
```

After the updated tooling package is published, the equivalent companion binary
is `tabularis-theme`, distributed by `@tabularis/create-plugin`. Do not assume an
older published tooling version contains it. The existing
`tabularis-create-plugin` binary still scaffolds drivers by default.

**Release gate:** the first supporting application release has not been assigned
by this feature branch. Do not publish with the old `0.24.0` release as the floor
just because a development binary currently reports that number. The verification
fixtures explicitly use `0.24.0` only with the feature test binary in disposable
profiles; this is not a release recommendation. There is no runtime-check bypass.

Scaffolding refuses an existing destination and produces:

```text
.tabularium                  # kind=theme, version, runtime floor, variants
themes/light.json
themes/dark.json
README.md
LICENSE.txt                  # replace UNLICENSED before redistribution
.gitignore
package.json                 # convenience commands; no dependencies to install
tools/theme.mjs               # bundled offline validator/scaffolder/packager
.github/workflows/validate.yml # read-only branch/PR validation and packaging
.github/workflows/release.yml # tag-only, pinned actions, draft release
.vscode/settings.json        # recognize .tabularium as JSON
```

Run everything below from the generated repository. Node 22 is used in CI:

```sh
node tools/theme.mjs validate .
node tools/theme.mjs package . --output theme-universal.zip
```

The copied tool works offline and needs no `pnpm install` in the generated
repository. The scripts in `package.json` are conveniences for `pnpm run validate`
and `pnpm run package`. Existing output ZIPs are never overwritten; choose another
filename or explicitly remove your previous generated artifact.

## 3. Edit and validate

The root manifest names every variant and its relative JSON path:

```json
{
  "$schema": "https://registry.tabularis.dev/manifest.schema.json?kind=theme",
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "kind": "theme",
  "min_runtime_version": "<first-supporting-version>",
  "theme_schema_version": 1,
  "theme_variants": [
    { "id": "light", "name": "Light", "file": "themes/light.json" },
    { "id": "dark", "name": "Dark", "file": "themes/dark.json" }
  ]
}
```

Replace the placeholder runtime version with a canonical exact SemVer before
validation. `id` is the stable package identifier (a lowercase slug) used for the
installation folder and selection IDs; `name` is the display name. Legacy manifests
without `id` must keep `name` a slug, because it then serves as the identifier.
Variant IDs stay stable across releases. Never reuse a package/variant ID for a
different theme. Registry identity is part of the host-issued selection ID, so the
same package ID on two registries is not the same installed theme.

The host validates only the runtime contract: identity, versions, `kind`,
`theme_schema_version` and `theme_variants`. Catalog metadata such as `description`,
`tags`, `license`, `screenshots` and links is owned and validated by the Tabularium
registry (`tabularium validate .tabularium --kind theme`), so new registry fields
never break installation.

A small definition is enough; missing values use permanent host-owned bases:

```json
{
  "$schema": "https://raw.githubusercontent.com/TabularisDB/tabularis/main/src/schemas/theme-definition-v1.json",
  "schemaVersion": 1,
  "mode": "dark",
  "attribution": "Your name; license and upstream credits",
  "colors": { "accent": { "primary": "#91b6ff" } },
  "editor": {
    "colors": { "editor.background": "#101820" },
    "rules": [
      { "token": "keyword.sql", "foreground": "#91b6ff", "fontStyle": "bold" }
    ]
  }
}
```

Modes are `light`, `dark`, and `high-contrast`. Supported application leaves,
local font-family lists, radii, registered editor color keys and SQL token rules
are defined in `src/schemas/theme-definition-v1.json` in Tabularis. Unknown
fields fail validation. The optional `$schema` property enables completion in external authoring projects.
The manifest hint points to Tabularium's existing kind-scoped schema; the theme
hint points directly to the host's versioned definition on GitHub (raw JSON).
Targeting a custom registry requires adjusting the manifest hint only.

The host and offline tool always use their bundled schemas, never schemas selected
by an author's `$schema` URL. The package manifest schema in this checkout is an
internal host contract, not a second public registry manifest schema. Monaco
settings remain under `editor`; no `monaco` alias is introduced.

The definition is served directly from the Tabularis GitHub repository. No schema
mirror, synchronization script or Tabularium deployment is needed. Merge and ship
support for `$schema` before declaring compatibility with a released client.

Limits include 8 MiB archive / 16 MiB expansion / 128 entries / 32 variants,
64 KiB manifest / 256 KiB definition, 16 JSON levels / 32,768 nodes / 1,024 token
rules. Duplicate decoded JSON keys, invalid Unicode, traversal, device names,
case collisions, symlinks and unsupported payloads are rejected. The generated
ZIP contains only `.tabularium`, referenced definitions and optional UTF-8
`README.md`, `LICENSE`, `LICENSE.txt`. Repository workflows/tools/screenshots are
not executable archive payloads. ZIPs have stable ordering, timestamps and modes.

## 4. Export a personal or imported theme

**Export standalone JSON** is still a separate action. Historical documents keep
their original metadata and wire spelling. New independent legacy snapshots use
an explicit `themeSnapshotVersion: 1` JSON container with the original source
string and exact editor snapshot. Flattening this into historical JSON would append
legacy SQL rules and change rendering. New clients preview/import the container
through the native snapshot API; old clients reject it rather than silently
misrendering it. Original files are not rewritten by exporting. Legacy getters
remain for historical representations; use `get_theme_catalog` for modern
snapshots and definitions. See `src/schemas/theme-snapshot-v1.json`.

**Export author package** asks for package name/version/runtime floor, license text
and acknowledgement of redistribution rights. A new-format personal/imported theme
retains its author declarations. The export contains one variant; to make a light/
dark family, extract its referenced definition into a scaffold and add variants to
`.tabularium`, then validate/package with the bundled tool.

Some legacy themes cannot be represented faithfully by declarative v1: token
backgrounds, `inherit=false`, unsupported typography/spacing or named-editor
inheritance/default differences are examples. Export refuses these with a reason
instead of changing appearance silently. Keep the standalone JSON export, or make
an intentionally adapted new-format theme and review its preview. Do not describe
an adapted theme as a pixel-identical conversion.

## 5. Preview and install the ZIP

In Appearance choose **Local package**, select the ZIP and preview its variants.
No file is installed just by opening/previewing it. Installation is bound to the
validated archive digest: if you rebuild it, preview again before installing.
The app revalidates all bytes before the atomic commit.

Installation does **not** select a theme. Close the dialog and choose a variant
explicitly. Disable/uninstall retains saved variant IDs; an offline fallback is
used while unavailable, and reinstall/enable restores availability. Refresh and
same-ID updates do not silently repair preferences.

## 6. Publish a release, then submit through Tabularium

Generated repositories validate both variants and construct the ZIP on branch
pushes and pull requests, with read-only permissions. Tag releases validate the
exact manifest/tag match separately. No dependency install or remote schema
fetch is needed for these host-contract checks.

For an additional live registry check, POST `{ "text": "<raw .tabularium JSON>",
"kind": "theme" }` to `https://registry.tabularis.dev/api/manifest/validate`.
Fail CI unless the HTTP request succeeds **and** the response has `ok: true`:
validation errors are returned as HTTP 200 with `ok: false`. This request needs
no credentials and does not submit, approve or publish a package. It checks the
manifest only; keep the offline variant/archive checks. A registry outage fails
this additional check rather than silently skipping it.

1. Replace the placeholder license, keep required attribution, review both
   variants and take screenshots. Host screenshots in the repository and use
   HTTPS metadata URLs (do not put arbitrary image/executable files in the ZIP).
2. Create a GitHub repository and commit your generated source and offline tool.
   Check `.tabularium` and ensure its runtime floor refers to an actual supporting
   Tabularis release.
3. Choose the release version and validate its exact tag:

   ```sh
   node tools/theme.mjs validate . --tag v1.0.0
   node tools/theme.mjs package . --tag v1.0.0 --output review-universal.zip
   git tag v1.0.0
   git push origin v1.0.0
   ```

4. The generated workflow runs only on version tags, validates the tag/manifest
   match, packages offline and creates a **draft** release with
   `theme-universal.zip`. Actions are SHA-pinned, checkout credentials are not
   persisted, and only the release job receives `contents: write`. It uses the
   job token, not an embedded secret or additional PAT. No untrusted-PR write job
   is generated. Review the draft and artifact before publishing it.
5. Submit the repository through the registry's existing workflow. The operator
   must have enabled/configured the theme kind and its replacement extension
   schema. Moderation, authorization and release ingestion are independent gates.
   A GitHub release does not automatically approve or list your theme.
6. After approval/ingestion, Appearance discovery shows the package and its
   aggregate request-count downloads. Install/update uses the existing tracked
   latest or explicit-version endpoint with `universal` selection. Preview and
   local import do not increment downloads. Counts are not unique-user metrics.

This feature's tests never publish a real release or change registry administration.

## Updating, offline use and troubleshooting

- Keep package/variant IDs stable, increment `.tabularium.version`, validate the
  matching tag and repeat the draft-release review. Use Appearance discovery or
  **Update package** to explicitly install the chosen release. Failed download,
  hash/signature/manifest/runtime validation or cancellation preserves the old
  installation. A committed operation followed by a refresh error must not be
  retried as though no installation occurred.
- Changing configured registries requires refreshing discovery. A deep link from
  a different registry cannot silently install from it: explicitly configure the
  intended registry first. Kind selection uses operator-defined kind tags, not
  arbitrary descriptive tags. Ambiguous kinds are refused.
- Installed themes and builtins remain usable offline. Missing/corrupt entries
  appear in catalog diagnostics rather than blocking all themes.
- A metadata/signature failure is not a reason to disable validation or remove a
  runtime floor. Fix the release/registry configuration and try again.
- Interrupted transactions have explicit recovery; catalog reads never repair
  storage. Preserve the profile and journals for troubleshooting.

## Upgrade and downgrade safety

New personal definitions/snapshots live in `theme-personal-v1`; packages live in
`plugins/themes/<package-name>/` in the app data directory, beside `plugins/drivers/<package-name>/` driver bundles and separate from historical standalone `themes/*.json` files in the config directory. Discovery also accepts manually copied `plugins/<package-name>/` bundles, using their manifest `kind`; kind-scoped copies take precedence. Every install or update writes to the kind-scoped directory, never the root or a registry-hash directory. Folder names map `theme` to `themes`, `driver` to `drivers`, and otherwise keep the kind unchanged. Merely reading the
catalog never migrates or changes originals. Old clients do not understand new
variant IDs or modern personal documents. A replay of the old provider proves that
it writes its fallback over an unavailable new selection at startup. A runtime
floor alone does not protect a shared profile; use client protection/backports or
isolated profiles. Stop all clients before backing up the profile. Before a downgrade,
export personal themes as standalone JSON where supported, and explicitly select
builtins for application, system light/dark and editor choices. Keep the modern
storage directories intact. After upgrading again, restore choices explicitly or
restore the backed-up configuration. Do not infer safe downgrade behavior from a
successful unit test or from a coincident development version number.

Cross-platform GUI evidence, the first supporting application/tooling release,
old-client rollout protections and operator/schema deployment order remain
maintainer release gates. They are not supplied by the scaffold or a local build.
