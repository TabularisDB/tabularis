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
- The parent manifest records this bundle's `api_version`; Tabularis skips it before execution if the host contract is incompatible.

## Adding more slots

Slot names and their context shapes live in `@tabularis/plugin-api`'s `SlotContextMap` type. Pick another slot, call `defineSlot` a second time with a different target, and expose both components by splitting the entry into separate files (Vite's `lib.entry` can be an object of entries) or by registering multiple `ui_extensions` entries in `manifest.json` pointing at different built modules.

Full slot reference: <https://github.com/TabularisDB/tabularis/blob/main/plugins/PLUGIN_GUIDE.md#available-slots>
