function components(color: string): [number, number, number, number] {
  if (!/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
    throw new Error("Expected a six- or eight-digit theme color");
  }
  return [
    Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16), color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) : 255,
  ];
}

function byte(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

function assertFraction(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid color fraction");
}

/** Flatten foreground opacity against an already opaque, deterministic base. */
export function flattenThemeColor(color: string, background: string): string {
  const [r, g, b, alpha] = components(color);
  const [br, bg, bb, ba] = components(background);
  if (ba !== 255) throw new Error("Theme compositing requires an opaque background");
  const a = alpha / 255;
  return `#${byte(r * a + br * (1 - a))}${byte(g * a + bg * (1 - a))}${byte(b * a + bb * (1 - a))}`;
}

export function withThemeAlpha(color: string, opacity: number): string {
  assertFraction(opacity);
  const [r, g, b, a] = components(color);
  return `#${byte(r)}${byte(g)}${byte(b)}${byte(a * opacity)}`;
}

export function lightenThemeColor(color: string, amount: number): string {
  assertFraction(amount);
  const [r, g, b, a] = components(color);
  const rgb = `#${byte(r + (255 - r) * amount)}${byte(g + (255 - g) * amount)}${byte(b + (255 - b) * amount)}`;
  return color.length === 9 ? `${rgb}${byte(a)}` : rgb;
}
