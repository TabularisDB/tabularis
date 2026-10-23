/** Bounds shared by the Appearance slider and the editor zoom shortcuts. */
export const EDITOR_FONT_SIZE_MIN = 10;
export const EDITOR_FONT_SIZE_MAX = 20;
export const EDITOR_FONT_SIZE_DEFAULT = 14;

/** Rounds to a whole pixel and keeps the size within the supported range. */
export function clampEditorFontSize(size: number): number {
    if (!Number.isFinite(size)) return EDITOR_FONT_SIZE_DEFAULT;
    return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(size)));
}

/** Returns the size one step (1px) up or down from `current`, clamped. */
export function stepEditorFontSize(current: number | undefined, direction: 1 | -1): number {
    return clampEditorFontSize((current ?? EDITOR_FONT_SIZE_DEFAULT) + direction);
}
