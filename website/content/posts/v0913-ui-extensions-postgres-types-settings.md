---
title: "v0.9.13: Plugins Meet the Interface"
date: "2026-04-02T11:33:00"
release: "v0.9.13"
tags: ["release", "plugins", "ui-extensions", "postgres", "settings", "community"]
excerpt: "UI Extensions land in production, PostgreSQL gains range, multirange, and enum support, and the Settings page gets a full redesign. Plus two new driver capabilities for plugin authors."
og:
  title: "v0.9.13:"
  accent: "Plugins Meet the Interface."
  claim: "UI Extensions ship, PostgreSQL type coverage expands, and Settings gets a modular redesign."
  image: "/img/tabularis-plugin-manager.png"
---

# v0.9.13: Plugins Meet the Interface

This release closes the loop on something I've been building toward for a while. Plugins can now render their own UI inside Tabularis — not through hacks or workarounds, but through a proper extension system with typed contracts and error isolation. Alongside that, the PostgreSQL driver picks up three new type families, and the Settings page has been completely rearchitected.

---

## Plugin UI Extensions: From Spec to Production

Back in v0.9.10 I published the [spec for UI extensions](/docs/plugin-ui-extensions-spec.md). The idea was straightforward: define named insertion points (slots) in the host interface, let plugins register React components against those slots, and have the host render them with the right context. No iframes, no eval, no DOM hacking — just controlled React components inside controlled boundaries.

v0.9.13 ships the full implementation.

### What's in the box

