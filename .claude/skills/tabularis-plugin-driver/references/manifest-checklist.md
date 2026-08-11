# Manifest Checklist

Use this checklist when authoring `.tabularium` for a Tabularis database plugin. `.tabularium` at the plugin root is the canonical manifest; `manifest.json` survives only as a host-side legacy fallback and is not a first-class source for the registry.

## Required Core Fields

- `name` — lowercase slug matching `^[a-z][a-z0-9-]*$`; this is the registry slug, pinned at first submit
- `version` — semver, **no leading `v`**; must equal the release tag stripped of any `v` prefix
- `capabilities`

Optional but constrained:

- `description` — optional, max **280 chars**
- `tags` — max 16, each ≤ 30 chars
- `category`, `license` — each ≤ 40 chars

There is no `id` field in the registry schema — the host's legacy `id` is ignored on submit; the registry keys everything off `name`.

For driver plugins, also include:

- `kind: "driver"` (plus `engine`, `paradigms`)
- `default_port`
- `executable`
- `data_types`

## Recommended Modern Fields

- `default_username`
- `color` (host/extension field, not part of the registry core schema)
- `icon`
- `settings`
- `ui_extensions`

## Publishing

- Upload `.tabularium` as a standalone release asset too — GitHub silently renames it to `default.tabularium`; the registry accepts both names.
- The registry hard-rejects submissions whose manifest fails schema validation (HTTP 422) — there is no silent fallback.
- Installs are verified client-side via sha256 + JWS signature from the registry's integrity envelope.
- Field reference: https://docs.tabularium.wiki/manifest/

## Capability Guidance

Set these deliberately:

- `schemas`: true only if the database exposes multiple named schemas/namespaces in Tabularis terms
- `views`: true only if view listing and definition retrieval are implemented
- `routines`: true only if routines can be listed and inspected
- `file_based`: true only for file-backed databases
- `folder_based`: true only for directory-backed databases
- `connection_string`: false only when connection-string import should be hidden
- `connection_string_example`: provide a real example when `connection_string` is enabled
- `identifier_quote`: use the real quoting character for generated SQL
- `alter_primary_key`: true only if ALTER support is actually reliable
- `alter_column`: true only if alter/modify column flows are implemented
- `create_foreign_keys`: true only if FK DDL is supported and enforced
- `manage_tables`: false for read-only or inspection-only plugins
- `readonly`: true if insert/update/delete and table management must be hidden
- `explain`: true only if the plugin implements `explain_query` (otherwise the Visual EXPLAIN UI stays hidden)
- `no_connection_required`: true only for API-style plugins

## Settings Guidance

Add manifest `settings` when configuration cannot be expressed cleanly through the normal connection form.

Good examples:

- DSN selector
- TLS mode
- driver path
- default schema
- extra connection properties

## UI Extensions Guidance

Use `ui_extensions` only when a database-specific workflow benefits from custom UI.

Good examples:

- plugin settings content for advanced driver setup
- connection-helper UI for DSN-based databases

Avoid UI extensions for cosmetic customization only.
