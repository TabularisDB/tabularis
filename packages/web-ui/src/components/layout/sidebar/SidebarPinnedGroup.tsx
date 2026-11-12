import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Pin} from 'lucide-react';

/**
 * The pinned tables and views at the top of a schema or database. The items inside are
 * the regular sidebar items, so they open and get their context menu as usual.
 */
export const SidebarPinnedGroup = ({children}: {children: ReactNode}) => {
    const {t} = useTranslation();
    return (
        <div role="group" aria-label={t('sidebar.pinned')} className="flex flex-col mb-2">
            <div className="flex items-center gap-2 pl-2 pr-3 py-1 text-xs font-semibold text-muted uppercase tracking-wider select-none">
                <Pin size={13} className="shrink-0" />
                <span className="truncate">{t('sidebar.pinned')}</span>
            </div>
            {children}
        </div>
    );
};
