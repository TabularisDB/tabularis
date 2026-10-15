import type { CSSProperties } from "react";

/**
 * Semantic tones shared by every chip, badge and status indicator in the
 * connections list, the plugin manager and the sidebar rail. One meaning maps
 * to one theme accent so the same hue reads the same everywhere:
 *
 * - `neutral`  descriptive attributes (driver, version, kind/tags)
 * - `primary`  the current/selected thing and built-in components
 * - `success`  live or healthy state (connected, installed, up to date, SSH)
 * - `update`   something new is available (core or plugin updates). Uses the
 *              primary accent like VS Code/GitHub "new" badges; anything that
 *              sits next to an update cue (e.g. the Enabled tile) avoids primary
 * - `warning`  needs attention but still works (deprecated, disabled, downgrade)
 * - `danger`   production environments and errors
 * - `theme`    declarative theme packages, so they never read as executable
 *              drivers; uses the palette's secondary accent
 */
export type Tone = "neutral" | "primary" | "success" | "update" | "warning" | "danger" | "theme";

export type TintedTone = Exclude<Tone, "neutral">;

/** Theme variable that drives each tinted tone; themes override these per palette. */
export const TONE_ACCENT: Record<TintedTone, string> = {
  primary: "var(--accent-primary)",
  success: "var(--accent-success)",
  update: "var(--accent-primary)",
  warning: "var(--accent-warning)",
  danger: "var(--accent-error)",
  theme: "var(--accent-secondary)",
};

/** Tailwind utility painting a solid dot/marker in the tone's accent. */
export const TONE_DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary",
  primary: "bg-accent-primary",
  success: "bg-accent-success",
  update: "bg-accent-primary",
  warning: "bg-accent-warning",
  danger: "bg-accent-error",
  theme: "bg-accent-secondary",
};

/** Tailwind utility for a soft tinted surface behind an icon or tile. */
export const TONE_SOFT_BG_CLASS: Record<Tone, string> = {
  neutral: "bg-surface-secondary",
  primary: "bg-accent-primary/10",
  success: "bg-accent-success/10",
  update: "bg-accent-primary/10",
  warning: "bg-accent-warning/10",
  danger: "bg-accent-error/10",
  theme: "bg-accent-secondary/10",
};

/** Tailwind utility for text-only usages of a tone (icons, inline labels). */
export const TONE_TEXT_CLASS: Record<Tone, string> = {
  neutral: "text-secondary",
  primary: "text-accent",
  success: "text-accent-success",
  update: "text-accent",
  warning: "text-accent-warning",
  danger: "text-accent-error",
  theme: "text-accent-secondary",
};

export interface TintOptions {
  /** Accent share mixed into the elevated background (percent). */
  background?: number;
  /** Accent share mixed into the border (percent). */
  border?: number;
  /** Accent share mixed into the theme's text colour (percent). */
  text?: number;
}

const DEFAULT_TINT: Required<TintOptions> = { background: 14, border: 32, text: 40 };

/**
 * Inline style tinting a surface with a tone: translucent background, soft
 * border and readable text. Built with `color-mix` on theme variables so it
 * adapts to every palette; `CanvasText` follows the theme's `color-scheme`
 * (light text on dark themes, dark text on light ones).
 * Returns `undefined` for `neutral`, which uses plain surface classes instead.
 */
export function toneStyle(tone: Tone, options: TintOptions = {}): CSSProperties | undefined {
  if (tone === "neutral") return undefined;
  const accent = TONE_ACCENT[tone];
  const tint = { ...DEFAULT_TINT, ...options };
  return {
    backgroundColor: `color-mix(in srgb, ${accent} ${tint.background}%, var(--bg-elevated))`,
    borderColor: `color-mix(in srgb, ${accent} ${tint.border}%, var(--bg-elevated))`,
    color: `color-mix(in srgb, ${accent} ${tint.text}%, CanvasText)`,
  };
}

/**
 * `color` at `percent` opacity over transparent. Built with `color-mix` so the
 * input may be a theme variable (`var(--accent-primary)`) as well as a hex.
 */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** Classes for neutral chips, the only tone that does not need inline colours. */
export const NEUTRAL_CHIP_CLASS = "bg-surface-secondary text-secondary border-strong/40";
