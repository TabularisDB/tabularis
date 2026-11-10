/** Gap between the anchor (trigger) and the popover. */
export const POPOVER_GAP = 4;

/** Minimum distance kept between the popover and the viewport edges. */
export const POPOVER_VIEWPORT_MARGIN = 8;

export interface AnchorRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export interface PopoverSize {
    width: number;
    height: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

export interface AnchoredPopoverPosition {
    top: number;
    left: number;
    /** Width the popover may use without leaving the viewport. */
    maxWidth: number;
    /** Height the popover may use without leaving the viewport. */
    maxHeight: number;
    /** True when the popover opens above the anchor. */
    placedAbove: boolean;
}

const clampTo = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Places a `position: fixed` popover next to its anchor so that it stays
 * fully inside the viewport.
 *
 * Horizontally it starts at the anchor's left edge (opening towards the
 * content area, away from the sidebar edge) and is shifted left when it would
 * cross the right edge of the viewport. Vertically it opens below the anchor,
 * flips above when the space below is too small and the space above is
 * larger, and is finally clamped inside the viewport. When the popover is
 * larger than the viewport, `maxWidth` / `maxHeight` shrink so its content
 * wraps or scrolls instead of being cut off.
 */
export const computeAnchoredPopoverPosition = (
    anchor: AnchorRect,
    popover: PopoverSize,
    viewport: ViewportSize,
    margin: number = POPOVER_VIEWPORT_MARGIN,
    gap: number = POPOVER_GAP,
): AnchoredPopoverPosition => {
    const maxWidth = Math.max(viewport.width - margin * 2, 0);
    const maxHeight = Math.max(viewport.height - margin * 2, 0);
    const width = Math.min(popover.width, maxWidth);
    const height = Math.min(popover.height, maxHeight);

    const left = clampTo(anchor.left, margin, viewport.width - margin - width);

    const spaceBelow = viewport.height - anchor.bottom - gap - margin;
    const spaceAbove = anchor.top - gap - margin;
    const placedAbove = height > spaceBelow && spaceAbove > spaceBelow;
    const preferredTop = placedAbove ? anchor.top - gap - height : anchor.bottom + gap;
    const top = clampTo(preferredTop, margin, viewport.height - margin - height);

    return {top, left, maxWidth, maxHeight, placedAbove};
};