**Ten slots** across the application — from individual field annotations in the row editor, to toolbar buttons, context menu items, sidebar actions, settings panels, and connection form extensions. Each slot passes a typed context object to the plugin component: connection metadata, table name, row data, column info, whatever makes sense for that location. The full list and context shapes are documented in the [plugin wiki](/wiki/plugins#ui-extensions-phase-2) and the [PLUGIN_GUIDE](https://github.com/debba/tabularis/blob/main/plugins/PLUGIN_GUIDE.md).

**A set of host-provided hooks** that give slot components access to host capabilities: running read-only queries, showing toasts, opening modals, reading and writing plugin settings, detecting the current theme, accessing plugin-specific translations, and opening external URLs. Right now these hooks are exposed by the host as a runtime global (`__TABULARIS_API__`) — plugin bundles declare it as an external and reference it at build time. The plan is to publish a proper `@tabularis/plugin-api` package on npm so that plugin authors get type definitions, autocompletion, and a cleaner import experience out of the box.

**IIFE bundles** as the delivery format. Plugin authors build their components with Vite (or any bundler), targeting IIFE output with React and the host API as externals. The host provides these as globals — no duplicate React instances, no version conflicts.

**Error isolation** via per-contribution error boundaries. If a plugin component throws, a small badge appears in its place. The rest of the app keeps running. Other plugins in the same slot keep rendering.

**Conditional rendering** through two mechanisms: a `driver` field in the manifest that restricts a contribution to connections using a specific driver, and component-level filtering where the component itself returns `null` based on context values.

For the full developer reference, see the [Plugin Guide](https://github.com/debba/tabularis/blob/main/plugins/PLUGIN_GUIDE.md). The [wiki page on the plugin system](/wiki/plugins) has also been updated with the complete slot list, available hooks, and build instructions.

### UI-only plugins and plugin modals

Plugins no longer need to be database drivers. v0.9.13 introduces support for **UI-only plugins** — packages that declare `ui_extensions` in their manifest without providing an executable or driver capabilities. This opens the door to visualization tools, data inspectors, and utility panels that work across any database.

The new `usePluginModal()` hook lets slot components open host-managed modals with custom React content. Useful for OAuth setup flows, configuration wizards, or anything that needs more space than a toolbar button provides.

I'm working on a set of demo plugins that showcase these capabilities in practice. Expect them in the coming days.

:::newsletter:::

---

## PostgreSQL: Range, Multirange, and Enum Types

This is [@dev-void-7](https://github.com/dev-void-7)'s work in PR [#111](https://github.com/debba/tabularis/pull/111) — 20 commits touching the Rust extraction layer, all focused on closing gaps in PostgreSQL type support. The same contributor who rewrote the PostgreSQL driver on top of `tokio-postgres` in v0.9.12 is back, this time expanding type coverage.

**Enum types** are now extracted properly. Previously they were passed through as raw bytes; now they resolve to their string label.

**Range types** (`int4range`, `int8range`, `numrange`, `tsrange`, `tstzrange`, `daterange`) are parsed from their binary wire format and displayed in standard PostgreSQL range notation — `[1,10)`, `(2024-01-01,2024-12-31]`, and so on. Empty ranges are handled correctly.

**Multirange types** (PostgreSQL 14+) follow the same approach. A multirange value is displayed as a set of ranges: `{[1,5),[10,20)}`.

Along the way, [@dev-void-7](https://github.com/dev-void-7) also hardened the existing extraction code. Null handling in composite types was tightened — `fill_nulls` now only fills remaining fields instead of overwriting the entire row. The `split_at_value_len` helper returns `Option` instead of panicking on unexpected input. Array extraction with zero dimensions returns an empty array instead of `null`. And the entire extract module gained a proper test suite: simple types, enums, arrays, composites, ranges, and multiranges all have dedicated test coverage now.

This is the kind of work that doesn't produce flashy screenshots but makes the difference between "it sort of works" and "it handles real data."

---

## Settings: Modular Redesign

The Settings page was a single 800-line component. It did the job, but adding anything to it meant scrolling through a wall of JSX and hoping you didn't break something three sections away.

v0.9.13 splits Settings into dedicated tab components:

- **General** — basic application preferences
- **Appearance** — themes, fonts, zoom, and the new editor preferences (font family, font size, minimap toggle)
- **Localization** — language selection
- **AI** — provider configuration and model selection
- **Plugins** — plugin management (install, enable, configure, remove)
- **Shortcuts** — keyboard shortcut reference
- **Logs** — log viewer
- **Info** — version, links, credits

Each tab is its own file under `src/components/settings/`. The main `Settings.tsx` went from ~800 lines to ~40. Shared controls (`SettingRow`, `SettingSwitch`, `SettingSelect`, etc.) live in a dedicated `SettingControls.tsx` module, reused across all tabs.

The new **editor preferences** section in the Appearance tab lets you pick a font family (from a curated list of monospace fonts), adjust the font size, and toggle the minimap — all applied in real time to the SQL editor.

---

## New Driver Capabilities: `readonly` and `manage_tables`

Two new capability flags for plugin authors:

**`readonly`** — when set to `true`, the driver is treated as read-only. All data modification operations (INSERT, UPDATE, DELETE) are disabled in the UI. The add/delete row buttons, inline cell editing, and context menu edit actions are hidden. Table and column management is also hidden, regardless of the `manage_tables` flag. This is useful for analytics databases, data lakes, or any source where writes don't make sense.

**`manage_tables`** — controls whether the table and column management UI (Create Table, Add/Modify/Drop Column, Drop Table) is shown. Defaults to `true`. Set it to `false` for drivers where DDL operations aren't supported or desirable.

Both flags are declared in the manifest's `capabilities` object and evaluated on the frontend to gate UI elements. Existing plugins are unaffected — the defaults preserve current behavior.

---

## Error Modal

Native browser `dialog()` calls have been replaced with a proper in-app error modal. When an async operation fails — a query that errors out, a save that can't complete — the error is now displayed in a themed, keyboard-accessible modal instead of an OS-native popup that ignores your dark theme and can't be styled.

This affects error handling in both the DataGrid and the SQL Editor.

---

## SQL Editor Fixes

A few annoyances that accumulated over the last couple of releases:

- **Cursor position preserved** — switching between tabs no longer resets your cursor to the top of the file. The editor remembers where you were.
- **Autocomplete behavior** — the suggestion popup no longer steals focus from the editor or fires in contexts where it shouldn't.
- **Paste per instance** — the paste action is now registered per editor instance, fixing a bug where pasting in one tab could affect another.
- **Scrollbar styling** — the custom scrollbar theme now applies consistently across all editor instances.
- **Tab closing** — simplified the tab close logic and removed the auto-create behavior that would spawn a new empty tab when you closed the last one.

---

## Smaller Changes

- **`tailwind-merge` removed** — the dependency was unused and added weight to the bundle.
- **TypeScript strictness** — explicit type guards and casts replace several `as unknown as X` patterns across the codebase.
- **Test coverage** — new tests for `SlotAnchor`, `PluginSlotProvider`, `SettingControls`, `pluginModuleLoader`, and settings utilities.

---

:::contributors:::

---

_v0.9.13 is available now. Update via the in-app updater, or download from the [releases page](https://github.com/debba/tabularis/releases/tag/v0.9.13)._
