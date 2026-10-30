import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {Search} from 'lucide-react';
import clsx from 'clsx';
import {calculateContextMenuPosition} from '@/utils/contextMenu';
import {
    filterColumnsByName,
    hideColumns,
    NO_HIDDEN_COLUMNS,
    showColumns,
} from '@/utils/hiddenColumns';

const POPOVER_WIDTH = 256;
const POPOVER_HEIGHT = 360;
/** Results wider than this get a search field above the list. */
const SEARCH_MIN_COLUMNS = 8;

const FOCUS_RING =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export interface ColumnVisibilityPopoverProps {
    /** Id of the dialog, for the trigger's `aria-controls`. */
    id?: string;
    /** Viewport point the popover opens at (a header menu's position, or below a button). */
    x: number;
    y: number;
    columns: readonly string[];
    /** Indices of the hidden columns. */
    hidden: ReadonlySet<number>;
    onChange: (hidden: ReadonlySet<number>) => void;
    /**
     * The element that gets focus back when the popover is closed with Escape.
     * An outside click leaves focus on what was clicked.
     */
    returnFocusTo?: () => HTMLElement | null;
    onClose: () => void;
}

/**
 * Checkbox list of the result's columns (#1299): ticked columns are shown,
 * unticked ones hidden. Changes apply at once; the last visible column can't
 * be unticked. Wide results get a search field, and "Show all" brings every
 * hidden column back.
 */
export const ColumnVisibilityPopover = ({
    id,
    x,
    y,
    columns,
    hidden,
    onChange,
    returnFocusTo,
    onClose,
}: ColumnVisibilityPopoverProps) => {
    const {t} = useTranslation();
    const [query, setQuery] = useState('');
    const popover = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const titleId = useId();
    const withSearch = columns.length >= SEARCH_MIN_COLUMNS;
    const visibleCount = columns.length - hidden.size;

    const position = useMemo(() => {
        const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
        const height = Math.min(POPOVER_HEIGHT, window.innerHeight - 16);
        return calculateContextMenuPosition({
            clickX: x,
            clickY: y,
            menuWidth: width,
            menuHeight: height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            margin: 8,
        });
    }, [x, y]);

    const close = useCallback(
        (restoreFocus = false) => {
            onClose();
            if (restoreFocus) returnFocusTo?.()?.focus();
        },
        [onClose, returnFocusTo],
    );

    useEffect(() => {
        const first = searchRef.current ?? popover.current?.querySelector('input:not(:disabled)');
        (first instanceof HTMLElement ? first : popover.current)?.focus();
    }, []);

    // Unlike the other popovers it stays open while the grid scrolls: hiding a
    // column can shift the grid's scroll position, and the list must survive
    // that to hide or show the next column.
    useEffect(() => {
        const outside = (event: MouseEvent) => {
            if (event.target instanceof Node && !popover.current?.contains(event.target)) {
                close();
            }
        };
        const dismiss = () => close();
        document.addEventListener('mousedown', outside);
        window.addEventListener('resize', dismiss);
        return () => {
            document.removeEventListener('mousedown', outside);
            window.removeEventListener('resize', dismiss);
        };
    }, [close]);

    // Keys stay in the popover: the grid acts on arrows, Space, Enter and
    // Delete/Backspace (deleting selected rows) from the document. Shortcuts
    // with Cmd/Ctrl still reach the app.
    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
            return;
        }
        if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
    };

    const matches = useMemo(() => filterColumnsByName(columns, query), [columns, query]);

    const toggle = (index: number) => {
        const next = hidden.has(index)
            ? showColumns(hidden, [index])
            : hideColumns(columns.length, hidden, [index]);
        // The last visible column stays: hideColumns hands back the same set.
        if (next !== hidden) onChange(next);
    };

    return createPortal(
        <div
            ref={popover}
            id={id}
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            style={position}
            className="fixed z-[200] flex flex-col w-64 max-w-[calc(100vw-16px)] max-h-[min(360px,calc(100vh-16px))] rounded-lg border border-strong bg-elevated shadow-xl focus:outline-none"
        >
            {/* Layout wrapper: keeps keys and clicks inside away from the grid and
                from clickable hosts (a result header that collapses on click). */}
            <div
                role="presentation"
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="flex flex-col min-h-0"
            >
                <div className="flex items-baseline justify-between gap-3 px-3 pt-2.5 pb-2">
                    <h2 id={titleId} className="text-xs font-medium text-secondary">
                        {t('dataGrid.columnVisibility.title')}
                    </h2>
                    <span aria-live="polite" className="text-[11px] tabular-nums text-muted">
                        {t('dataGrid.columnVisibility.shown', {
                            visible: visibleCount,
                            total: columns.length,
                        })}
                    </span>
                </div>

                {withSearch && (
                    <div className="px-3 pb-2">
                        <div className="flex items-center gap-1.5 bg-base border border-default rounded px-2 focus-within:border-focus/60 transition-colors">
                            <Search size={12} className="shrink-0 text-muted" aria-hidden="true" />
                            <input
                                ref={searchRef}
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                aria-label={t('dataGrid.searchColumns')}
                                placeholder={t('dataGrid.searchColumns')}
                                spellCheck={false}
                                autoComplete="off"
                                className="w-full min-w-0 bg-transparent py-1 text-xs text-primary placeholder:text-muted focus:outline-none"
                            />
                        </div>
                    </div>
                )}

                <div className="flex-1 min-h-[64px] overflow-y-auto border-t border-default/60 py-1">
                    {matches.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-muted">
                            {t('dataGrid.noMatchingColumns')}
                        </p>
                    ) : (
                        <ul>
                            {matches.map(({name, index}) => {
                                const isHidden = hidden.has(index);
                                const isLastVisible = !isHidden && visibleCount === 1;
                                return (
                                    <li key={index}>
                                        <label
                                            title={
                                                isLastVisible
                                                    ? t('dataGrid.columnVisibility.lastVisible')
                                                    : name
                                            }
                                            className={clsx(
                                                'flex items-center gap-2 px-3 py-1 text-xs transition-colors',
                                                isLastVisible
                                                    ? 'cursor-not-allowed'
                                                    : 'cursor-pointer hover:bg-surface-secondary/60',
                                            )}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={!isHidden}
                                                disabled={isLastVisible}
                                                onChange={() => toggle(index)}
                                                className={clsx(
                                                    'shrink-0 accent-accent-primary disabled:opacity-50',
                                                    FOCUS_RING,
                                                )}
                                            />
                                            <span
                                                className={clsx(
                                                    'flex-1 min-w-0 truncate transition-colors',
                                                    isHidden ? 'text-muted' : 'text-primary',
                                                )}
                                            >
                                                {name === '' ? (
                                                    <span className="italic text-muted">''</span>
                                                ) : (
                                                    name
                                                )}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="flex items-center justify-end px-3 py-2 border-t border-default/60 bg-base/40 rounded-b-lg">
                    <button
                        type="button"
                        onClick={() => onChange(NO_HIDDEN_COLUMNS)}
                        disabled={hidden.size === 0}
                        className={clsx(
                            'px-2.5 py-1 rounded text-xs font-medium border transition-colors bg-accent-primary/15 border-accent-primary/25 text-accent hover:bg-accent-primary/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent-primary/15',
                            FOCUS_RING,
                        )}
                    >
                        {t('dataGrid.columnVisibility.showAll')}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};
