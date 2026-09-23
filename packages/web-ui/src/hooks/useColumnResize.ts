import { useCallback, useRef, useState } from 'react';

const KEYBOARD_STEP = 10;
const KEYBOARD_STEP_LARGE = 50;

/**
 * Manages column widths for a resizable HTML table used with `<colgroup>`/`<col>`.
 * Pair with a resize handle positioned on each `<th>`'s right edge.
 *
 * @param count Current column count. When it changes, widths are resized
 *   (additions default to `defaultWidth`; removals drop trailing entries).
 * @param defaultWidth Initial width for newly added columns (px).
 * @param minWidth Minimum width allowed while dragging (px).
 * @param initialWidths Optional per-column initial widths; any index without
 *   an entry falls back to `defaultWidth`.
 *
 * Besides `startResize` for mouse dragging, it returns `onResizeKeyDown` so a
 * focusable `role="separator"` handle can be resized with the arrow keys
 * (Home/End jump to the limits), plus `minWidth`/`maxWidth` for its
 * `aria-valuemin`/`aria-valuemax`.
 */
export function useColumnResize(
  count: number,
  defaultWidth = 140,
  minWidth = 40,
  initialWidths?: readonly number[],
  maxWidth = 2000,
) {
  const [widths, setWidths] = useState<number[]>(() =>
    Array.from({ length: count }, (_, i) => initialWidths?.[i] ?? defaultWidth),
  );
  const resizing = useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  // Reconcile length when `count` changes. This uses React's sanctioned
  // "adjust state during render" pattern — setState is safe here because it
  // only runs when lengths disagree and converges in one extra render.
  if (widths.length !== count) {
    setWidths((prev) => {
      if (prev.length === count) return prev;
      if (prev.length < count) {
        return [...prev, ...Array.from({ length: count - prev.length }, () => defaultWidth)];
      }
      return prev.slice(0, count);
    });
  }

  const startResize = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizing.current = {
        index,
        startX: e.clientX,
        startWidth: widths[index] ?? defaultWidth,
      };

      const onMove = (ev: MouseEvent) => {
        const state = resizing.current;
        if (!state) return;
        const delta = ev.clientX - state.startX;
        const next = Math.min(maxWidth, Math.max(minWidth, state.startWidth + delta));
        setWidths((prev) => prev.map((w, i) => (i === state.index ? next : w)));
      };

      const onUp = () => {
        resizing.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [widths, defaultWidth, minWidth, maxWidth],
  );

  const onResizeKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      const step = e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
      let update: ((width: number) => number) | null = null;
      if (e.key === 'ArrowLeft') update = (w) => w - step;
      else if (e.key === 'ArrowRight') update = (w) => w + step;
      else if (e.key === 'Home') update = () => minWidth;
      else if (e.key === 'End') update = () => maxWidth;
      if (!update) return;
      e.preventDefault();
      e.stopPropagation();
      const apply = update;
      setWidths((prev) =>
        prev.map((w, i) =>
          i === index ? Math.min(maxWidth, Math.max(minWidth, apply(w))) : w,
        ),
      );
    },
    [minWidth, maxWidth],
  );

  return { widths, startResize, onResizeKeyDown, minWidth, maxWidth };
}
