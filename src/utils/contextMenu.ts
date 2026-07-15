/**
 * ContextMenu utility functions for position calculation and viewport constraints
 */

export interface MenuPosition {
  top: number;
  left: number;
}

export interface ViewportConstraints {
  viewportWidth: number;
  viewportHeight: number;
  menuWidth: number;
  menuHeight: number;
  clickX: number;
  clickY: number;
  margin?: number;
  /** Optional right boundary (e.g. sidebar right edge). Menu won't extend past this. */
  boundaryRight?: number;
}

/**
 * Calculates the optimal position for a context menu to stay within viewport bounds
 * @param constraints - Viewport and menu dimensions
 * @returns Adjusted top/left position
 */
export function calculateContextMenuPosition(
  constraints: ViewportConstraints
): MenuPosition {
  const {
    viewportWidth,
    viewportHeight,
    menuWidth,
    menuHeight,
    clickX,
    clickY,
    margin = 10,
    boundaryRight,
  } = constraints;

  // Use the tighter of viewport or explicit boundary
  const effectiveRight = boundaryRight
    ? Math.min(viewportWidth, boundaryRight)
    : viewportWidth;

  let adjustedX = clickX;
  let adjustedY = clickY;

  // Adjust horizontal position if menu overflows right edge
  if (clickX + menuWidth > effectiveRight - margin) {
    adjustedX = effectiveRight - menuWidth - margin;
  }

  // Adjust vertical position if menu overflows bottom edge
  if (clickY + menuHeight > viewportHeight - margin) {
    adjustedY = viewportHeight - menuHeight - margin;
  }

  // Ensure menu doesn't go off the left edge
  if (adjustedX < margin) {
    adjustedX = margin;
  }

  // Ensure menu doesn't go off the top edge
  if (adjustedY < margin) {
    adjustedY = margin;
  }

  return { top: adjustedY, left: adjustedX };
}

/**
 * Determines if the menu should be positioned to the left of the click point
 * @param clickX - X coordinate of click
 * @param menuWidth - Width of the menu
 * @param viewportWidth - Width of the viewport
 * @returns true if menu should appear to the left
 */
export function shouldPositionLeft(
  clickX: number,
  menuWidth: number,
  viewportWidth: number,
  margin: number = 10
): boolean {
  return clickX + menuWidth > viewportWidth - margin;
}

/**
 * Determines if the menu should be positioned above the click point
 * @param clickY - Y coordinate of click
 * @param menuHeight - Height of the menu
 * @param viewportHeight - Height of the viewport
 * @returns true if menu should appear above
 */
export function shouldPositionAbove(
  clickY: number,
  menuHeight: number,
  viewportHeight: number,
  margin: number = 10
): boolean {
  return clickY + menuHeight > viewportHeight - margin;
}

/**
 * Vertical shift (≤ 0) that keeps a flyout submenu inside the viewport:
 * moves it up by the amount it overflows the bottom edge, without pushing
 * its top above the viewport margin.
 * @param submenuTop - Viewport Y of the submenu's top edge before shifting
 * @param submenuHeight - Height of the submenu
 * @param viewportHeight - Height of the viewport
 * @returns Offset in px to add to the submenu's top (0 when it already fits)
 */
export function calculateSubmenuOffsetY(
  submenuTop: number,
  submenuHeight: number,
  viewportHeight: number,
  margin: number = 10
): number {
  const overflow = submenuTop + submenuHeight - (viewportHeight - margin);
  if (overflow <= 0) return 0;
  const shift = Math.min(overflow, Math.max(submenuTop - margin, 0));
  return shift > 0 ? -shift : 0;
}

/**
 * Clamps a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
