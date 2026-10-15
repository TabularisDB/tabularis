/**
 * Workaround for a Monaco bug in its <textarea>-based keyboard input, the
 * path used wherever the EditContext API is missing: every WebKit build
 * (WKWebView on macOS, WebKitGTK on Linux, i.e. Tauri outside Windows) and
 * Firefox. Chromium is unaffected only because it uses EditContext.
 *
 * With `accessibilitySupport: "auto"` Monaco mirrors the text around the
 * cursor into a hidden textarea. For a backward selection (Shift+Home,
 * Shift+Left, Shift+Up) it writes the mirror as
 * `setSelectionRange(anchor, active)` with anchor > active (vscode
 * `screenReaderUtils.ts`). Browsers collapse a reversed range to the smaller
 * offset, leaving the textarea caret *before* the selected text. The next typed
 * character is inserted ahead of the mirrored text, Monaco deduces a
 * one-character "composition replace", and `cursorTypeEditOperations` ignores
 * composition input while the editor selection is non-empty, so the character
 * vanishes (TabularisDB/tabularis#731).
 *
 * Collapsing the reversed range at the anchor instead leaves the caret after
 * the mirrored text. The typed character then lands behind it and Monaco
 * deduces a plain `type`, which replaces the editor selection as expected.
 */
export const MONACO_INPUT_AREA_CLASS = "inputarea";

type SelectionRangeTarget = Pick<HTMLTextAreaElement, "setSelectionRange">;

const installed = new WeakMap<SelectionRangeTarget, () => void>();

/**
 * Patches `setSelectionRange` on the given prototype so that a reversed range
 * on Monaco's input textarea collapses at `start` (the selection anchor).
 * Other textareas keep the native behaviour. Idempotent per prototype; returns
 * the uninstall function.
 */
export function installMonacoInputAreaSelectionFix(
  prototype: SelectionRangeTarget = HTMLTextAreaElement.prototype,
): () => void {
  const existing = installed.get(prototype);
  if (existing) return existing;

  const native = prototype.setSelectionRange;
  const patched: HTMLTextAreaElement["setSelectionRange"] = function (
    this: HTMLTextAreaElement,
    start,
    end,
    direction,
  ) {
    const reversed =
      typeof start === "number" && typeof end === "number" && end < start;
    const fixedEnd =
      reversed && this.classList.contains(MONACO_INPUT_AREA_CLASS) ? start : end;
    if (direction === undefined) {
      native.call(this, start, fixedEnd);
    } else {
      native.call(this, start, fixedEnd, direction);
    }
  };
  prototype.setSelectionRange = patched;

  const uninstall = () => {
    if (prototype.setSelectionRange === patched) {
      prototype.setSelectionRange = native;
    }
    installed.delete(prototype);
  };
  installed.set(prototype, uninstall);
  return uninstall;
}
