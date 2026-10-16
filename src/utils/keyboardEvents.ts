export function isTextCompositionKeyEvent(event: KeyboardEvent): boolean {
  return (
    event.isComposing ||
    event.key === "Dead" ||
    event.key === "Process" ||
    event.key === "Unidentified" ||
    event.key === "Compose" ||
    event.keyCode === 229
  );
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Returns true if the event target is an interactive text-editing control where
 * typing keys (letters, digits, whitespace, editing shortcuts) should be received
 * by the element rather than triggering global or pane-level keyboard shortcuts.
 *
 * Targets include:
 * - `<textarea>` elements (including Monaco's hidden textarea)
 * - `<select>` elements (where typing selects/filters options)
 * - `<input>` elements (excluding non-text types like checkbox, radio, button, range)
 * - Any element with `isContentEditable` enabled
 */
export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target.isContentEditable ||
    target.contentEditable === "true" ||
    target.contentEditable === "" ||
    Boolean(target.closest?.("[contenteditable='true'], [contenteditable='']"))
  ) {
    return true;
  }

  const tagName = target.tagName;
  if (tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  if (tagName === "INPUT") {
    const type = (target as HTMLInputElement).type?.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }

  return false;
}

interface ActivationKeyEvent {
  key: string;
  target: EventTarget;
  currentTarget: EventTarget;
  preventDefault(): void;
}

/**
 * Keydown handler that runs `activate` on Enter or Space, the keys a native
 * button responds to. Use it with `role="button"` and `tabIndex={0}` on
 * elements that cannot be a `<button>` (for example because they contain other
 * controls). Keys pressed inside a nested control are ignored.
 */
export function onActivationKey<E extends ActivationKeyEvent>(activate: (event: E) => void): (event: E) => void {
  return (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate(event);
  };
}

export interface ShortcutFocusContext {
  inMonaco: boolean;
  inEditable: boolean;
}

export function getShortcutFocusContext(
  element: Element | null,
): ShortcutFocusContext {
  const inMonaco = !!element?.closest(".monaco-editor");
  const contentEditable = element?.closest("[contenteditable]")
    ?.getAttribute("contenteditable")
    ?.toLowerCase();
  const inEditable =
    inMonaco ||
    !!element?.matches("input, textarea, select") ||
    (element instanceof HTMLElement && element.isContentEditable === true) ||
    ["", "true", "plaintext-only"].includes(contentEditable ?? "false");
  return { inMonaco, inEditable };
}
