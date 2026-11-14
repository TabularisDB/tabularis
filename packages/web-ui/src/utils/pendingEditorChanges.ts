/**
 * SQL editors hand their text to their owner a little after each keystroke
 * (a debounce), so for a moment the owner's state lags behind what the editor
 * shows. Each mounted editor registers a flush here, and code that reads that
 * state for the user (exports) flushes first, so it sees the text on screen.
 */
type PendingFlush = () => void;

const pendingFlushes = new Set<PendingFlush>();

/** Registers a flush; returns the function that removes it again. */
export function registerPendingEditorFlush(flush: PendingFlush): () => void {
    pendingFlushes.add(flush);
    return () => {
        pendingFlushes.delete(flush);
    };
}

/** Hands every held-back editor change to its owner now. */
export function flushPendingEditorChanges(): void {
    for (const flush of Array.from(pendingFlushes)) {
        flush();
    }
}
