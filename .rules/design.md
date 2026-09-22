# Design Token Rules

The full contract is in [DESIGN.md](../DESIGN.md). In short:

1. **Colors only through theme tokens.** Use `bg-base`, `bg-elevated`, `bg-surface-*`, `text-primary/secondary/muted/accent/inverse`, `border-default/strong/focus`, `bg-/border-/ring-accent-primary/secondary/success/warning/error/info` (with `/opacity` for tints) and the `semantic-*` utilities. NEVER write Tailwind palette classes (`text-blue-400`, `bg-red-900/20`, `accent-blue-500`), hex codes, `rgb()`/`hsl()` or inline color literals in components.
2. **Meaning picks the token.** Primary action fills: `bg-accent-primary`; links, accent labels and icons: `text-accent` (never `text-accent-primary`); focus states: `focus:border-focus`, `focus-visible:ring-focus`. Danger: `accent-error`. Success and run: `accent-success`. Attention: `accent-warning`. Tools, schema changes, themes: `accent-secondary`. Row states and keys in data views: `semantic-modified/new/deleted` and `semantic-pk/fk/index`. Status chips: `src/utils/tones.ts`.
3. **Text over the primary accent is `text-inverse`, over any other accent fill `text-on-accent-<tone>`, never `text-white`.** Hover brightening is `hover:text-primary`. `text-white` is allowed only over user-picked or brand colors.
4. **Radii and fonts come from the theme.** Use the `rounded*` utilities (already mapped to the theme), `font-mono`, `font-result`; never `rounded-[6px]`, `borderRadius: 6` or a hardcoded font family.
5. **Never assume dark.** Do not force `color-scheme` or paint a dark background; light, high-contrast and square-cornered themes must look intentional.
6. **Libraries that need real colors** (ReactFlow, Recharts) read `currentTheme.colors` via `useTheme()`. Inline styles needing alpha use `tint()` from `src/utils/tones.ts` or `var(--token)`.
7. **Contrast is part of the contract.** Built-in themes must meet WCAG AA on the pairs in `CONTRAST_PAIRS` (`src/utils/themeContrast.ts`): fix a failing pair by moving lightness, keep the hue. A new text/background combination goes into `CONTRAST_PAIRS` first. See "Contrast" in DESIGN.md.
8. **Verify** with `pnpm lint:theme` (runs inside `pnpm lint`), `pnpm test:contrast` and by switching themes in Settings, Appearance. Brand and identity colors go in the `ALLOWLIST` of `scripts/check-theme-tokens.mjs` with a reason; UI files never do.
