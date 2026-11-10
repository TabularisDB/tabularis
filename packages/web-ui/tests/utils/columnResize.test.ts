import {describe, expect, it} from 'vitest';
import {
    COLUMN_RESIZE_STEP,
    COLUMN_RESIZE_STEP_LARGE,
    getKeyboardColumnWidth,
    getFitColumnWidth,
    isColumnResizeKey,
} from '@/utils/columnResize';

describe('columnResize', () => {
    describe('isColumnResizeKey', () => {
        it('accepts the arrows and Home/End', () => {
            for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
                expect(isColumnResizeKey(key)).toBe(true);
            }
        });

        it('ignores other keys', () => {
            for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'Tab', 'a']) {
                expect(isColumnResizeKey(key)).toBe(false);
            }
        });
    });

    describe('getKeyboardColumnWidth', () => {
        it('steps with the arrows', () => {
            expect(getKeyboardColumnWidth('ArrowRight', false, 100, 48, 2000)).toBe(
                100 + COLUMN_RESIZE_STEP,
            );
            expect(getKeyboardColumnWidth('ArrowLeft', false, 100, 48, 2000)).toBe(
                100 - COLUMN_RESIZE_STEP,
            );
        });

        it('takes larger steps with Shift', () => {
            expect(getKeyboardColumnWidth('ArrowRight', true, 100, 48, 2000)).toBe(
                100 + COLUMN_RESIZE_STEP_LARGE,
            );
            expect(getKeyboardColumnWidth('ArrowLeft', true, 200, 48, 2000)).toBe(
                200 - COLUMN_RESIZE_STEP_LARGE,
            );
        });

        it('jumps to the limits with Home and End', () => {
            expect(getKeyboardColumnWidth('Home', false, 300, 48, 2000)).toBe(48);
            expect(getKeyboardColumnWidth('End', false, 300, 48, 2000)).toBe(2000);
        });

        it('never steps past the limits', () => {
            expect(getKeyboardColumnWidth('ArrowLeft', true, 60, 48, 2000)).toBe(48);
            expect(getKeyboardColumnWidth('ArrowRight', true, 1990, 48, 2000)).toBe(2000);
        });

        it('returns null for keys that do not resize', () => {
            expect(getKeyboardColumnWidth('ArrowUp', false, 100, 48, 2000)).toBeNull();
            expect(getKeyboardColumnWidth('Enter', false, 100, 48, 2000)).toBeNull();
        });
    });
    describe('getFitColumnWidth', () => {
        it('fits the widest text plus padding', () => {
            expect(getFitColumnWidth([40, 120.4, 80], 32, 48, 2000)).toBe(153);
        });

        it('keeps the width within the limits', () => {
            expect(getFitColumnWidth([5], 10, 48, 2000)).toBe(48);
            expect(getFitColumnWidth([5000], 32, 48, 2000)).toBe(2000);
        });

        it('falls back to the minimum when nothing is measured', () => {
            expect(getFitColumnWidth([], 32, 48, 2000)).toBe(48);
        });
    });
});
