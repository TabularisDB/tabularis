import {useCallback, useEffect, useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {GitCommitHorizontal, Loader2} from 'lucide-react';
import {ThemeDialog} from '@/components/ui/ThemeDialog';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {toErrorMessage} from '@/utils/errors';
import type {LinkedFolderStatus} from '@/types/linkedFolders';
import type {LinkedGitReview, LinkedGitStatus} from '@/types/linkedFolderGit';

const button =
    'px-3 py-2 rounded-lg text-sm border border-default text-secondary hover:text-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function LinkedFolderGitModal({
    folder,
    onClose,
}: {
    folder: LinkedFolderStatus;
    onClose: () => void;
}) {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const messageId = useId();
    const [status, setStatus] = useState<LinkedGitStatus | null>(null);
    const [reviews, setReviews] = useState<ReadonlyMap<string, LinkedGitReview>>(new Map());
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [active, setActive] = useState<LinkedGitReview | null>(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const available = platform.supports('linkLocalFolders');

    const load = useCallback(async () => {
        try {
            if (!available) throw new Error(t('linkedGit.desktopOnly'));
            const next = await client.call('linked_git_status', {id: folder.id});
            setStatus(next);
            setReviews(new Map());
            setSelected(new Set());
            setActive(null);
            setError(null);
        } catch (error) {
            setError(toErrorMessage(error));
        } finally {
            setBusy(false);
        }
    }, [available, client, folder.id, t]);

    useEffect(() => {
        if (available) void load();
    }, [available, load]);

    const review = async (path: string) => {
        setBusy(true);
        setError(null);
        try {
            const next = await client.call('linked_git_review', {
                id: folder.id,
                relativePath: path,
            });
            setReviews((current) => new Map(current).set(path, next));
            setActive(next);
        } catch (error) {
            setError(toErrorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    const commit = async () => {
        if (!message.trim() || selected.size === 0 || busy) return;
        const files = Array.from(selected).map((path) => ({path, token: reviews.get(path)!.token}));
        setBusy(true);
        setError(null);
        try {
            const committed = await client.call('linked_git_commit', {
                id: folder.id,
                files,
                message,
            });
            setResult(t('linkedGit.committed', {commit: committed.commit.slice(0, 12)}));
            setMessage('');
            await load();
            if (committed.warning) setError(committed.warning);
        } catch (error) {
            setError(toErrorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    return (
        <ThemeDialog
            isOpen
            onClose={onClose}
            busy={busy && available}
            title={t('linkedGit.title')}
            subtitle={folder.path}
            icon={<GitCommitHorizontal size={20} />}
            widthClass="w-[900px] max-w-[95vw]"
            footer={
                <>
                    <button
                        type="button"
                        className={button}
                        onClick={onClose}
                        disabled={busy && available}
                    >
                        {t('common.close')}
                    </button>
                    <button
                        type="button"
                        className={`${button} bg-accent-primary text-inverse`}
                        onClick={() => void commit()}
                        disabled={!available || busy || !message.trim() || selected.size === 0}
                    >
                        {busy && available && (
                            <Loader2
                                size={14}
                                className="inline animate-spin mr-2"
                                aria-hidden="true"
                            />
                        )}
                        {t('linkedGit.commit')}
                    </button>
                </>
            }
        >
            <p className="text-xs text-muted mb-3">{t('linkedGit.diskOnly')}</p>
            {!available && <p role="status">{t('linkedGit.desktopOnly')}</p>}
            {error && (
                <p role="alert" className="text-sm text-accent-error whitespace-pre-wrap mb-3">
                    {error}
                </p>
            )}
            {result && (
                <p role="status" className="text-sm text-accent-success mb-3">
                    {result}
                </p>
            )}
            {available && (
                <>
                    <div className="flex items-center gap-2 mb-3">
                        <p className="text-xs text-muted break-all flex-1">{status?.repository}</p>
                        <button
                            type="button"
                            className={button}
                            disabled={busy}
                            onClick={() => {
                                setBusy(true);
                                void load();
                            }}
                        >
                            {t('linkedGit.refresh')}
                        </button>
                    </div>
                    <p className="text-xs text-muted mb-2">{t('linkedGit.renames')}</p>
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(180px,1fr)_2fr] gap-3">
                        <div className="border border-default rounded-lg overflow-auto max-h-72">
                            {status?.files.length === 0 && (
                                <p className="p-3 text-sm text-muted">{t('linkedGit.empty')}</p>
                            )}
                            <ul aria-label={t('linkedGit.files')}>
                                {status?.files.map((file) => (
                                    <li
                                        key={file.path}
                                        className="flex items-center gap-2 p-2 border-b border-default"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.has(file.path)}
                                            disabled={busy || !reviews.has(file.path)}
                                            aria-label={t('linkedGit.include', {path: file.path})}
                                            onChange={(event) => {
                                                const checked = event.target.checked;
                                                setSelected((current) => {
                                                    const next = new Set(current);
                                                    if (checked) next.add(file.path);
                                                    else next.delete(file.path);
                                                    return next;
                                                });
                                            }}
                                        />
                                        <span className="font-mono text-xs text-muted whitespace-pre">
                                            {file.status}
                                        </span>
                                        <button
                                            type="button"
                                            className={`${button} min-w-0 flex-1 break-all text-left`}
                                            disabled={busy}
                                            aria-label={t('linkedGit.review', {path: file.path})}
                                            aria-pressed={active?.path === file.path}
                                            onClick={() => void review(file.path)}
                                        >
                                            {file.path}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <textarea
                            readOnly
                            rows={12}
                            wrap="off"
                            value={active?.diff ?? t('linkedGit.choose')}
                            aria-label={t('linkedGit.diff')}
                            className="border border-default rounded-lg p-3 overflow-auto max-h-72 text-xs font-mono text-primary bg-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        />
                    </div>
                    <label htmlFor={messageId} className="block text-sm text-primary mt-4 mb-1">
                        {t('linkedGit.message')}
                    </label>
                    <textarea
                        id={messageId}
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        maxLength={16384}
                        rows={2}
                        disabled={busy}
                        className="w-full rounded-lg p-2 bg-base border border-default text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    />
                </>
            )}
        </ThemeDialog>
    );
}
