import { describe, expect, it } from "vitest";
import { isTextCompositionKeyEvent } from "../../src/utils/keyboardEvents";

describe("keyboardEvents", () => {
  describe("isTextCompositionKeyEvent", () => {
    it("detects active IME composition", () => {
      const event = new KeyboardEvent("keydown", { key: "a", isComposing: true });
      expect(isTextCompositionKeyEvent(event)).toBe(true);
    });

    it("detects dead keys", () => {
      const event = new KeyboardEvent("keydown", { key: "Dead" });
      expect(isTextCompositionKeyEvent(event)).toBe(true);
    });

    it("detects IME process keys", () => {
      const event = new KeyboardEvent("keydown", { key: "Process" });
      expect(isTextCompositionKeyEvent(event)).toBe(true);
    });

    it("detects unidentified keys", () => {
      const event = new KeyboardEvent("keydown", { key: "Unidentified" });
      expect(isTextCompositionKeyEvent(event)).toBe(true);
    });

    it("detects legacy IME keyCode 229", () => {
      const event = new KeyboardEvent("keydown", { key: "a", keyCode: 229 } as KeyboardEventInit);
      expect(isTextCompositionKeyEvent(event)).toBe(true);
    });

    it("lets ordinary shortcut key events through", () => {
      const event = new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        shiftKey: true,
      });
      expect(isTextCompositionKeyEvent(event)).toBe(false);
    });
  });
});
