export function isTextCompositionKeyEvent(event: KeyboardEvent): boolean {
  return (
    event.isComposing ||
    event.key === "Dead" ||
    event.key === "Process" ||
    event.key === "Unidentified" ||
    event.keyCode === 229
  );
}
