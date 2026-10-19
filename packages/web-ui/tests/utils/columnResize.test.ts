import {describe, expect, it} from 'vitest';
import {
    COLUMN_RESIZE_STEP,
    COLUMN_RESIZE_STEP_LARGE,
    clampColumnWidth,
    getKeyboardColumnWidth,
    isColumnResizeKey,
} from '@/utils/columnResize';

describe('columnResize', () => {
    describe('clampColumnWidth', () => {
        it('keeps a width inside the limits', () => {
            expect(clampColumnWidth(120, 48, 2000)).toBe(120);
        });

        it('raises a width below the minimum', () => {
            expect(clampColumnWidth(10, 48, 2000)).toBe(48);
            expect(clampColumnWidth(-50, 48, 2000)).toBe(48);
        });

        it('lowers a width above the maximum', () => {
            expect(clampColumnWidth(2400, 48, 2000)).toBe(2000);
        });

        it('accepts the limits themselves', () => {
            expect(clampColumnWidth(48, 48, 2000)).toBe(48);
            expect(clampColumnWidth(2000, 48, 2000)).toBe(2000);
        });
    });

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
});
