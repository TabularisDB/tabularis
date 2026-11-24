import {Download} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useUpdate} from '@/hooks/useUpdate';

export function AvailableUpdateButton() {
    const {availableUpdate, showAvailableUpdate} = useUpdate();
    const {t} = useTranslation();
    if (!availableUpdate) return null;

    const label = t('update.updateAvailable', {version: availableUpdate.latestVersion});
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-haspopup="dialog"
            onClick={showAvailableUpdate}
            className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg text-accent transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
            <Download size={24} aria-hidden="true" />
        </button>
    );
}
