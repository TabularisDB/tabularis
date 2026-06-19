# UI extension bundle

This folder contains the React UI extension for the parent Tabularis plugin.

## Build

```bash
pnpm install
pnpm build
```

`dist/index.js` is what `just dev-install` picks up from the parent project. The file is a single IIFE bundle that the Tabularis host evaluates at runtime.

## How it works

- `src/index.tsx` uses `defineSlot("data-grid.toolbar.actions", …)` to contribute a button to the data-grid toolbar.
- Types for the slot context, hooks, and the `defineSlot` helper come from [`@tabularis/plugin-api`](https://www.npmjs.com/package/@tabularis/plugin-api).
- React, `react/jsx-runtime`, and `@tabularis/plugin-api` are Vite externals — the host injects them at load time, so nothing is double-bundled.

## Translations (i18n)

The host runtime is [Lingui](https://lingui.dev/). Plugin strings live in
`../locales/<lang>.json` at the **plugin root** (not this `ui/` folder) — `just
dev-install` copies them next to `manifest.json`, and the host loads them
automatically.

In components, call `usePluginTranslation(pluginId)`:

```tsx
const t = usePluginTranslation(pluginId);
t("toolbar.label");
t("toolbar.greeting", { table: context.tableName });
```

Authoring rules:

- **Author new keys Lingui/ICU-style** with single-brace `{var}` placeholders.
- Legacy i18next `{{var}}` placeholders still interpolate, for backwards
  compatibility.
- Resolution order is **active language → English (`en.json`) → the key itself**,
  so a missing translation degrades gracefully.

`locales/en.json` is the source of truth; add `locales/de.json`, etc. for each
language you support (only the keys that differ — the rest fall back to English).

## Adding more slots

Slot names and their context shapes live in `@tabularis/plugin-api`'s `SlotContextMap` type. Pick another slot, call `defineSlot` a second time with a different target, and expose both components by splitting the entry into separate files (Vite's `lib.entry` can be an object of entries) or by registering multiple `ui_extensions` entries in `manifest.json` pointing at different built modules.

Full slot reference: <https://github.com/TabularisDB/tabularis/blob/main/plugins/PLUGIN_GUIDE.md#available-slots>
