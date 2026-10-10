import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MONACO_INPUT_AREA_CLASS,
  installMonacoInputAreaSelectionFix,
} from "../../src/utils/monacoInputArea";

function createTextarea(className = ""): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.className = className;
  textarea.value = "SELECT";
  return textarea;
}

describe("monacoInputArea", () => {
  describe("installMonacoInputAreaSelectionFix", () => {
    let uninstall: (() => void) | undefined;

    afterEach(() => {
      uninstall?.();
      uninstall = undefined;
    });

    it("collapses a reversed range at the anchor on Monaco's input textarea", () => {
      uninstall = installMonacoInputAreaSelectionFix();
      const textarea = createTextarea(MONACO_INPUT_AREA_CLASS);

      // Monaco writes a backward selection (Shift+Home over "SELECT") as (6, 0).
      textarea.setSelectionRange(6, 0);

      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 6]);
    });

    it("keeps forward ranges and the direction argument untouched", () => {
      uninstall = installMonacoInputAreaSelectionFix();
      const textarea = createTextarea(MONACO_INPUT_AREA_CLASS);

      textarea.setSelectionRange(1, 4, "backward");

      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 4]);
      expect(textarea.selectionDirection).toBe("backward");
    });

    it("forwards calls from other textareas to the native method unchanged", () => {
      const native = vi.fn();
      const prototype = { setSelectionRange: native };
      uninstall = installMonacoInputAreaSelectionFix(prototype);
      const plain = createTextarea("some-other-field");

      prototype.setSelectionRange.call(plain, 6, 0);
      prototype.setSelectionRange.call(plain, 6, 0, "none");

      expect(native).toHaveBeenNthCalledWith(1, 6, 0);
      expect(native).toHaveBeenNthCalledWith(2, 6, 0, "none");
    });

    it("passes null offsets through without touching them", () => {
      const native = vi.fn();
      const prototype = { setSelectionRange: native };
      uninstall = installMonacoInputAreaSelectionFix(prototype);
      const textarea = createTextarea(MONACO_INPUT_AREA_CLASS);

      prototype.setSelectionRange.call(textarea, null, null);

      expect(native).toHaveBeenCalledWith(null, null);
    });

    it("is idempotent and restores the native method on uninstall", () => {
      const native = HTMLTextAreaElement.prototype.setSelectionRange;

      const first = installMonacoInputAreaSelectionFix();
      const second = installMonacoInputAreaSelectionFix();
      expect(second).toBe(first);
      expect(HTMLTextAreaElement.prototype.setSelectionRange).not.toBe(native);

      first();
      expect(HTMLTextAreaElement.prototype.setSelectionRange).toBe(native);

      // A fresh install after uninstall patches again.
      uninstall = installMonacoInputAreaSelectionFix();
      expect(HTMLTextAreaElement.prototype.setSelectionRange).not.toBe(native);
    });
  });
});
