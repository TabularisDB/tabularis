import {describe, expect, it} from 'vitest';
import {
    computeAnchoredPopoverPosition,
    POPOVER_GAP,
    POPOVER_VIEWPORT_MARGIN,
} from '@/utils/anchoredPopover';

const viewport = {width: 1200, height: 800};
const size = {width: 288, height: 160};
const anchorAt = (left: number, top: number, side = 22) => ({
    left,
    top,
    right: left + side,
    bottom: top + side,
});

describe('anchoredPopover', () => {
    describe('computeAnchoredPopoverPosition', () => {
        it('opens below the anchor, starting at its left edge', () => {
            const pos = computeAnchoredPopoverPosition(anchorAt(200, 100), size, viewport);
            expect(pos).toEqual({
                top: 122 + POPOVER_GAP,
                left: 200,
                maxWidth: 1200 - POPOVER_VIEWPORT_MARGIN * 2,
                maxHeight: 800 - POPOVER_VIEWPORT_MARGIN * 2,
                placedAbove: false,
            });
        });

        it('shifts left when it would cross the right viewport edge', () => {
            const pos = computeAnchoredPopoverPosition(anchorAt(1100, 100), size, viewport);
            expect(pos.left).toBe(1200 - POPOVER_VIEWPORT_MARGIN - 288);
        });

        it('never starts before the left margin', () => {
            const pos = computeAnchoredPopoverPosition(anchorAt(-40, 100), size, viewport);
            expect(pos.left).toBe(POPOVER_VIEWPORT_MARGIN);
        });

        it('flips above the anchor when there is no room below', () => {
            const pos = computeAnchoredPopoverPosition(anchorAt(200, 700), size, viewport);
            expect(pos.placedAbove).toBe(true);
            expect(pos.top).toBe(700 - POPOVER_GAP - 160);
        });

        it('stays below when the space above is even smaller', () => {
            const small = {width: 1200, height: 200};
            const pos = computeAnchoredPopoverPosition(anchorAt(200, 40), size, small);
            expect(pos.placedAbove).toBe(false);
            // Clamped so the bottom edge stays inside the viewport.
            expect(pos.top).toBe(200 - POPOVER_VIEWPORT_MARGIN - 160);
        });

        it('clamps to the top margin when the popover is taller than the viewport', () => {
            const pos = computeAnchoredPopoverPosition(
                anchorAt(200, 100),
                {width: 288, height: 2000},
                viewport,
            );
            expect(pos.top).toBe(POPOVER_VIEWPORT_MARGIN);
            expect(pos.maxHeight).toBe(800 - POPOVER_VIEWPORT_MARGIN * 2);
        });

        it('shrinks to the viewport width in a narrow window', () => {
            const narrow = {width: 240, height: 800};
            const pos = computeAnchoredPopoverPosition(anchorAt(180, 100), size, narrow);
            expect(pos.maxWidth).toBe(240 - POPOVER_VIEWPORT_MARGIN * 2);
            expect(pos.left).toBe(POPOVER_VIEWPORT_MARGIN);
        });

        it('never reports negative limits for a degenerate viewport', () => {
            const pos = computeAnchoredPopoverPosition(anchorAt(0, 0), size, {
                width: 4,
                height: 4,
            });
            expect(pos.maxWidth).toBe(0);
            expect(pos.maxHeight).toBe(0);
            expect(pos.left).toBe(POPOVER_VIEWPORT_MARGIN);
            expect(pos.top).toBe(POPOVER_VIEWPORT_MARGIN);
        });
    });
});
