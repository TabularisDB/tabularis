import {useCallback, useEffect, useMemo, useRef, useState, type RefObject} from 'react';
import {
    buildGridFindIndex,
    findMatchIndexFrom,
    getRevealScrollDelta,
    groupMatchesByRow,
    searchGridFindIndex,
    stepMatchIndex,
    type GridCellPosition,
} from '@/utils/gridFind';

const NO_MATCHES: GridCellPosition[] = [];

interface UseGridFindOptions {
    /** Rows in the grid's row model (loaded rows plus pending insertions). */
    rowCount: number;
    /** Searchable text of each cell of a row (see getFindRowTexts); a new function re-runs the search. */
    getRowTexts: (rowIndex: number) => ReadonlyArray<string | null>;
    /** The grid's scroll container. */
    scrollElementRef: RefObject<HTMLElement | null>;
    /** Scrolls a row to the middle of the viewport, which also mounts it in the virtualized body. */
    scrollToRow: (rowIndex: number) => void;
}

export interface GridFind {
    isOpen: boolean;
    query: string;
    caseSensitive: boolean;
    matchCount: number;
    /** Zero-based position of the current match among all matches, -1 without matches. */
    currentIndex: number;
    currentMatch: GridCellPosition | null;
    /** Matched column indices by row index. */
    matchesByRow: ReadonlyMap<number, ReadonlySet<number>>;
    inputRef: RefObject<HTMLInputElement | null>;
    /** Opens the bar searching from `anchor`, or focuses its field when it is already open. */
    open: (anchor: GridCellPosition | null) => void;
    /** Closes the bar and clears the highlight; returns the match it was on. */
    close: () => GridCellPosition | null;
    setQuery: (query: string) => void;
    toggleCaseSensitive: () => void;
    goToNext: () => void;
    goToPrevious: () => void;
}

/**
 * Scrolls a cell into view in a virtualized grid: the row through the
 * virtualizer when it is not fully visible below the sticky header, then the
 * column once the row is mounted, clear of the sticky row numbers and frozen
 * first column. Returns a function that cancels the pending column scroll.
 */
function revealCell(
    scrollElement: HTMLElement,
    {rowIndex, colIndex}: GridCellPosition,
    scrollToRow: (rowIndex: number) => void,
): () => void {
    const view = scrollElement.getBoundingClientRect();
    const header = scrollElement.querySelector('thead');
    const headerHeight =
        header && getComputedStyle(header).position === 'sticky'
            ? header.getBoundingClientRect().height
            : 0;
    const row = scrollElement
        .querySelector(`tr[data-row-index="${rowIndex}"]`)
        ?.getBoundingClientRect();
    if (
        !row ||
        getRevealScrollDelta(
            row.top,
            row.bottom,
            view.top + headerHeight,
            view.top + scrollElement.clientHeight,
        ) !== 0
    ) {
        scrollToRow(rowIndex);
    }

    const frame = requestAnimationFrame(() => {
        const cell = scrollElement.querySelector(
            `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
        );
        // A frozen cell never leaves the view horizontally.
        if (!cell || getComputedStyle(cell).position === 'sticky') return;
        const {left: viewLeft} = scrollElement.getBoundingClientRect();
        let visibleLeft = viewLeft;
        scrollElement.querySelectorAll('thead th:nth-child(-n+2)').forEach((th) => {
            if (getComputedStyle(th).position === 'sticky') {
                visibleLeft = Math.max(visibleLeft, th.getBoundingClientRect().right);
            }
        });
        const rect = cell.getBoundingClientRect();
        const delta = getRevealScrollDelta(
            rect.left,
            rect.right,
            visibleLeft,
            viewLeft + scrollElement.clientWidth,
        );
        if (delta !== 0) scrollElement.scrollLeft += delta;
    });
    return () => cancelAnimationFrame(frame);
}

/**
 * State of the data grid's find bar (#1298). Matches are derived from the loaded
 * rows, so they follow refreshes and pending edits; the grid only scrolls when
 * the user searches or moves between matches.
 */
export function useGridFind({
    rowCount,
    getRowTexts,
    scrollElementRef,
    scrollToRow,
}: UseGridFindOptions): GridFind {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQueryValue] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    // Where the search continues from: the focused cell when the bar opened,
    // then the match the user moved to. The current match is the first match
    // at or after it.
    const [cursor, setCursor] = useState<GridCellPosition | null>(null);
    // Bumped by every search and move. Scrolling on these requests instead of
    // on every change of the current match keeps a refresh or a pending edit
    // from pulling the grid back to the match.
    const [revealRequest, setRevealRequest] = useState(0);
    const handledRevealRef = useRef(0);
    const cancelRevealRef = useRef<(() => void) | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const index = useMemo(
        () => (isOpen ? buildGridFindIndex(rowCount, getRowTexts, caseSensitive) : null),
        [isOpen, rowCount, getRowTexts, caseSensitive],
    );
    const matches = useMemo(
        () => (index ? searchGridFindIndex(index, query) : NO_MATCHES),
        [index, query],
    );
    const matchesByRow = useMemo(() => groupMatchesByRow(matches), [matches]);
    const currentIndex = findMatchIndexFrom(matches, cursor);
    const currentMatch = currentIndex >= 0 ? matches[currentIndex] : null;

    useEffect(() => {
        if (revealRequest === handledRevealRef.current) return;
        handledRevealRef.current = revealRequest;
        const scrollElement = scrollElementRef.current;
        if (!currentMatch || !scrollElement) return;
        cancelRevealRef.current?.();
        cancelRevealRef.current = revealCell(scrollElement, currentMatch, scrollToRow);
    }, [revealRequest, currentMatch, scrollElementRef, scrollToRow]);

    useEffect(() => () => cancelRevealRef.current?.(), []);

    const open = useCallback(
        (anchor: GridCellPosition | null) => {
            if (isOpen) {
                inputRef.current?.focus();
                inputRef.current?.select();
                return;
            }
            setIsOpen(true);
            setCursor(anchor);
            setRevealRequest((request) => request + 1);
        },
        [isOpen],
    );

    const close = useCallback(() => {
        setIsOpen(false);
        return currentMatch;
    }, [currentMatch]);

    const setQuery = useCallback((next: string) => {
        setQueryValue(next);
        setRevealRequest((request) => request + 1);
    }, []);

    const toggleCaseSensitive = useCallback(() => {
        setCaseSensitive((value) => !value);
        setRevealRequest((request) => request + 1);
    }, []);

    const goTo = useCallback(
        (direction: 1 | -1) => {
            const next = stepMatchIndex(currentIndex, matches.length, direction);
            if (next < 0) return;
            setCursor(matches[next]);
            setRevealRequest((request) => request + 1);
        },
        [currentIndex, matches],
    );
    const goToNext = useCallback(() => goTo(1), [goTo]);
    const goToPrevious = useCallback(() => goTo(-1), [goTo]);

    return {
        isOpen,
        query,
        caseSensitive,
        matchCount: matches.length,
        currentIndex,
        currentMatch,
        matchesByRow,
        inputRef,
        open,
        close,
        setQuery,
        toggleCaseSensitive,
        goToNext,
        goToPrevious,
    };
}
