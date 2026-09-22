import { describe, expect, it, vi } from "vitest";
import { isTextCompositionKeyEvent, onActivationKey } from "../../src/utils/keyboardEvents";

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

    it("detects compose keys", () => {
      const event = new KeyboardEvent("keydown", { key: "Compose" });
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

  describe("onActivationKey", () => {
    const keyEvent = (key: string, nested = false) => {
      const currentTarget = document.createElement("div");
      const target = nested ? document.createElement("input") : currentTarget;
      return { key, target, currentTarget, preventDefault: vi.fn() };
    };

    it.each(["Enter", " "])("activates on %j and prevents the default action", (key) => {
      const activate = vi.fn();
      const event = keyEvent(key);
      onActivationKey(activate)(event);
      expect(activate).toHaveBeenCalledWith(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("ignores other keys", () => {
      const activate = vi.fn();
      const event = keyEvent("a");
      onActivationKey(activate)(event);
      expect(activate).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("ignores keys pressed inside a nested control", () => {
      const activate = vi.fn();
      const event = keyEvent("Enter", true);
      onActivationKey(activate)(event);
      expect(activate).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });
});
