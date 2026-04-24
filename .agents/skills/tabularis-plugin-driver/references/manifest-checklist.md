# Manifest Checklist

Use this checklist when authoring `manifest.json` for a Tabularis database plugin.

## Required Core Fields

- `id`
- `name`
- `version`
- `description`
- `capabilities`

For driver plugins, also include:

- `default_port`
- `executable`
- `data_types`

## Recommended Modern Fields

- `default_username`
- `color`
- `icon`
- `settings`
- `ui_extensions`

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
