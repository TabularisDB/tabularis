import {useCallback, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {EyeOff} from 'lucide-react';
import clsx from 'clsx';
import {ColumnVisibilityPopover} from './ColumnVisibilityPopover';

/** Hidden column names listed in the indicator's tooltip before it says "…". */
const TOOLTIP_NAME_LIMIT = 8;

interface HiddenColumnsIndicatorProps {
    columns: string[];
    /** Indices of the hidden columns. */
    hidden: ReadonlySet<number>;
    onChange: (hidden: ReadonlySet<number>) => void;
    className?: string;
}

/**
 * "2 hidden" chip for a result's status bar (#1299). Shown while columns are
 * hidden; opens the column list to show them one by one or all at once.
 */
export function HiddenColumnsIndicator({
    columns,
    hidden,
    onChange,
    className,
}: HiddenColumnsIndicatorProps) {
    const {t} = useTranslation();
    const trigger = useRef<HTMLButtonElement>(null);
    const [anchor, setAnchor] = useState<{x: number; y: number} | null>(null);
    const dialogId = useId();

    const toggle = () => {
        if (anchor) {
            setAnchor(null);
            return;
        }
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) setAnchor({x: rect.left, y: rect.bottom + 4});
    };
    const close = useCallback(() => setAnchor(null), []);
    const returnFocus = useCallback(() => trigger.current, []);

    const names = [...hidden].sort((a, b) => a - b).map((i) => columns[i] || "''");
    const tooltip =
        names.length > TOOLTIP_NAME_LIMIT
            ? `${names.slice(0, TOOLTIP_NAME_LIMIT).join(', ')}, …`
            : names.join(', ');

    return (
        <>
            {/* The list stays open after "Show all" removes the chip. */}
            {hidden.size > 0 && (
                <button
                    ref={trigger}
                    type="button"
                    onClick={toggle}
                    // Keep the press from reaching the list's outside-click close,
                    // so the button toggles it instead of closing and reopening it.
                    onMouseDown={(e) => {
                        if (anchor) e.stopPropagation();
                    }}
                    aria-haspopup="dialog"
                    aria-expanded={anchor !== null}
                    aria-controls={anchor ? dialogId : undefined}
                    aria-label={t('dataGrid.columnVisibility.hiddenLabel', {count: hidden.size})}
                    title={tooltip}
                    className={clsx(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 animate-fade-in transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        anchor
                            ? 'bg-accent-primary/25 border-accent-primary/40 text-accent'
                            : 'bg-accent-primary/15 border-accent-primary/25 text-accent hover:bg-accent-primary/25',
                        className,
                    )}
                >
                    <EyeOff size={12} aria-hidden="true" />
                    {t('dataGrid.columnVisibility.hiddenCount', {count: hidden.size})}
                </button>
            )}
            {anchor && (
                <ColumnVisibilityPopover
                    id={dialogId}
                    x={anchor.x}
                    y={anchor.y}
                    columns={columns}
                    hidden={hidden}
                    onChange={onChange}
                    returnFocusTo={returnFocus}
                    onClose={close}
                />
            )}
        </>
    );
}
