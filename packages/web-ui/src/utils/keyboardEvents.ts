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
