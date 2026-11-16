import {
    useContext,
    useEffect,
    useId,
    type KeyboardEvent,
    type MouseEvent,
    type RefObject,
} from 'react';
import {useTranslation} from 'react-i18next';
import {CaseSensitive, ChevronDown, ChevronUp, Info, Search, X} from 'lucide-react';
import {KeybindingsContext} from '@/contexts/KeybindingsContext';
import {isTextCompositionKeyEvent} from '@/utils/keyboardEvents';

interface GridFindBarProps {
    inputRef: RefObject<HTMLInputElement | null>;
    query: string;
    caseSensitive: boolean;
    matchCount: number;
    /** Zero-based position of the current match, -1 without matches. */
    currentIndex: number;
    /** True when the result has more rows than the grid has loaded. */
    hasUnloadedRows: boolean;
    loadedRowCount: number;
    /** Rows in the whole result, when known. */
    totalRowCount?: number | null;
    onQueryChange: (query: string) => void;
    onToggleCaseSensitive: () => void;
    onNext: () => void;
    onPrevious: () => void;
    onClose: () => void;
}

const ICON_BUTTON_CLASS =
    'shrink-0 p-1 rounded text-secondary hover:text-primary hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** Keeps focus in the search field when a bar button is clicked, so typing and Enter keep working. */
const keepFieldFocus = (event: MouseEvent) => event.preventDefault();

/**
 * The data grid's find bar (#1298): searches the loaded rows, shows the
 * current position and moves between matches. Opens with focus in its field.
 */
export function GridFindBar({
    inputRef,
    query,
    caseSensitive,
    matchCount,
    currentIndex,
    hasUnloadedRows,
    loadedRowCount,
    totalRowCount,
    onQueryChange,
    onToggleCaseSensitive,
    onNext,
    onPrevious,
    onClose,
}: GridFindBarProps) {
    const {t} = useTranslation();
    const keybindings = useContext(KeybindingsContext);
    const scopeId = useId();

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [inputRef]);

    const hasQuery = query !== '';
    const hasMatches = matchCount > 0;
    const position = hasMatches
        ? t('dataGrid.find.position', {
              current: (currentIndex + 1).toLocaleString(),
              total: matchCount.toLocaleString(),
          })
        : '';
    const announcement = !hasQuery
        ? ''
        : hasMatches
          ? t('dataGrid.find.announcement', {
                current: (currentIndex + 1).toLocaleString(),
                total: matchCount.toLocaleString(),
            })
          : t('dataGrid.find.noResults');
    const scope =
        totalRowCount != null
            ? t('dataGrid.find.loadedRowsOfTotal', {
                  loaded: loadedRowCount.toLocaleString(),
                  total: totalRowCount.toLocaleString(),
              })
            : t('dataGrid.find.loadedRowsOnly', {loaded: loadedRowCount.toLocaleString()});

    // Escape and the find shortcut work from every control of the bar; Enter
    // and Shift+Enter move between matches from the field.
    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (isTextCompositionKeyEvent(event.nativeEvent)) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        } else if (keybindings?.matchesShortcut(event.nativeEvent, 'find_in_grid')) {
            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
        } else if (event.key === 'Enter' && event.currentTarget === inputRef.current) {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
        }
    };

    return (
        <div
            role="search"
            aria-label={t('dataGrid.find.label')}
            className="shrink-0 mb-1 flex items-center gap-1 h-9 px-1 rounded border border-default bg-elevated"
        >
            <div
                className={`flex flex-1 items-center gap-1.5 min-w-36 max-w-xs h-7 pl-2 pr-0.5 bg-base border rounded transition-colors ${
                    hasQuery && !hasMatches
                        ? 'border-accent-error/60 focus-within:border-accent-error'
                        : 'border-default focus-within:border-focus'
                }`}
            >
                <Search size={13} className="text-muted shrink-0" aria-hidden="true" />
                <input
                    ref={inputRef}
                    type="text"
                    role="searchbox"
                    aria-label={t('dataGrid.find.label')}
                    aria-describedby={hasUnloadedRows ? `${scopeId}-scope` : undefined}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('dataGrid.find.label')}
                    className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-primary placeholder:text-muted"
                />
                <button
                    type="button"
                    aria-pressed={caseSensitive}
                    aria-label={t('dataGrid.find.matchCase')}
                    title={t('dataGrid.find.matchCase')}
                    onMouseDown={keepFieldFocus}
                    onClick={onToggleCaseSensitive}
                    onKeyDown={handleKeyDown}
                    className={`shrink-0 p-0.5 rounded border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                        caseSensitive
                            ? 'bg-accent-primary/20 border-accent-primary/50 text-accent'
                            : 'border-transparent text-muted hover:text-primary hover:bg-surface-hover'
                    }`}
                >
                    <CaseSensitive size={14} aria-hidden="true" />
                </button>
            </div>
            <span
                aria-hidden="true"
                className={`shrink-0 min-w-20 px-1.5 text-center text-xs tabular-nums whitespace-nowrap ${
                    hasQuery && !hasMatches ? 'text-accent-error' : 'text-secondary'
                }`}
            >
                {hasQuery && !hasMatches ? t('dataGrid.find.noResults') : position}
            </span>
            <span role="status" className="sr-only">
                {announcement}
            </span>
            <button
                type="button"
                aria-label={t('dataGrid.find.previous')}
                title={`${t('dataGrid.find.previous')} (Shift+Enter)`}
                disabled={!hasMatches}
                onMouseDown={keepFieldFocus}
                onClick={onPrevious}
                onKeyDown={handleKeyDown}
                className={ICON_BUTTON_CLASS}
            >
                <ChevronUp size={14} aria-hidden="true" />
            </button>
            <button
                type="button"
                aria-label={t('dataGrid.find.next')}
                title={`${t('dataGrid.find.next')} (Enter)`}
                disabled={!hasMatches}
                onMouseDown={keepFieldFocus}
                onClick={onNext}
                onKeyDown={handleKeyDown}
                className={ICON_BUTTON_CLASS}
            >
                <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div className="ml-auto flex items-center gap-1 min-w-0 pl-2">
                {hasUnloadedRows && (
                    <span
                        id={`${scopeId}-scope`}
                        title={t('dataGrid.find.loadedRowsHint')}
                        className="flex items-center gap-1 min-w-0 text-[11px] text-muted"
                    >
                        <Info size={12} className="shrink-0" aria-hidden="true" />
                        <span className="truncate">{scope}</span>
                    </span>
                )}
                <button
                    type="button"
                    aria-label={t('dataGrid.find.close')}
                    title={`${t('dataGrid.find.close')} (Esc)`}
                    onClick={onClose}
                    onKeyDown={handleKeyDown}
                    className={ICON_BUTTON_CLASS}
                >
                    <X size={14} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
