import {useTranslation} from 'react-i18next';

interface ColumnResizeHandleProps {
    index: number;
    width: number;
    minWidth: number;
    maxWidth: number;
    /** Accessible name; defaults to the generic "Resize column". */
    label?: string;
    onMouseDown: (index: number, e: React.MouseEvent) => void;
    onKeyDown: (index: number, e: React.KeyboardEvent) => void;
    /** Fits the column to its content (header and loaded rows). */
    onDoubleClick?: (index: number) => void;
}

/**
 * Drag handle on the right edge of a `<th>`, resizable with the mouse or,
 * once focused, with the arrow keys (Shift for larger steps, Home/End for the
 * limits). Pair with `useColumnResize` or `useLockedColumnResize`.
 */
export function ColumnResizeHandle({
    index,
    width,
    minWidth,
    maxWidth,
    label,
    onMouseDown,
    onKeyDown,
    onDoubleClick,
}: ColumnResizeHandleProps) {
    const {t} = useTranslation();
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- a focusable separator is an ARIA widget (value + arrow keys), but jsx-a11y classifies every separator as static */
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={label ?? t('common.resizeColumn')}
            tabIndex={0}
            aria-valuenow={width}
            aria-valuemin={minWidth}
            aria-valuemax={maxWidth}
            onKeyDown={(e) => onKeyDown(index, e)}
            onMouseDown={(e) => onMouseDown(index, e)}
            onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDoubleClick?.(index);
            }}
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent-primary/60 active:bg-accent-primary select-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        />
    );
    /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
