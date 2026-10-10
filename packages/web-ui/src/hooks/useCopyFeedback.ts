import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Encapsulates the common "copy text → show checkmark → reset" pattern
 * used across dozens of components. Handles cleanup on unmount so
 * `setState` is never called on an unmounted component.
 *
 * @param resetMs  Time in ms before `copied` resets to false (default 2000).
 * @returns `{ copied, copy, reset }` — `copy(text)` writes `text` to the
 *          clipboard and flips `copied` to true for `resetMs` ms.
 *          `reset()` cancels the timer and immediately sets `copied` back to false.
 */
export function useCopyFeedback(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cleanup on unmount — cancels any pending reset timer.
  useEffect(() => clearTimer, [clearTimer]);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        clearTimer();
        setCopied(true);
        timerRef.current = setTimeout(() => setCopied(false), resetMs);
      } catch (err) {
        console.error("Failed to copy to clipboard:", err);
        clearTimer();
        setCopied(false);
      }
    },
    [clearTimer, resetMs],
  );

  const reset = useCallback(() => {
    clearTimer();
    setCopied(false);
  }, [clearTimer]);

  return { copied, copy, reset } as const;
}
