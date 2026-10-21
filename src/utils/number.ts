/** Clamps a numeric value between min and max (inclusive). */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
