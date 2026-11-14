import {useTranslation} from 'react-i18next';
import {X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {CredentialProfilesManager} from '@/components/credentialProfiles/CredentialProfilesManager';

interface CredentialProfilesModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProfilesChanged?: () => void;
}

export function CredentialProfilesModal({
    isOpen,
    onClose,
    onProfilesChanged,
}: CredentialProfilesModalProps) {
    const {t} = useTranslation();

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] backdrop-blur-sm"
        >
            <div className="bg-base border border-strong rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-strong bg-elevated">
                    <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                        {t('credentialProfiles.title')}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-muted hover:text-primary transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                    <CredentialProfilesManager
                        confirmOverlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] backdrop-blur-sm"
                        onProfilesChanged={onProfilesChanged}
                    />
                </div>
            </div>
        </Modal>
    );
}
