# Accessibility Rules

ESLint runs the `jsx-a11y` recommended rules on every `.tsx` file (`no-autofocus` is off: modals focus their primary field, see [modals.md](./modals.md)). The `Design & Accessibility` workflow fails on any violation. Fix the markup rather than silencing the rule.

1. **Clickable means a button.** An element with `onClick` and no nested controls is a `<button type="button">` (add `text-left` to keep the layout). Links that navigate are `<a>` or the router's link.
2. **When it cannot be a button** (it contains other buttons or inputs), give it `role="button"`, `tabIndex={0}` and `onKeyDown={onActivationKey(handler)}` from `src/utils/keyboardEvents.ts`, which handles Enter and Space and ignores keys typed inside nested controls.
3. **State is exposed, not only painted.** Toggles carry `aria-pressed` or `aria-expanded`, selected options `aria-selected` inside a proper role.
4. **Backdrops close on their own click.** Check `event.target === event.currentTarget` on the overlay instead of stopping propagation in the dialog, mark the overlay `role="presentation"` and make sure Escape closes it (`useEscapeKey`). The panel is `role="dialog"` with `aria-modal` and `aria-labelledby`.
5. **Every control has a name.** Form fields are tied to their label (`htmlFor` + `useId()`, or nested); icon-only buttons have a translated `aria-label`.
6. **Focus is visible.** New focusable elements use `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus` (never `accent-primary`, see [design.md](./design.md)).
7. **`eslint-disable` for a jsx-a11y rule needs a one-line reason** and is the last resort, not the default fix.
8. **Color contrast** is covered by the theme contract: see "Contrast" in [DESIGN.md](../DESIGN.md) and `pnpm test:contrast`.
