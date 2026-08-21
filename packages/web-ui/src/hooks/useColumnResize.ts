import { useCallback, useRef, useState } from 'react';

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
 */
export function useColumnResize(
  count: number,
  defaultWidth = 140,
  minWidth = 40,
  initialWidths?: readonly number[],
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
        const next = Math.max(minWidth, state.startWidth + delta);
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
    [widths, defaultWidth, minWidth],
  );

  return { widths, startResize };
}
