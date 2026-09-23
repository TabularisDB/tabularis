export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** Icon tile colour for declarative theme packages (drivers use their manifest colour). */
export const THEME_TILE_COLOR = "var(--accent-secondary)";
