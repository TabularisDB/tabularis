export const INTERFACE_SCALE_DEFAULT = 100;
export const INTERFACE_SCALE_OPTIONS = [75, 100, 125, 150, 175, 200] as const;

export function normalizeInterfaceScale(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(200, Math.max(75, value))
        : INTERFACE_SCALE_DEFAULT;
}
