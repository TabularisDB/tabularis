import {useId} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, Loader2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import type {LinkedFileConflictKind} from '@/utils/linkedFolders';

interface LinkedFileConflictModalProps {
    isOpen: boolean;
    kind: LinkedFileConflictKind;
    fileName: string;
    busy?: boolean;
    onClose: () => void;
    /** Write the editor text over whatever is on disk (or recreate the file). */
    onOverwrite: () => void;
    /** Keep the disk version untouched and save the editor text elsewhere. */
    onSaveAs: () => void;
    /** Replace the editor text with the disk version. Unavailable when the file is gone. */
    onReload: () => void;
}

const buttonClassName =
    'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const LinkedFileConflictModal = ({
    isOpen,
    kind,
    fileName,
    busy = false,
    onClose,
    onOverwrite,
    onSaveAs,
    onReload,
}: LinkedFileConflictModalProps) => {
    const {t} = useTranslation();
    const titleId = useId();
    const messageId = useId();

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => {
                if (!busy) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={messageId}
                aria-busy={busy || undefined}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[520px] overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-warning/15 rounded-lg">
                            <AlertTriangle size={20} className="text-accent-warning" />
                        </div>
                        <h2 id={titleId} className="text-lg font-semibold text-primary">
                            {t(`linkedFolders.conflict.${kind}.title`)}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label={t('common.close')}
                        className="text-secondary hover:text-primary transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    <p id={messageId} className="text-sm text-secondary leading-relaxed">
                        {t(`linkedFolders.conflict.${kind}.message`, {name: fileName})}
                    </p>
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex flex-wrap justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className={`${buttonClassName} text-secondary hover:text-primary`}
                    >
                        {t('common.cancel')}
                    </button>
                    {kind === 'modified' && (
                        <button
                            type="button"
                            onClick={onReload}
                            disabled={busy}
                            className={`${buttonClassName} border border-default text-primary hover:bg-surface-secondary`}
                        >
                            {t('linkedFolders.conflict.reload')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onSaveAs}
                        disabled={busy}
                        className={`${buttonClassName} border border-default text-primary hover:bg-surface-secondary`}
                    >
                        {t('linkedFolders.conflict.saveAs')}
                    </button>
                    <button
                        type="button"
                        onClick={onOverwrite}
                        disabled={busy}
                        className={`${buttonClassName} bg-accent-warning hover:bg-accent-warning/90 text-on-accent-warning`}
                    >
                        {busy && (
                            <Loader2
                                size={14}
                                className="inline-block mr-2 animate-spin"
                                aria-hidden="true"
                            />
                        )}
                        {t(`linkedFolders.conflict.${kind}.overwrite`)}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
