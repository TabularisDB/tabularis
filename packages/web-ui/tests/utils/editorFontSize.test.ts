import {describe, it, expect} from 'vitest';
import {
    EDITOR_FONT_SIZE_DEFAULT,
    EDITOR_FONT_SIZE_MAX,
    EDITOR_FONT_SIZE_MIN,
    clampEditorFontSize,
    stepEditorFontSize,
} from '@/utils/editorFontSize';

describe('clampEditorFontSize', () => {
    it('keeps sizes inside the range', () => {
        expect(clampEditorFontSize(15)).toBe(15);
        expect(clampEditorFontSize(EDITOR_FONT_SIZE_MIN)).toBe(EDITOR_FONT_SIZE_MIN);
        expect(clampEditorFontSize(EDITOR_FONT_SIZE_MAX)).toBe(EDITOR_FONT_SIZE_MAX);
    });

    it('clamps sizes outside the range', () => {
        expect(clampEditorFontSize(4)).toBe(EDITOR_FONT_SIZE_MIN);
        expect(clampEditorFontSize(40)).toBe(EDITOR_FONT_SIZE_MAX);
    });

    it('rounds to whole pixels and falls back to the default for NaN', () => {
        expect(clampEditorFontSize(13.6)).toBe(14);
        expect(clampEditorFontSize(Number.NaN)).toBe(EDITOR_FONT_SIZE_DEFAULT);
    });
});

describe('stepEditorFontSize', () => {
    it('moves by 1px', () => {
        expect(stepEditorFontSize(14, 1)).toBe(15);
        expect(stepEditorFontSize(14, -1)).toBe(13);
    });

    it('stops at the bounds', () => {
        expect(stepEditorFontSize(EDITOR_FONT_SIZE_MAX, 1)).toBe(EDITOR_FONT_SIZE_MAX);
        expect(stepEditorFontSize(EDITOR_FONT_SIZE_MIN, -1)).toBe(EDITOR_FONT_SIZE_MIN);
    });

    it('starts from the default when no size is saved', () => {
        expect(stepEditorFontSize(undefined, 1)).toBe(EDITOR_FONT_SIZE_DEFAULT + 1);
    });
});
