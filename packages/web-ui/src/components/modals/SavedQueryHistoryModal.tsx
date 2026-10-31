import {useEffect, useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {History, Loader2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {CellDiffEditor} from '@/components/ui/CellDiffEditor';
import type {SavedQuery, SavedQueryVersion} from '@/contexts/SavedQueriesContext';
import {toErrorMessage} from '@/utils/errors';

interface SavedQueryHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    query: SavedQuery | null;
    /** Previous versions of the query, newest first. */
    loadVersions: (queryId: string) => Promise<SavedQueryVersion[]>;
    onRestore: (queryId: string, versionId: string) => Promise<void>;
}

interface HistoryPanelProps extends Omit<SavedQueryHistoryModalProps, 'isOpen' | 'query'> {
    query: SavedQuery;
}

const formatSavedAt = (savedAt: string | null, fallback: string) =>
    savedAt ? new Date(savedAt).toLocaleString() : fallback;

// The panel only exists while the modal is open, so it loads the versions
// afresh on every open.
const HistoryPanel = ({onClose, query, loadVersions, onRestore}: HistoryPanelProps) => {
    const {t} = useTranslation();
    const titleId = useId();
    const [versions, setVersions] = useState<SavedQueryVersion[] | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        loadVersions(query.id)
            .then((result) => {
                if (cancelled) return;
                setVersions(result);
                setSelectedId(result[0]?.id ?? null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setVersions([]);
                setError(toErrorMessage(err));
            });
        return () => {
            cancelled = true;
        };
    }, [loadVersions, query.id]);

    const selected = versions?.find((version) => version.id === selectedId) ?? null;

    const handleRestore = async () => {
        if (!selected) return;
        setBusy(true);
        try {
            await onRestore(query.id, selected.id);
            onClose();
        } catch (err) {
            setError(toErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-elevated border border-strong rounded-xl shadow-2xl w-[960px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
        >
            <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-accent-primary/15 rounded-lg shrink-0">
                        <History size={20} className="text-accent" />
                    </div>
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-lg font-semibold text-primary truncate">
                            {t('sidebar.versionHistoryTitle', {name: query.name})}
                        </h2>
                        <p className="text-xs text-secondary">
                            {t('sidebar.versionHistorySubtitle')}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('common.close')}
                    className="text-secondary hover:text-primary transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="p-6 overflow-hidden flex gap-4 min-h-[420px]">
                {versions === null ? (
                    <div className="flex-1 flex items-center justify-center text-secondary">
                        <Loader2 size={20} className="animate-spin" aria-hidden="true" />
                        <span className="sr-only">{t('common.loading')}</span>
                    </div>
                ) : versions.length === 0 ? (
                    <p className="flex-1 text-sm text-muted">
                        {error ? '' : t('sidebar.versionHistoryEmpty')}
                    </p>
                ) : (
                    <>
                        <ul
                            aria-label={t('sidebar.versionHistoryList')}
                            className="w-56 shrink-0 overflow-y-auto space-y-1"
                        >
                            {versions.map((version) => (
                                <li key={version.id}>
                                    <button
                                        type="button"
                                        aria-pressed={version.id === selectedId}
                                        onClick={() => {
                                            setSelectedId(version.id);
                                            setError('');
                                        }}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                                            version.id === selectedId
                                                ? 'bg-accent-primary/15 text-primary'
                                                : 'text-secondary hover:text-primary hover:bg-surface-secondary'
                                        }`}
                                    >
                                        <span className="block truncate">
                                            {formatSavedAt(
                                                version.saved_at,
                                                t('sidebar.versionHistoryUnknownDate'),
                                            )}
                                        </span>
                                        {version.name !== query.name && (
                                            <span className="block truncate text-xs text-muted">
                                                {version.name}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <div className="flex-1 min-w-0 flex flex-col gap-2">
                            <div className="flex justify-between text-xs uppercase font-bold text-muted">
                                <span>{t('sidebar.versionHistorySelected')}</span>
                                <span>{t('sidebar.versionHistoryCurrent')}</span>
                            </div>
                            <div className="flex-1 min-h-[360px] border border-default rounded-lg overflow-hidden">
                                {selected && (
                                    <CellDiffEditor
                                        original={selected.sql}
                                        modified={query.sql}
                                        readOnly
                                        renderSideBySide
                                        language="sql"
                                    />
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {error && (
                <div role="alert" className="px-6 pb-4 text-accent-error text-xs">
                    {error}
                </div>
            )}

            <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                    {t('common.close')}
                </button>
                <button
                    type="button"
                    onClick={handleRestore}
                    disabled={busy || !selected}
                    className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                    {t('sidebar.restoreVersion')}
                </button>
            </div>
        </div>
    );
};

export const SavedQueryHistoryModal = ({isOpen, query, ...props}: SavedQueryHistoryModalProps) => (
    <Modal isOpen={isOpen && query !== null} onClose={props.onClose}>
        {query && <HistoryPanel key={query.id} query={query} {...props} />}
    </Modal>
);
