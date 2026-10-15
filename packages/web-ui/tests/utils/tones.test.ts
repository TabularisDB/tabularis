import { describe, expect, it } from "vitest";
import {
  NEUTRAL_CHIP_CLASS,
  TONE_ACCENT,
  TONE_DOT_CLASS,
  TONE_SOFT_BG_CLASS,
  TONE_TEXT_CLASS,
  tint,
  toneStyle,
  type Tone,
} from "../../src/utils/tones";

const TONES: Tone[] = ["neutral", "primary", "success", "update", "warning", "danger"];

describe("tones", () => {
  describe("toneStyle", () => {
    it("returns no inline colours for neutral, which relies on surface classes", () => {
      expect(toneStyle("neutral")).toBeUndefined();
      expect(NEUTRAL_CHIP_CLASS).toContain("bg-surface-secondary");
    });

    it("tints background, border and text from the tone's theme accent", () => {
      const style = toneStyle("update")!;
      expect(style.backgroundColor).toBe("color-mix(in srgb, var(--accent-primary) 14%, var(--bg-elevated))");
      expect(style.borderColor).toBe("color-mix(in srgb, var(--accent-primary) 32%, var(--bg-elevated))");
      expect(style.color).toBe("color-mix(in srgb, var(--accent-primary) 40%, CanvasText)");
    });

    it("accepts custom mix ratios", () => {
      const style = toneStyle("primary", { background: 5, border: 10, text: 50 })!;
      expect(style.backgroundColor).toContain("var(--accent-primary) 5%");
      expect(style.borderColor).toContain("var(--accent-primary) 10%");
      expect(style.color).toContain("var(--accent-primary) 50%");
    });
  });

  it("maps every tone to a theme variable and matching utility classes", () => {
    for (const tone of TONES) {
      expect(TONE_DOT_CLASS[tone]).toMatch(/^bg-/);
      expect(TONE_TEXT_CLASS[tone]).toMatch(/^text-/);
      expect(TONE_SOFT_BG_CLASS[tone]).toMatch(/^bg-/);
      if (tone !== "neutral") expect(TONE_ACCENT[tone]).toMatch(/^var\(--accent-/);
    }
  });

  it("draws updates with the primary accent, apart from warning (deprecated) and danger", () => {
    expect(TONE_ACCENT.update).toBe("var(--accent-primary)");
    expect(TONE_DOT_CLASS.update).toBe("bg-accent-primary");
    expect(TONE_ACCENT.update).not.toBe(TONE_ACCENT.warning);
    expect(TONE_ACCENT.update).not.toBe(TONE_ACCENT.danger);
  });
  describe("tint", () => {
    it("mixes any color, including a theme variable, over transparent", () => {
      expect(tint("var(--accent-primary)", 19)).toBe("color-mix(in srgb, var(--accent-primary) 19%, transparent)");
      expect(tint("#3b82f6", 50)).toBe("color-mix(in srgb, #3b82f6 50%, transparent)");
    });
  });
});
