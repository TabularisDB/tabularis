import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ConfirmModal} from './ConfirmModal';
import {useTabularisClient} from '@/hooks/useTabularisClient';

interface DatabaseOperationModalProps {
    isOpen: boolean;
    onClose: () => void;
    connectionId: string;
    database: string;
    operation: 'empty' | 'truncate' | 'drop';
    onSuccess: () => Promise<void>;
}

export const DatabaseOperationModal = ({
    isOpen,
    onClose,
    connectionId,
    database,
    operation,
    onSuccess,
}: DatabaseOperationModalProps) => {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    if (!isOpen) return null;
    const execute = async () => {
        if (busy || confirmation !== database) return;
        setBusy(true);
        setError('');
        try {
            await client.call('database_operation', {
                connectionId,
                database,
                operation,
                confirmation,
            });
        } catch (cause) {
            setError(String(cause));
            setBusy(false);
            return;
        }
        // Refresh failure must never offer to repeat a completed destructive action.
        onClose();
        await onSuccess();
    };
    return (
        <ConfirmModal
            isOpen={isOpen}
            onClose={() => {
                if (!busy) onClose();
            }}
            title={t(`databaseOperations.${operation}`)}
            message={t(`databaseOperations.${operation}Description`, {database})}
            confirmLabel={t(`databaseOperations.${operation}`)}
            busy={busy}
            confirmDisabled={confirmation !== database}
            onConfirm={() => void execute()}
        >
            <p className="text-sm text-secondary">{t('databaseOperations.warning')}</p>
            <label className="block text-sm text-secondary">
                {t('databaseOperations.confirmName', {database})}
                <input
                    className="mt-2 w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                />
            </label>
            {error && (
                <p role="alert" className="text-sm text-accent-error">
                    {error}
                </p>
            )}
        </ConfirmModal>
    );
};
