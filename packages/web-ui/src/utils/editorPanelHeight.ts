/** Height of the SQL editor above the results panel when nothing is saved. */
export const DEFAULT_EDITOR_PANEL_HEIGHT = 300;

/** Smallest height the resize handle allows. */
export const MIN_EDITOR_PANEL_HEIGHT = 100;

/** Room kept below the editor for the results panel and the window chrome. */
const RESULTS_RESERVE = 200;

/**
 * Turns the saved editor height into one that fits the current window: a value
 * saved on a larger screen must not push the results panel out of view.
 */
export function resolveEditorPanelHeight(stored: unknown, windowHeight: number): number {
    const height =
        typeof stored === 'number' && Number.isFinite(stored)
            ? stored
            : DEFAULT_EDITOR_PANEL_HEIGHT;
    const max = Math.max(MIN_EDITOR_PANEL_HEIGHT, windowHeight - RESULTS_RESERVE);
    return Math.round(Math.min(Math.max(height, MIN_EDITOR_PANEL_HEIGHT), max));
}
