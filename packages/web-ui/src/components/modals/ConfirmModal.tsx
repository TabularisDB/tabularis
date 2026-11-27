import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, Loader2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {SqlPreview} from '@/components/ui/SqlPreview';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    message: string;
    /** Optional SQL shown in a read-only preview below the message. */
    sql?: string;
    confirmLabel?: string;
    confirmClassName?: string;
    cancelLabel?: string;
    busy?: boolean;
    confirmDisabled?: boolean;
    children?: ReactNode;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
    /**
     * When set, the confirm button stays disabled for this many seconds after the
     * modal opens, showing a countdown. Gives the user a beat to actually read the
     * message before confirming a destructive action.
     */
    confirmDelaySeconds?: number;
    /** Forwarded to the underlying Modal, e.g. to raise z-index above another modal. */
    overlayClassName?: string;
    /**
     * Moves focus to this button when the modal opens, keeps Tab inside the
     * dialog while it is open, and returns focus to the previous element when it
     * closes. Without it, focus stays where it was.
     */
    initialFocus?: 'cancel' | 'confirm';
}

export const ConfirmModal = ({
    isOpen,
    onClose,
    title,
    message,
    sql,
    confirmLabel,
    confirmClassName,
    cancelLabel,
    busy = false,
    confirmDisabled = false,
    children,
    onConfirm,
    variant = 'danger',
    confirmDelaySeconds,
    overlayClassName,
    initialFocus,
}: ConfirmModalProps) => {
    const {t} = useTranslation();
    const titleId = useId();
    const messageId = useId();
    const [remaining, setRemaining] = useState(confirmDelaySeconds ?? 0);

    // Reset the countdown whenever the modal transitions to open — done during
    // render (React's recommended pattern) rather than in an effect.
    const [prevOpen, setPrevOpen] = useState(isOpen);
    if (isOpen !== prevOpen) {
        setPrevOpen(isOpen);
        setRemaining(isOpen ? (confirmDelaySeconds ?? 0) : 0);
    }

    useEffect(() => {
        if (!isOpen || !confirmDelaySeconds) return;
        const interval = setInterval(() => {
            setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
        }, 1000);
        return () => clearInterval(interval);
    }, [isOpen, confirmDelaySeconds]);

    const dialogRef = useRef<HTMLDivElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isOpen || !initialFocus) return;
        const previous = document.activeElement;
        const target = initialFocus === 'confirm' ? confirmRef.current : cancelRef.current;
        // A disabled confirm button (countdown, busy) can't take focus.
        (target && !target.disabled ? target : cancelRef.current)?.focus();

        const trapTab = (event: KeyboardEvent) => {
            const dialog = dialogRef.current;
            if (event.key !== 'Tab' || !dialog) return;
            const focusable = Array.from(
                dialog.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
            );
            const first = focusable[0];
            const last = focusable.at(-1);
            if (!first || !last) return;
            const active = document.activeElement;
            if (!dialog.contains(active)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', trapTab, true);

        return () => {
            document.removeEventListener('keydown', trapTab, true);
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        };
    }, [isOpen, initialFocus]);

    const isCountingDown = remaining > 0;

    const variantStyles = {
        danger: {
            icon: <AlertTriangle size={20} className="text-accent-error" />,
            iconBg: 'bg-accent-error/15',
            button: 'bg-accent-error hover:bg-accent-error/90 text-on-accent-error',
        },
        warning: {
            icon: <AlertTriangle size={20} className="text-accent-warning" />,
            iconBg: 'bg-accent-warning/15',
            button: 'bg-accent-warning hover:bg-accent-warning/90 text-on-accent-warning',
        },
        info: {
            icon: <AlertTriangle size={20} className="text-accent" />,
            iconBg: 'bg-accent-primary/15',
            button: 'bg-accent-primary hover:bg-accent-primary/90 text-inverse',
        },
    };

    const currentVariant = variantStyles[variant];

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => {
                if (!busy) onClose();
            }}
            overlayClassName={overlayClassName}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={messageId}
                aria-busy={busy || undefined}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 ${currentVariant.iconBg} rounded-lg`}>
                            {currentVariant.icon}
                        </div>
                        <h2 id={titleId} className="text-lg font-semibold text-primary">
                            {title}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        aria-label={t('common.close')}
                        className="text-secondary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <p id={messageId} className="text-sm text-secondary leading-relaxed">
                        {message}
                    </p>
                    {sql && <SqlPreview sql={sql} height="120px" />}
                    {children}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                    <button
                        ref={cancelRef}
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {cancelLabel ?? t('common.cancel')}
                    </button>
                    <button
                        ref={confirmRef}
                        onClick={onConfirm}
                        disabled={isCountingDown || busy || confirmDisabled}
                        aria-busy={busy || undefined}
                        className={`${
                            confirmClassName ??
                            `px-4 py-2 ${currentVariant.button} rounded-lg text-sm font-medium transition-colors`
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {busy && (
                            <Loader2
                                size={14}
                                className="inline-block mr-2 animate-spin"
                                aria-hidden="true"
                            />
                        )}
                        {isCountingDown
                            ? `${confirmLabel ?? (variant === 'danger' ? t('common.delete') : t('common.ok'))} (${remaining})`
                            : (confirmLabel ??
                              (variant === 'danger' ? t('common.delete') : t('common.ok')))}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
