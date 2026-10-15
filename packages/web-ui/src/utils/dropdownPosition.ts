import type { CSSProperties } from "react";

/** Default max height of a dropdown panel (matches Tailwind `max-h-60`). */
export const DROPDOWN_MAX_HEIGHT = 240;

/** Gap between the trigger button and the dropdown panel. */
export const DROPDOWN_GAP = 4;

/** Minimum distance kept between the dropdown and the viewport edge. */
export const VIEWPORT_MARGIN = 8;

/** Smallest useful panel height before flipping to the roomier side. */
const MIN_USEFUL_HEIGHT = 120;

export interface DropdownPosition {
  /** Viewport-relative anchor: `top` of the panel when opening down,
   * distance available above the trigger when opening up (see `openUp`). */
  top: number;
  left: number;
  width: number;
  /** Height the panel may occupy without leaving the viewport. */
  maxHeight: number;
  /** True when the panel should render above the trigger. */
  openUp: boolean;
}

export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * Computes where a fixed-position dropdown should open relative to its
 * trigger: below by default, flipped above when the space under the trigger
 * is too small and the space above is larger. `maxHeight` is clamped to the
 * available space so the list always scrolls instead of overflowing the
 * viewport.
 */
export const computeDropdownPosition = (
  rect: TriggerRect,
  viewportHeight: number = window.innerHeight,
  maxHeight: number = DROPDOWN_MAX_HEIGHT,
): DropdownPosition => {
  const spaceBelow = viewportHeight - rect.bottom - DROPDOWN_GAP - VIEWPORT_MARGIN;
  const spaceAbove = rect.top - DROPDOWN_GAP - VIEWPORT_MARGIN;
  const openUp =
    spaceBelow < Math.min(maxHeight, MIN_USEFUL_HEIGHT) && spaceAbove > spaceBelow;
  const available = openUp ? spaceAbove : spaceBelow;
  const clampedHeight = Math.max(Math.min(maxHeight, available), 0);
  return {
    top: openUp ? rect.top - DROPDOWN_GAP : rect.bottom + DROPDOWN_GAP,
    left: rect.left,
    width: rect.width,
    maxHeight: clampedHeight,
    openUp,
  };
};

/** Inline style for a `position: fixed` dropdown panel from a computed
 * position: anchored under the trigger, or above it when flipped. */
export const dropdownPositionStyle = (
  pos: DropdownPosition,
  viewportHeight: number = window.innerHeight,
): CSSProperties =>
  pos.openUp
    ? {
        bottom: viewportHeight - pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
      }
    : {
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
      };
