import {clamp} from '@/utils/number';

/** Arrow-key step for a focused column resize handle (px). */
export const COLUMN_RESIZE_STEP = 10;
/** Arrow-key step while Shift is held (px). */
export const COLUMN_RESIZE_STEP_LARGE = 50;

const RESIZE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** Whether a key press on a focused resize handle changes the width. */
export function isColumnResizeKey(key: string): boolean {
    return RESIZE_KEYS.has(key);
}

/**
 * The width a focused resize handle moves to for a key press, or null when
 * the key does not resize: ArrowLeft/ArrowRight step by
 * `COLUMN_RESIZE_STEP` (`COLUMN_RESIZE_STEP_LARGE` with Shift), Home and End
 * jump to the limits. The result is always within the limits.
 */
export function getKeyboardColumnWidth(
    key: string,
    shiftKey: boolean,
    width: number,
    minWidth: number,
    maxWidth: number,
): number | null {
    const step = shiftKey ? COLUMN_RESIZE_STEP_LARGE : COLUMN_RESIZE_STEP;
    switch (key) {
        case 'ArrowLeft':
            return clamp(width - step, minWidth, maxWidth);
        case 'ArrowRight':
            return clamp(width + step, minWidth, maxWidth);
        case 'Home':
            return minWidth;
        case 'End':
            return maxWidth;
        default:
            return null;
    }
}
