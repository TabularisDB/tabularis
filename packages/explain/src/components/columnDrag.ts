/**
 * Pointer-based drag of a table column header. HTML5 drag and drop is avoided
 * on purpose: in WebKitGTK (the Linux desktop webview) it can freeze the
 * webview, and the desktop windows turn the native drag handler off.
 */

export interface ColumnDragOptions {
    /** Pixels of pointer travel before the drag starts, so clicks keep working. */
    threshold?: number;
    onDragStart: () => void;
    onDragMove: (x: number, y: number) => void;
    /** Called on release, only if the drag started. */
    onDrop: (x: number, y: number) => void;
    /** Always called on release, after `onDrop`. */
    onEnd: () => void;
}

export function startColumnDrag(startX: number, startY: number, options: ColumnDragOptions): void {
    const {threshold = 4, onDragStart, onDragMove, onDrop, onEnd} = options;
    let started = false;
    let overlay: HTMLDivElement | null = null;

    const handleMouseMove = (event: MouseEvent) => {
        if (!started) {
            if (
                Math.abs(event.clientX - startX) < threshold &&
                Math.abs(event.clientY - startY) < threshold
            ) {
                return;
            }
            started = true;
            // Keeps text selection and other widgets out of the way while dragging.
            overlay = document.createElement('div');
            overlay.style.cssText =
                'position:fixed;inset:0;z-index:9999;cursor:grabbing;user-select:none';
            document.body.appendChild(overlay);
            onDragStart();
        }
        onDragMove(event.clientX, event.clientY);
    };

    const handleMouseUp = (event: MouseEvent) => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        if (started) {
            overlay?.remove();
            // The release would otherwise click the header under the pointer.
            const suppressClick = (clickEvent: MouseEvent) => {
                clickEvent.stopPropagation();
                clickEvent.preventDefault();
                window.removeEventListener('click', suppressClick, true);
            };
            window.addEventListener('click', suppressClick, true);
            setTimeout(() => window.removeEventListener('click', suppressClick, true), 0);
            onDrop(event.clientX, event.clientY);
        }
        onEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}
