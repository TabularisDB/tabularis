import {useCallback, useEffect, useRef} from 'react';
import {getKeyboardColumnWidth, isColumnResizeKey} from '@/utils/columnResize';
import {clamp} from '@/utils/number';

interface LockedColumnResizeOptions {
    /** The `<table>` whose `<colgroup>` holds one `<col>` per width. */
    tableRef: React.RefObject<HTMLTableElement | null>;
    /** Current widths, indexed like the `<col>` elements; null while unlocked. */
    widths: readonly number[] | null;
    minWidth: number;
    maxWidth: number;
    /** Commits a new width for the column at `index`. */
    onResize: (index: number, width: number) => void;
}

/**
 * Mouse and keyboard resizing for a table whose column widths live in the
 * caller's state (the DataGrid's locked widths, #844), driving the shared
 * `ColumnResizeHandle`.
 *
 * A drag never re-renders the grid: each mouse move is coalesced into one
 * animation frame that writes the width to the column's `<col>`, the table
 * width and the handle's `aria-valuenow` directly. The final width is
 * committed once through `onResize` on mouse up; Escape cancels the drag and
 * restores the previous width. The handle's keys (arrows, Shift for larger
 * steps, Home/End for the limits) commit straight away.
 */
export function useLockedColumnResize({
    tableRef,
    widths,
    minWidth,
    maxWidth,
    onResize,
}: LockedColumnResizeOptions) {
    // Ends an in-progress drag; also run on unmount so no listener outlives
    // the grid.
    const endDragRef = useRef<(() => void) | null>(null);
    useEffect(() => () => endDragRef.current?.(), []);

    const startResize = useCallback(
        (index: number, e: React.MouseEvent) => {
            if (e.button !== 0) return;
            // Keep the press away from the header: no column selection, no sort,
            // no text selection, no focus change.
            e.preventDefault();
            e.stopPropagation();
            const table = tableRef.current;
            const col = table?.querySelectorAll('col')[index];
            const startWidth = widths?.[index];
            if (!table || !col || !widths || startWidth === undefined) return;
            endDragRef.current?.();

            const handle = e.currentTarget as HTMLElement;
            const startX = e.clientX;
            const otherColumnsWidth = widths.reduce((sum, w) => sum + w, 0) - startWidth;
            const initialTableWidth = table.style.width;
            let width = startWidth;
            let frame = 0;

            const paint = (next: number, tableWidth: string) => {
                col.style.width = `${next}px`;
                table.style.width = tableWidth;
                handle.setAttribute('aria-valuenow', String(Math.round(next)));
            };
            const onFrame = () => {
                frame = 0;
                paint(width, `${otherColumnsWidth + width}px`);
            };
            const onMove = (ev: MouseEvent) => {
                width = Math.round(clamp(startWidth + ev.clientX - startX, minWidth, maxWidth));
                if (!frame) frame = requestAnimationFrame(onFrame);
            };
            const end = () => {
                if (frame) cancelAnimationFrame(frame);
                frame = 0;
                endDragRef.current = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('keydown', onKey, true);
            };
            const onUp = () => {
                end();
                if (width === startWidth) {
                    paint(startWidth, initialTableWidth);
                    return;
                }
                // Paint the final width now (a frame may still be pending), so the
                // committing render finds the DOM already where it puts it.
                paint(width, `${otherColumnsWidth + width}px`);
                onResize(index, width);
            };
            const onKey = (ev: KeyboardEvent) => {
                if (ev.key !== 'Escape') return;
                ev.preventDefault();
                ev.stopPropagation();
                end();
                paint(startWidth, initialTableWidth);
            };

            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('keydown', onKey, true);
            endDragRef.current = end;
        },
        [tableRef, widths, minWidth, maxWidth, onResize],
    );

    const onResizeKeyDown = useCallback(
        (index: number, e: React.KeyboardEvent) => {
            const width = widths?.[index];
            if (width === undefined || !isColumnResizeKey(e.key)) return;
            // Handled here, so the grid's own arrow-key navigation stays put.
            e.preventDefault();
            e.stopPropagation();
            const next = getKeyboardColumnWidth(e.key, e.shiftKey, width, minWidth, maxWidth);
            if (next !== null && next !== width) onResize(index, next);
        },
        [widths, minWidth, maxWidth, onResize],
    );

    return {startResize, onResizeKeyDown};
}
