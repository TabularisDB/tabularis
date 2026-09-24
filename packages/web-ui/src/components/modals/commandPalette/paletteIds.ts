/**
 * Shared between PaletteResults, which stamps these ids onto the DOM, and
 * Palette, which points `aria-controls`/`aria-activedescendant` at them.
 */
export const PALETTE_RESULTS_ID = "command-palette-results";

export const paletteOptionId = (index: number) =>
  `command-palette-option-${index}`;
