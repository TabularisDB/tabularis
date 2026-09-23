# Theme compatibility fixtures

Current evidence: [VERIFICATION.md](./VERIFICATION.md). Reproducible human inputs
and cleanup: [MANUAL-TEST-PLAN.md](./MANUAL-TEST-PLAN.md). The `author/` artifacts,
standalone snapshot vectors and `pre-feature/` hazard replay are later additions,
not regenerated baseline expectations.

The baseline fixtures below were captured before runtime changes, from Tabularis `main` at
`d044381c536a3b9e4b576b1ed33fcce39efcf4b1` (PR #793 / issue #791).
No fixture contains real user data. Do not refresh expectations from a new
resolver to hide a compatibility regression.

- `builtin-rendering.json`: all 12 builtin descriptors, every CSS property set
  by the existing application function, generated Monaco defaults, and SHA-256
  of the JSON passed to the actual Monaco `defineTheme` call. Hashes avoid
  duplicating large named assets for several builtin themes. They cover the
  complete editor definition (not just a color subset). The generated defaults
  are recorded separately because named editor assets take precedence today.
- `named-editor-assets.json`: byte-level SHA-256 for all 12 checked-in Monaco
  assets. `Tomorrow-Night-Eighties.json` exists on disk but is not registered in
  the loader's 11-name map. The original assets remain in `src/themes/monaco/`.
  A formatting-only asset edit changes this checksum and requires explicit
  review; the renderer checksums are separately computed from parsed data.
- `legacy-frontend.json`: representative personal standalone export with
  camel-case connection colors and `fontStyle`, named editor selection, inline
  editor overrides, alpha, attribution, timestamps and a tint icon.
- `legacy-native.json`: corresponding historical Rust wire shape, using
  `connection_active`, `connection_inactive` and `font_style`; optional icon
  path is explicitly null.
- `legacy-native-nullable.json`: a historical Rust-compatible file with null
  metadata and null optional Monaco fields. Deserialization/serialization may
  omit the latter; non-mutating reads must not rewrite its original bytes.
- `selection-shapes.json`: static/system/personal/editor selections, missing
  files, absent settings and a partial non-theme configuration. Native tests
  check serialization of supplied fields, not save-command merge behavior.

The legacy examples are deliberately **different wire formats**. At baseline,
Rust requires snake-case connection fields and does not recognize frontend
`fontStyle`. Capturing both is not evidence that the current native save path
already accepts frontend exports, nor permission for the new contract to
reject valid historical data.

Run the frontend compatibility replay:

```sh
pnpm exec vitest run tests/themes/compatibilityBaseline.test.ts
cd src-tauri && cargo test --locked --test theme_compatibility
```

These are automated data/application checks, not manual visual, native window,
Monaco rendering-engine, or cross-platform evidence. Native persistence and
full author/installed equivalence require additional tests.
