import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle, Check, Copy} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {copyTextToClipboard} from '@/utils/clipboard';
import {computeAnchoredPopoverPosition} from '@/utils/anchoredPopover';

/** Preferred popover width (Tailwind `w-72`). */
const POPOVER_WIDTH = 288;

const FOCUS_RING =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

interface MetadataErrorIndicatorProps {
    error: string;
    title: string;
}

export const MetadataErrorIndicator = ({error, title}: MetadataErrorIndicatorProps) => {
    const {t} = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const popoverId = useId();
    const titleId = useId();

    const close = useCallback((restoreFocus: boolean) => {
        setIsOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    }, []);

    // The popover is portaled to <body> so the sidebar's overflow cannot clip
    // it; it is placed next to the trigger and kept inside the viewport. The
    // position is written straight to the node after measuring its real size.
    const reposition = useCallback(() => {
        const trigger = triggerRef.current;
        const popover = popoverRef.current;
        if (!trigger || !popover) return;
        const anchor = trigger.getBoundingClientRect();
        const viewport = {width: window.innerWidth, height: window.innerHeight};
        const {maxWidth, maxHeight} = computeAnchoredPopoverPosition(
            anchor,
            {width: POPOVER_WIDTH, height: 0},
            viewport,
        );
        popover.style.width = `${Math.min(POPOVER_WIDTH, maxWidth)}px`;
        popover.style.maxHeight = `${maxHeight}px`;
        const size = popover.getBoundingClientRect();
        const position = computeAnchoredPopoverPosition(
            anchor,
            {width: size.width, height: size.height},
            viewport,
        );
        popover.style.top = `${position.top}px`;
        popover.style.left = `${position.left}px`;
        popover.style.visibility = 'visible';
    }, []);

    // Re-measure when the content changes (the copy label switches).
    useLayoutEffect(() => {
        if (isOpen) reposition();
    }, [isOpen, isCopied, error, title, reposition]);

    // Move focus into the dialog when it opens so its controls are reachable
    // with Tab even though it is rendered at the end of the document.
    useLayoutEffect(() => {
        if (isOpen) popoverRef.current?.focus();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const outside = (event: MouseEvent) => {
            if (!(event.target instanceof Node)) return;
            if (popoverRef.current?.contains(event.target)) return;
            if (triggerRef.current?.contains(event.target)) return;
            close(false);
        };
        // The trigger moves with the sidebar: close instead of leaving the
        // popover detached from it.
        const scroll = (event: Event) => {
            if (event.target instanceof Node && popoverRef.current?.contains(event.target)) {
                return;
            }
            close(false);
        };
        // Escape closes and hands focus back to the trigger. Stopped here so the
        // sidebar or an enclosing modal does not also react.
        const dialog = popoverRef.current;
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            close(true);
        };
        // Tabbing out of the popover closes it, so focus never lands on a
        // detached panel at the end of the document.
        const focusOut = (event: FocusEvent) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node)) return;
            if (popoverRef.current?.contains(next)) return;
            if (triggerRef.current?.contains(next)) return;
            close(false);
        };
        dialog?.addEventListener('keydown', escape);
        dialog?.addEventListener('focusout', focusOut);
        document.addEventListener('mousedown', outside);
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', scroll, true);
        return () => {
            dialog?.removeEventListener('keydown', escape);
            dialog?.removeEventListener('focusout', focusOut);
            document.removeEventListener('mousedown', outside);
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', scroll, true);
        };
    }, [isOpen, close, reposition]);

    return (
        // The indicator lives inside clickable sidebar rows: clicks and keys on it
        // or on its (portaled, but still React-nested) popover must not reach the
        // row.
        <div
            role="presentation"
            className="relative"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <button
                ref={triggerRef}
                type="button"
                onClick={() => {
                    setIsOpen((current) => !current);
                    setIsCopied(false);
                }}
                className={`flex items-center rounded p-1 text-accent-error transition-colors hover:bg-accent-error/10 hover:text-accent-error ${FOCUS_RING}`}
                title={t('sidebar.errorDetails')}
                aria-label={t('sidebar.errorDetails')}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-controls={isOpen ? popoverId : undefined}
            >
                <AlertCircle size={14} />
            </button>

            {isOpen &&
                createPortal(
                    <div
                        ref={popoverRef}
                        id={popoverId}
                        role="dialog"
                        aria-labelledby={titleId}
                        tabIndex={-1}
                        style={{top: 0, left: 0, width: POPOVER_WIDTH, visibility: 'hidden'}}
                        className="fixed z-[200] flex flex-col overflow-y-auto rounded-md border border-strong bg-elevated p-3 text-left normal-case tracking-normal shadow-xl focus:outline-none"
                    >
                        <div
                            id={titleId}
                            className="mb-2 break-words text-xs font-semibold text-accent-error"
                        >
                            {title}
                        </div>
                        <pre className="max-h-40 min-h-0 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded bg-surface-secondary p-2 text-xs font-normal text-muted select-text [overflow-wrap:anywhere]">
                            {error}
                        </pre>
                        <button
                            type="button"
                            onClick={async () => {
                                await copyTextToClipboard(error);
                                setIsCopied(true);
                            }}
                            className={`mt-2 flex shrink-0 items-center gap-1.5 self-start rounded px-2 py-1 text-xs font-medium text-secondary transition-colors hover:bg-surface-secondary hover:text-primary ${FOCUS_RING}`}
                        >
                            {isCopied ? (
                                <Check size={12} className="text-accent-success" />
                            ) : (
                                <Copy size={12} />
                            )}
                            {isCopied ? t('common.copied') : t('common.copy')}
                        </button>
                    </div>,
                    document.body,
                )}
        </div>
    );
};
