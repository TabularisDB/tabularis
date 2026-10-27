import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {PAGE_INPUT_SLOT, resolvePageJump, splitAroundPageSlot} from '@/utils/pagination';

interface PageIndicatorProps {
    page: number;
    /** Null when the result set has no known total. */
    totalPages: number | null;
    disabled?: boolean;
    onPageChange: (page: number) => void;
}

/**
 * "Page N of M" indicator whose current page is a numeric field.
 * Enter loads the typed page through `onPageChange`; Escape and blur
 * restore the page that is actually loaded.
 */
export function PageIndicator({
    page,
    totalPages,
    disabled = false,
    onPageChange,
}: PageIndicatorProps) {
    const {t} = useTranslation();
    const [draft, setDraft] = useState<string | null>(null);
    const [committed, setCommitted] = useState(false);
    const [trackedPage, setTrackedPage] = useState(page);
    const [trackedLoading, setTrackedLoading] = useState(disabled);

    // Drop a committed jump once the grid lands on it, and drop it when a
    // load finishes without moving, so a failed jump doesn't stick.
    if (page !== trackedPage) {
        setTrackedPage(page);
        if (committed) {
            setDraft(null);
            setCommitted(false);
        }
    }
    if (disabled !== trackedLoading) {
        setTrackedLoading(disabled);
        if (
            trackedLoading &&
            !disabled &&
            committed &&
            page === trackedPage &&
            draft !== null &&
            draft !== String(page)
        ) {
            setDraft(null);
            setCommitted(false);
        }
    }

    const displayed = draft ?? String(page);
    const label =
        totalPages !== null
            ? t('editor.pageOf', {current: PAGE_INPUT_SLOT, total: totalPages})
            : t('editor.page', {current: PAGE_INPUT_SLOT});
    const parts = splitAroundPageSlot(label);

    const revert = () => {
        setDraft(null);
        setCommitted(false);
    };

    const commit = () => {
        const resolved = resolvePageJump(displayed, totalPages);
        if (resolved === null || resolved === page) {
            revert();
            return;
        }
        setDraft(String(resolved));
        setCommitted(true);
        onPageChange(resolved);
    };

    return (
        <div className="px-2 @[480px]:px-3 text-secondary text-xs font-medium min-w-[48px] @[480px]:min-w-[80px] text-center py-1 whitespace-nowrap">
            {parts?.before ? <span>{parts.before}</span> : null}
            <input
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                type="text"
                inputMode="numeric"
                enterKeyHint="go"
                aria-label={t('pagination.pageNumber')}
                title={t('pagination.pageNumber')}
                disabled={disabled}
                value={displayed}
                style={{width: `${Math.min(Math.max(displayed.length, 1), 8)}ch`}}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                    setCommitted(false);
                    setDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        revert();
                    }
                }}
                onBlur={(event) => {
                    // Disabling the field blurs it while a jump is in flight.
                    if (event.currentTarget.disabled) return;
                    revert();
                }}
                className="inline-block align-middle bg-transparent p-0 m-0 border-none text-center text-xs font-medium tabular-nums text-secondary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-30"
            />
            {parts?.after ? <span>{parts.after}</span> : null}
        </div>
    );
}
