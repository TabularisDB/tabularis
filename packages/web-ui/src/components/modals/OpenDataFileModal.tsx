import {useId} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, Download, FileSpreadsheet, Loader2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import type {OpenDataFileStage} from '@/hooks/useOpenDataFile';

interface OpenDataFileModalProps {
    isOpen: boolean;
    onClose: () => void;
    stage: Exclude<OpenDataFileStage, {kind: 'idle'}>;
    /** Display name of the plugin offered when no driver opens the files. */
    pluginName: string;
    onInstall: () => void;
}

/**
 * Follows a data file through opening: the offer to install the plugin that
 * reads it, the install itself, the open (an upload in the browser) and any
 * failure along the way.
 */
export const OpenDataFileModal = ({
    isOpen,
    onClose,
    stage,
    pluginName,
    onInstall,
}: OpenDataFileModalProps) => {
    const {t} = useTranslation();
    const titleId = useId();
    const messageId = useId();
    const busy = stage.kind === 'installing' || stage.kind === 'opening';
    const offersInstall =
        stage.kind === 'plugin-required' || (stage.kind === 'error' && stage.retryInstall === true);

    const message = {
        'plugin-required': t('dataFiles.pluginRequired', {plugin: pluginName}),
        installing: t('dataFiles.installing', {plugin: pluginName}),
        opening: t('dataFiles.opening'),
        error: t('dataFiles.failed'),
    }[stage.kind];

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
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[520px] max-h-[90vh] overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/15 rounded-lg">
                            <FileSpreadsheet size={20} className="text-accent" aria-hidden="true" />
                        </div>
                        <div>
                            <h2 id={titleId} className="text-lg font-semibold text-primary">
                                {t('dataFiles.open')}
                            </h2>
                            <p className="text-xs text-secondary">{t('dataFiles.subtitle')}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label={t('common.close')}
                        className="text-secondary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    <ul className="space-y-2" aria-label={t('dataFiles.files')}>
                        {stage.files.map((file, index) => (
                            <li
                                key={`${file.name}-${index}`}
                                className="flex items-center gap-3 bg-base px-3 py-2 rounded-lg border border-default"
                            >
                                <FileSpreadsheet
                                    size={16}
                                    className="text-muted shrink-0"
                                    aria-hidden="true"
                                />
                                <span className="text-sm text-primary font-mono truncate">
                                    {file.name}
                                </span>
                            </li>
                        ))}
                    </ul>

                    <div
                        id={messageId}
                        role={stage.kind === 'error' ? 'alert' : 'status'}
                        className="flex items-start gap-3 text-sm text-secondary leading-relaxed"
                    >
                        {busy && (
                            <Loader2
                                size={16}
                                className="animate-spin text-accent shrink-0 mt-0.5"
                                aria-hidden="true"
                            />
                        )}
                        {stage.kind === 'error' && (
                            <AlertTriangle
                                size={16}
                                className="text-accent-error shrink-0 mt-0.5"
                                aria-hidden="true"
                            />
                        )}
                        <div className="min-w-0 space-y-1">
                            <p>{message}</p>
                            {stage.kind === 'error' && (
                                <p className="text-accent-error break-words">{stage.message}</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {offersInstall ? t('common.cancel') : t('common.close')}
                    </button>
                    {offersInstall && (
                        <button
                            type="button"
                            onClick={onInstall}
                            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                        >
                            <Download size={16} aria-hidden="true" />
                            {t('dataFiles.installAndOpen')}
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    );
};
