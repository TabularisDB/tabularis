import {useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Folder, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import type {SavedQueryFolder} from '@/contexts/SavedQueriesContext';
import {
    MAX_FOLDER_NAME_CHARS,
    getFolderErrorMessage,
    getFolderNameError,
} from '@/utils/savedQueryFolders';

interface SavedQueryFolderModalProps {
    isOpen: boolean;
    onClose: () => void;
    folders: SavedQueryFolder[];
    /** The folder being renamed; omit to create a new one. */
    folder?: SavedQueryFolder | null;
    onSubmit: (name: string) => Promise<void>;
}

type FolderFormProps = Omit<SavedQueryFolderModalProps, 'isOpen'>;

// The form only exists while the modal is open, so its state starts fresh on
// every open and needs no reset effect.
const FolderForm = ({onClose, folders, folder = null, onSubmit}: FolderFormProps) => {
    const {t} = useTranslation();
    const titleId = useId();
    const nameId = useId();
    const errorId = useId();
    const [name, setName] = useState(folder?.name ?? '');
    const [touched, setTouched] = useState(false);
    const [serverError, setServerError] = useState('');
    const [busy, setBusy] = useState(false);

    const nameError = getFolderNameError(name, folders, folder?.id);
    const errorText =
        nameError === 'empty'
            ? t('sidebar.folderNameEmpty')
            : nameError === 'tooLong'
              ? t('sidebar.folderNameTooLong', {max: MAX_FOLDER_NAME_CHARS})
              : nameError === 'duplicate'
                ? t('sidebar.folderNameDuplicate')
                : '';
    const visibleError = serverError || (touched ? errorText : '');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setTouched(true);
        if (nameError) return;
        setBusy(true);
        try {
            await onSubmit(name.trim());
            onClose();
        } catch (err) {
            setServerError(getFolderErrorMessage(err, t));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col"
        >
            <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent-primary/15 rounded-lg">
                        <Folder size={20} className="text-accent" />
                    </div>
                    <div>
                        <h2 id={titleId} className="text-lg font-semibold text-primary">
                            {folder ? t('sidebar.renameFolder') : t('sidebar.newFolder')}
                        </h2>
                        <p className="text-xs text-secondary">
                            {folder
                                ? t('sidebar.renameFolderSubtitle')
                                : t('sidebar.newFolderSubtitle')}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('common.cancel')}
                    className="text-secondary hover:text-primary transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                    <X size={20} />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div>
                        <label
                            htmlFor={nameId}
                            className="block text-xs uppercase font-bold text-muted mb-2"
                        >
                            {t('sidebar.folderName')}
                        </label>
                        <input
                            id={nameId}
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            type="text"
                            autoFocus
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setServerError('');
                            }}
                            onBlur={() => setTouched(true)}
                            placeholder={t('sidebar.folderNamePlaceholder')}
                            aria-invalid={visibleError ? true : undefined}
                            aria-describedby={visibleError ? errorId : undefined}
                            className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary placeholder:text-muted focus:border-focus focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                        />
                        {visibleError && (
                            <div
                                id={errorId}
                                role="alert"
                                className="text-accent-error text-xs mt-2"
                            >
                                {visibleError}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={busy}
                        className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                    >
                        {folder ? t('sidebar.renameFolderAction') : t('sidebar.createFolderAction')}
                    </button>
                </div>
            </form>
        </div>
    );
};

export const SavedQueryFolderModal = ({isOpen, ...props}: SavedQueryFolderModalProps) => (
    <Modal isOpen={isOpen} onClose={props.onClose}>
        <FolderForm key={props.folder?.id ?? 'new'} {...props} />
    </Modal>
);
