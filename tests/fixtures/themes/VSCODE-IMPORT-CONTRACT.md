# VS Code conversion contract — implementation checkpoint

The pure converter exists in `src/utils/vsCodeThemeImport.ts`. The translated
Appearance import action, acknowledgement dialog and complete author journey
are **not implemented yet**. Converter tests are not GUI acceptance.

## Input and safety

- Local JSON/JSONC text only, with comments and trailing commas accepted.
- The host definition/manifest parser remains strict JSON.
- The same 256 KiB input, 16-level nesting and 32,768-node limits apply before
  AST/value construction. Decoded duplicate keys, invalid Unicode and nonfinite
  numbers are rejected. Scope expansion is bounded before creating rules.
- JSONC values are constructed from the bounded AST into null-prototype records.
  The convenience `jsonc-parser.parse()` API is deliberately not used: its
  ordinary-object assignment gives `__proto__` setter semantics.
- No include reads, remote fetches, `.tmTheme` loading, VSIX extraction, extension
  activation or code execution. References are diagnostics, never operations.
- Unrecognized documents, include-only documents and conversions with no supported
  visual data fail; they do not become fallback-only themes.

## Mode, metadata and colors

`type: light`, `dark`, `hc` and `hcDark` map to the corresponding v1 modes.
Missing/unsupported modes require an explicit user choice. In particular,
`hcLight` is not silently treated as the dark high-contrast base. Explicitly
changing/approximating a declared mode produces a diagnostic.

Name and optional author attribution can be preserved. Attribution is not a
license or permission to redistribute. The future confirmation UI must explain
this and require acknowledgement of partial conversion.

Registered Monaco color IDs are retained. Hex RGB/RGBA, including three/four-digit
shorthand, are normalized into v1 values. Other supported-key color values fail.
The additional application mapping is intentionally small:

| VS Code color | Application token |
| --- | --- |
| editor.background / editor.foreground | bg.base / text.primary |
| sideBar.background / sideBar.foreground | surface.primary / text.secondary |
| panel.background / input.background | bg.elevated / bg.input |
| list.hoverBackground / editor.selectionBackground | surface.hover / surface.active |
| focusBorder / panel.border | border.focus / border.default |
| button.background / button.foreground | accent.primary / text.inverse |
| errorForeground | accent.error |
| editorWarning.foreground / editorInfo.foreground | accent.warning / accent.info |

Unknown workbench colors are diagnosed. Token alpha is explicitly diagnosed:
v1 materializes it against the effective editor base background; selection
highlights do not recomposite those opaque token colors.

## TextMate subset and precedence

- `comment`, `string`, `keyword`, `invalid`, `variable`, and `entity.name` families
  map to the corresponding Monaco SQL tokens (variable/entity become identifier).
- `keyword.operator`, `constant.numeric`, `constant.language`, `storage.type`,
  `support.type`, `support.function`, string punctuation, and separator/terminator
  punctuation map to operator, number, predefined, string.quote and delimiter.
- Specific suffixes are approximations and produce diagnostics. Compound selectors,
  exclusions and unsupported scopes are not silently interpreted.
- Arrays and comma-separated simple scopes are supported, within output budgets.
  Ordered rules are retained for the shared resolver's per-leaf precedence.
- Foreground plus bold/italic/underline/strikethrough are supported. An explicit
  empty style resets style; unsupported styles/settings are diagnosed.
- Semantic tokens, includes, external references and unknown keys are diagnosed.
  Diagnostics are bounded to 128 entries plus a truncation notice, with bounded
  paths. Any such loss must require explicit acknowledgement in the future UI.

Evidence: `tests/utils/vsCodeThemeImport.test.ts`, strict shared validation/parity
suites, and actual Monaco token-alpha replay. No publishing or platform acceptance
is implied by these tests.
