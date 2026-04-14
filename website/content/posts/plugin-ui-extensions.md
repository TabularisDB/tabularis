---
title: "Phase 2 of the Plugin System: Plugins That Touch the UI"
date: "2026-03-15T12:00:00"
tags: ["plugins", "extensibility", "architecture", "ui"]
excerpt: "Phase 1 let anyone build a database driver. Phase 2 lets plugins put buttons, fields, and menu items directly into the Tabularis interface. Here is the design and why it works the way it does."
og:
  title: "Plugin System Phase 2:"
  accent: "Plugins Touch the UI."
  claim: "A slot-based extension model — buttons, fields, and menus from plugins, without breaking what already works."
  image: "/img/tabularis-plugin-manager.png"
---

# Phase 2 of the Plugin System: Plugins That Touch the UI

The plugin system shipped in v0.9.0. Since then, the community has built Redis drivers, a Python CSV driver, DuckDB support. All of them work the same way: a process speaks JSON-RPC over stdin/stdout, and Tabularis handles the UI. The plugin never sees the interface. It sends data, the host renders it.

That was always half the story. A PostGIS driver can return geometry columns, but the data grid shows `POINT(45.07 7.68)` as plain text. A ClickHouse driver knows about materialized views, but there is no place to surface that in the sidebar. The plugin does the hard work and then hands it off to a UI that knows nothing about it.

I have been thinking about this since before v0.9.0 shipped. Today I am publishing the spec for Phase 2: **UI extensions for plugins**.

## Stealing from WordPress (the good parts)

If you have built a WordPress plugin, you know the pattern. WordPress defines "hooks" — named points in the page where plugins can inject content. You register a function, WordPress calls it at the right place. The host controls the layout. The plugin controls the content.

I wanted the same idea for Tabularis, but adapted for React. Instead of PHP hooks in a template, we define **slots** — named insertion points inside existing components. A plugin registers a React component against a slot name, and the host renders it with the right props at the right location.

The difference from WordPress: everything is typed. The plugin declares its slots in the manifest. The host validates them. Each component receives a typed context object with exactly the data it needs. No string parsing, no global mutations, no `innerHTML`.

## Concrete example: PostGIS

Today, if you open a row with a geometry column in the Row Editor sidebar, you see a text field with `SRID=4326;POINT(45.07 7.68)`. Accurate, not useful.

With UI extensions, the PostGIS plugin could register a small map component in the `row-editor-sidebar.field.after` slot. The host renders the text field as before, and immediately below it, the plugin renders a Leaflet map with the point plotted. The plugin receives the column metadata and current value as props — it does not need to fetch anything.

Or think about export. Right now, exporting data to Parquet means copying queries to another tool. With a slot in `data-grid.toolbar.actions`, a plugin can drop an "Export" button right next to the filter controls. It gets the table name, current filters, column list, and connection ID as context. One click, done.

## The eight slots

I went through the UI and picked eight places where plugin content makes sense without cluttering the interface:

**In the row editor (modal and sidebar):** After each field input. This is where validation hints, computed previews, and lookup widgets belong. There is also a slot before the modal footer buttons — good for batch actions like "fill from template."

**Sidebar header:** Extra buttons next to the row title in the Row Editor sidebar. "Copy as JSON", "View audit log", that kind of thing.

**Data grid toolbar:** Buttons alongside filter, sort, and limit. Export, analysis, visualization.

**Context menu:** Extra items in the right-click menu on grid rows. "Copy as INSERT", "Bookmark row", "Look up in external API."

**Main sidebar footer:** Global actions or status badges that persist across views.

**Plugin settings:** Per-plugin action buttons in the Settings page, next to the enable/disable toggle and settings gear. Diagnostics, custom configuration shortcuts, plugin-specific status indicators.

Eight slots. Not thirty. I would rather ship a small set that works well than scatter extension points everywhere and regret the maintenance cost.

:::newsletter:::

## How it works for plugin authors

You add a `ui_extensions` section to your manifest — the same JSON file that already declares your driver name, version, and capabilities. Each entry says which slot to target and which file contains the component:

