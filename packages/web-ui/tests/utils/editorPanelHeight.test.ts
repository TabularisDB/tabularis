import {describe, expect, it} from 'vitest';
import {
    DEFAULT_EDITOR_PANEL_HEIGHT,
    MIN_EDITOR_PANEL_HEIGHT,
    resolveEditorPanelHeight,
} from '@/utils/editorPanelHeight';

describe('resolveEditorPanelHeight', () => {
    it('uses the saved height when it fits the window', () => {
        expect(resolveEditorPanelHeight(420, 1000)).toBe(420);
    });

    it('rounds fractional heights from a drag', () => {
        expect(resolveEditorPanelHeight(420.6, 1000)).toBe(421);
    });

    it('falls back to the default for missing or invalid values', () => {
        expect(resolveEditorPanelHeight(undefined, 1000)).toBe(DEFAULT_EDITOR_PANEL_HEIGHT);
        expect(resolveEditorPanelHeight(null, 1000)).toBe(DEFAULT_EDITOR_PANEL_HEIGHT);
        expect(resolveEditorPanelHeight('420', 1000)).toBe(DEFAULT_EDITOR_PANEL_HEIGHT);
        expect(resolveEditorPanelHeight(Number.NaN, 1000)).toBe(DEFAULT_EDITOR_PANEL_HEIGHT);
        expect(resolveEditorPanelHeight(Number.POSITIVE_INFINITY, 1000)).toBe(
            DEFAULT_EDITOR_PANEL_HEIGHT,
        );
    });

    it('keeps room for the results panel in a smaller window', () => {
        expect(resolveEditorPanelHeight(900, 700)).toBe(500);
    });

    it('never goes below the minimum height', () => {
        expect(resolveEditorPanelHeight(20, 1000)).toBe(MIN_EDITOR_PANEL_HEIGHT);
        expect(resolveEditorPanelHeight(-50, 1000)).toBe(MIN_EDITOR_PANEL_HEIGHT);
        expect(resolveEditorPanelHeight(400, 150)).toBe(MIN_EDITOR_PANEL_HEIGHT);
    });
});
