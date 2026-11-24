import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {TriangleAlert, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {SqlPreview} from '@/components/ui/SqlPreview';
import {useSettings} from '@/hooks/useSettings';
import {
    ProductionGuardContext,
    snoozedConnectionIds,
    type GuardRequest,
} from '@/hooks/useProductionGuard';

/**
 * Provider side of the production write guard: renders the confirmation
 * dialog requested by `useProductionGuard` (see hooks/useProductionGuard).
 */

interface PendingPrompt {
    connectionName: string;
    sql?: string;
    connectionId: string;
    resolve: (ok: boolean) => void;
}

export function ProductionGuardProvider({children}: {children: ReactNode}) {
    const {t} = useTranslation();
    const {settings} = useSettings();
    const queueRef = useRef<PendingPrompt[]>([]);
    const [pending, setPending] = useState<PendingPrompt | null>(null);
    const [snooze, setSnooze] = useState(false);
    const [remaining, setRemaining] = useState(0);

    const show = useCallback(
        (prompt: PendingPrompt | null) => {
            setSnooze(false);
            setRemaining(prompt && settings.safetyConfirmationDelayEnabled ? 5 : 0);
            setPending(prompt);
        },
        [settings.safetyConfirmationDelayEnabled],
    );

    // One dialog. A second write asked for while it is open waits, instead of
    // replacing the first resolver and leaving that caller pending forever.
    const request = useCallback<GuardRequest>(
        (connectionId, connectionName, sql) => {
            return new Promise<boolean>((resolve) => {
                const prompt = {connectionId, connectionName, sql, resolve};
                queueRef.current.push(prompt);
                if (queueRef.current.length === 1) show(prompt);
            });
        },
        [show],
    );

    useEffect(() => {
        if (!pending || remaining <= 0) return;
        const timeout = setTimeout(() => {
            setRemaining((previous) => Math.max(0, previous - 1));
        }, 1000);
        return () => clearTimeout(timeout);
    }, [pending, remaining]);

    const finish = (ok: boolean) => {
        const current = queueRef.current.shift();
        if (!current) return;
        if (ok && snooze && current.connectionId) {
            snoozedConnectionIds.add(current.connectionId);
        }
        current.resolve(ok);
        // "Don't ask again" covers prompts for this connection that are already waiting,
        // including one queued behind a different connection.
        const waiting = queueRef.current.filter((prompt) => {
            if (!snoozedConnectionIds.has(prompt.connectionId)) return true;
            prompt.resolve(true);
            return false;
        });
        queueRef.current = waiting;
        show(waiting[0] ?? null);
    };

    return (
        <ProductionGuardContext.Provider value={request}>
            {children}
            <Modal
                isOpen={pending !== null}
                onClose={() => finish(false)}
                overlayClassName="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] backdrop-blur-sm"
            >
                <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-accent-error/15 rounded-lg">
                                <TriangleAlert size={20} className="text-accent-error" />
                            </div>
                            <h2 className="text-lg font-semibold text-primary">
                                {t('environment.warnTitle')}
                            </h2>
                        </div>
                        <button
                            onClick={() => finish(false)}
                            className="text-secondary hover:text-primary transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-6 space-y-4">
                        <p className="text-sm text-secondary leading-relaxed">
                            {t('environment.warnMessage', {
                                name: pending?.connectionName ?? '',
                            })}
                        </p>
                        {pending?.sql && <SqlPreview sql={pending.sql} height="120px" />}
                        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none w-fit">
                            <input
                                type="checkbox"
                                checked={snooze}
                                onChange={(e) => setSnooze(e.target.checked)}
                            />
                            {t('environment.warnSnooze')}
                        </label>
                    </div>

                    <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                        <button
                            onClick={() => finish(false)}
                            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            onClick={() => finish(true)}
                            disabled={remaining > 0}
                            className="px-4 py-2 bg-accent-error hover:bg-accent-error/90 text-on-accent-error rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {remaining > 0
                                ? `${t('environment.warnConfirm')} (${remaining})`
                                : t('environment.warnConfirm')}
                        </button>
                    </div>
                </div>
            </Modal>
        </ProductionGuardContext.Provider>
    );
}
