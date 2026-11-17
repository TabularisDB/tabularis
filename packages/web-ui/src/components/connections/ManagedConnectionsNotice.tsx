import {useTranslation} from 'react-i18next';
import {ShieldCheck} from 'lucide-react';

/** Explains why connection management is unavailable on a managed instance. */
export const ManagedConnectionsNotice = () => {
    const {t} = useTranslation();
    return (
        <div
            role="note"
            data-testid="managed-connections-notice"
            className="flex items-start gap-3 px-8 py-3 bg-elevated border-b border-default text-sm shrink-0"
        >
            <ShieldCheck size={16} className="mt-0.5 text-accent shrink-0" aria-hidden="true" />
            <div className="min-w-0">
                <p className="font-semibold text-primary">{t('managed.noticeTitle')}</p>
                <p className="text-secondary">{t('managed.notice')}</p>
            </div>
        </div>
    );
};
