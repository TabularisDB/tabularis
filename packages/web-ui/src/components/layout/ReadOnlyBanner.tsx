import {LockKeyhole} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useDatabase} from '@/hooks/useDatabase';

export function ReadOnlyBanner() {
    const {t} = useTranslation();
    const {activeConnectionId, connections} = useDatabase();
    const connection = connections.find((entry) => entry.id === activeConnectionId);
    if (!connection?.params.read_only) return null;
    return (
        <div
            role="status"
            className="flex items-center justify-center gap-1.5 px-3 py-1 bg-accent-warning/15 border-b border-accent-warning/30 text-accent-warning text-xs shrink-0"
        >
            <LockKeyhole size={12} aria-hidden="true" />
            {t('readOnly.banner', {name: connection.name})}
        </div>
    );
}