```json
{
  "ui_extensions": [
    {
      "slot": "row-editor-sidebar.field.after",
      "module": "./ui/GeometryPreview.tsx",
      "conditions": { "drivers": ["postgres"] }
    }
  ]
}
```

That is it. The host reads the manifest, lazy-imports the module when the slot first appears on screen, and renders the component with the right context props.

The component itself is a normal React component. It receives `slotContext` (column info, row data, connection details, driver capabilities — varies by slot) and `pluginId`. It returns JSX. There is no special framework to learn, no lifecycle to manage beyond standard React.

Plugins also get a small utility library (`@tabularis/plugin-api`) for common tasks: running a read-only query on the active connection, showing a toast, reading their own settings, checking whether the theme is dark. That library is the entire approved API surface. Direct Tauri calls and DOM manipulation outside the plugin's subtree are off-limits.

## Nothing breaks

This was a hard requirement from the start. The `ui_extensions` field is optional. Every existing plugin — every manifest, every driver, every configuration — works exactly as before. The types do not change. The Rust backend does not change. The settings structure does not change.

On the frontend, the new slot anchors render nothing when the registry is empty. If you never install a plugin with UI extensions, the app behaves identically. Zero overhead.

The community has active plugin authors. I am not going to ask them to rewrite their manifests. Phase 2 is additive.

## The hard problems

I do not want to pretend this is simple. There are real challenges.

**Security.** Plugin components run in the same React tree as the host. I chose this over iframe isolation because iframes make shared styling and context passing painful — and the whole point is seamless integration. The tradeoff is that a malicious plugin could theoretically poke at host state. The mitigation: plugins can only import from `@tabularis/plugin-api`. Direct Tauri access is blocked. Queries are read-only by default — write access requires an explicit permission flag in the manifest, and the user sees a prompt before granting it. This is a trust-but-verify model. It will need hardening over time.

**Crashes.** A broken plugin component cannot take down the host. Every slot contribution gets its own React error boundary. If a plugin throws, you see a small warning icon — not a white screen. If it throws three times in a minute, it is disabled for the session. This is defensive, but necessary. Third-party code will crash. The question is how gracefully.

**Performance.** Plugin modules are lazy-loaded. A plugin targeting the row editor sidebar adds zero bytes to the initial bundle if you never open the sidebar. The slot registry is empty at startup and only fills as plugins are activated and their target slots mount. The plugin ecosystem should grow without making the app heavier.

**Ordering.** Multiple plugins can target the same slot. Each contribution has an ordering weight, and the host sorts by it. If two plugins pick the same weight, the order is stable but arbitrary. For seven slots, this is fine. If the ecosystem grows to a point where ten plugins compete for toolbar space, I will revisit.

## What is not in Phase 2

The spec covers the slot architecture, manifest format, context API, and security model. It deliberately does not cover:

- **Full-page views** — A plugin that wants to render an entire dashboard or monitoring panel needs a routing extension. That is a different problem.
- **A stable theme API** — Plugins can detect dark/light mode, but accessing the full design token set requires defining a public theme contract. Not ready yet.
- **Scoped storage** — Plugins have no way to persist state across sessions. A per-plugin key-value store is planned but not designed.
- **Inter-plugin communication** — A PostGIS preview in the sidebar might want to talk to a map view in the toolbar. There is no message bus for that. Will come if the use cases justify it.

These are future extensions, not prerequisites. The Phase 2 spec is self-contained — you can build useful plugins against it without any of them.

## The point

Phase 1 solved "which databases can I connect to." Phase 2 starts solving "what can I do once I am connected."

A team using PostGIS gets geometry previews without me knowing anything about PostGIS. A company with a custom audit system can show compliance info next to each row. Someone who exports data to Parquet daily can do it from the toolbar.

The host provides the stage. The plugin does the work.

The [full specification](/docs/plugin-ui-extensions-spec.md) is published alongside this post. If you build plugins — or want to start — read it, file issues, tell me what is missing. The design is not final. The direction is.
