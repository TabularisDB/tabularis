import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    FileCode,
    Folder,
    FolderOpen,
    FolderPlus,
    GitBranch,
    Loader2,
    RefreshCw,
    Search,
    X,
} from 'lucide-react';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {useAlert} from '@/hooks/useAlert';
import {choosePlatformServerPath} from '@/platform/dialogs';
import {toErrorMessage} from '@/utils/errors';
import {
    flattenLinkedTree,
    getLinkedFolderErrorKey,
    linkedDirectoryKey,
    type LinkedListingState,
} from '@/utils/linkedFolders';
import type {LinkedFolderStatus} from '@/types/linkedFolders';
import {LinkedFolderGitModal} from '@/components/modals/LinkedFolderGitModal';
import {LinkedFolderSearchModal} from '@/components/modals/LinkedFolderSearchModal';

interface LinkedFoldersSectionProps {
    /** Open linked files by `folderId:relativePath`; `dirty` marks unsaved edits. */
    openFiles: ReadonlyMap<string, {dirty: boolean}>;
    onOpenFile: (folderId: string, relativePath: string) => void;
}

const rowClassName =
    'w-full flex items-center gap-1.5 pr-2 py-1 text-left text-[13px] text-primary hover:bg-surface-secondary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const iconButtonClassName =
    'p-1.5 text-muted hover:text-secondary rounded transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function LinkedFoldersSection({openFiles, onOpenFile}: LinkedFoldersSectionProps) {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const {showAlert} = useAlert();
    const canLink = platform.supports('linkLocalFolders');
    const unavailableReason = platform.negotiation.capabilities.linkLocalFolders;

    const [folders, setFolders] = useState<LinkedFolderStatus[]>([]);
    const [gitFolder, setGitFolder] = useState<LinkedFolderStatus | null>(null);
    const [searchFolder, setSearchFolder] = useState<LinkedFolderStatus | null>(null);
    const [isLoading, setIsLoading] = useState(canLink);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [listings, setListings] = useState<Readonly<Record<string, LinkedListingState>>>({});
    // Responses for a directory that was refreshed meanwhile are dropped.
    const requestIds = useRef(new Map<string, number>());

    const errorText = useCallback(
        (error: unknown) => {
            const key = getLinkedFolderErrorKey(error);
            return key ? t(key) : toErrorMessage(error);
        },
        [t],
    );

    const loadDirectory = useCallback(
        async (folderId: string, relativePath: string) => {
            const key = linkedDirectoryKey(folderId, relativePath);
            const requestId = (requestIds.current.get(key) ?? 0) + 1;
            requestIds.current.set(key, requestId);
            let next: LinkedListingState;
            try {
                const listing = await client.call('list_linked_directory', {
                    id: folderId,
                    relativePath,
                });
                next = {status: 'ready', entries: listing.entries, truncated: listing.truncated};
            } catch (error) {
                next = {status: 'error', message: errorText(error)};
            }
            if (requestIds.current.get(key) !== requestId) return;
            setListings((current) => ({...current, [key]: next}));
        },
        [client, errorText],
    );

    const loadFolders = useCallback(async () => {
        if (!canLink) return [];
        try {
            const list = await client.call('list_linked_folders', undefined);
            setFolders(list);
            setLoadError(null);
            return list;
        } catch (error) {
            setFolders([]);
            setLoadError(errorText(error));
            return [];
        } finally {
            setIsLoading(false);
        }
    }, [canLink, client, errorText]);

    useEffect(() => {
        // Reopening the app re-reads the persisted links; directories load when expanded.
        void loadFolders();
    }, [loadFolders]);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        const list = await loadFolders();
        const available = new Set(list.filter((f) => f.available).map((f) => f.id));
        for (const key of expanded) {
            const separator = key.indexOf(':');
            const folderId = key.slice(0, separator);
            if (available.has(folderId)) void loadDirectory(folderId, key.slice(separator + 1));
        }
    }, [expanded, loadDirectory, loadFolders]);

    const toggleDirectory = (folderId: string, relativePath: string) => {
        const key = linkedDirectoryKey(folderId, relativePath);
        const opening = !expanded.has(key);
        setExpanded((current) => {
            const next = new Set(current);
            if (opening) next.add(key);
            else next.delete(key);
            return next;
        });
        // Re-list on every expand so externally added or removed files show up.
        if (opening) {
            setListings((current) => ({...current, [key]: {status: 'loading'}}));
            void loadDirectory(folderId, relativePath);
        }
    };

    const linkFolder = async () => {
        try {
            const path = await choosePlatformServerPath(platform, {
                directory: true,
                title: t('linkedFolders.chooseTitle'),
            });
            if (!path) return;
            const folder = await client.call('link_local_folder', {path});
            const list = await loadFolders();
            if (list.some((f) => f.id === folder.id)) {
                toggleDirectory(folder.id, '');
            }
        } catch (error) {
            showAlert(`${t('linkedFolders.linkError')}: ${errorText(error)}`, {
                title: t('common.error'),
                kind: 'error',
            });
        }
    };

    const unlinkFolder = async (folder: LinkedFolderStatus) => {
        try {
            await client.call('unlink_local_folder', {id: folder.id});
            setExpanded((current) => {
                const next = new Set(current);
                for (const key of current) if (key.startsWith(`${folder.id}:`)) next.delete(key);
                return next;
            });
            await loadFolders();
        } catch (error) {
            showAlert(`${t('linkedFolders.unlinkError')}: ${errorText(error)}`, {
                title: t('common.error'),
                kind: 'error',
            });
        }
    };

    const rows = useMemo(
        () => flattenLinkedTree(folders, expanded, listings),
        [folders, expanded, listings],
    );

    if (!canLink) {
        return (
            <div className="px-4 py-6 text-center text-xs text-muted" role="status">
                <p className="font-medium text-secondary">{t('linkedFolders.unavailableTitle')}</p>
                <p className="mt-1">
                    {t('linkedFolders.unavailableMessage')}
                    {!unavailableReason.supported ? ` (${unavailableReason.reason})` : ''}
                </p>
            </div>
        );
    }

    const indent = (depth: number) => ({paddingLeft: `${depth * 14 + 8}px`});

    return (
        <div className="animate-fade-in">
            <div className="px-2 pb-1.5 flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={linkFolder}
                    className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-1 text-xs text-secondary hover:text-primary bg-surface-secondary border border-default rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                    <FolderPlus size={12} aria-hidden="true" />
                    <span className="truncate">{t('linkedFolders.link')}</span>
                </button>
                <button
                    type="button"
                    onClick={() => void refresh()}
                    className={iconButtonClassName}
                    aria-label={t('linkedFolders.refresh')}
                    title={t('linkedFolders.refresh')}
                >
                    <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {loadError && (
                <div className="px-3 py-2 text-xs text-accent-error" role="alert">
                    {loadError}
                </div>
            )}

            {!isLoading && folders.length === 0 && !loadError && (
                <div className="text-center p-4 text-xs text-muted italic">
                    {t('linkedFolders.empty')}
                </div>
            )}

            <ul aria-label={t('linkedFolders.tab')}>
                {rows.map((row) => {
                    if (row.type === 'status') {
                        return (
                            <li
                                key={row.key}
                                style={indent(row.depth)}
                                className="py-1 pr-2 text-xs text-muted italic flex items-center gap-1.5"
                            >
                                {row.status === 'loading' && (
                                    <Loader2
                                        size={12}
                                        className="animate-spin"
                                        aria-hidden="true"
                                    />
                                )}
                                {row.status === 'error' ? (
                                    <span className="text-accent-error not-italic">
                                        {row.message}
                                    </span>
                                ) : (
                                    t(`linkedFolders.status.${row.status}`)
                                )}
                            </li>
                        );
                    }
                    if (row.type === 'file') {
                        const open = openFiles.get(row.key);
                        return (
                            <li key={row.key}>
                                <button
                                    type="button"
                                    onClick={() => onOpenFile(row.folderId, row.relativePath)}
                                    style={indent(row.depth)}
                                    className={rowClassName}
                                    title={row.relativePath}
                                    aria-label={
                                        open?.dirty
                                            ? t('linkedFolders.fileUnsaved', {name: row.name})
                                            : row.name
                                    }
                                >
                                    <FileCode
                                        size={12}
                                        className="text-accent shrink-0"
                                        aria-hidden="true"
                                    />
                                    <span className="truncate">{row.name}</span>
                                    {open && (
                                        <span
                                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                                open.dirty
                                                    ? 'bg-accent-warning'
                                                    : 'bg-accent-success'
                                            }`}
                                            aria-hidden="true"
                                        />
                                    )}
                                </button>
                            </li>
                        );
                    }
                    const isRoot = row.type === 'root';
                    const unavailable = isRoot && !row.available;
                    return (
                        <li key={row.key} className="flex items-center group">
                            <button
                                type="button"
                                onClick={() => toggleDirectory(row.folderId, row.relativePath)}
                                disabled={unavailable}
                                aria-expanded={row.expanded}
                                style={indent(row.depth)}
                                className={`${rowClassName} min-w-0 flex-1 ${isRoot ? 'font-medium' : ''} disabled:opacity-60`}
                                title={isRoot ? row.path : row.relativePath}
                            >
                                {row.expanded ? (
                                    <ChevronDown
                                        size={12}
                                        className="shrink-0"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <ChevronRight
                                        size={12}
                                        className="shrink-0"
                                        aria-hidden="true"
                                    />
                                )}
                                {unavailable ? (
                                    <AlertTriangle
                                        size={12}
                                        className="text-accent-warning shrink-0"
                                        aria-hidden="true"
                                    />
                                ) : row.expanded ? (
                                    <FolderOpen
                                        size={12}
                                        className="text-accent-warning shrink-0"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <Folder
                                        size={12}
                                        className="text-accent-warning shrink-0"
                                        aria-hidden="true"
                                    />
                                )}
                                <span className="truncate">{row.name}</span>
                                {unavailable && (
                                    <span className="text-[10px] text-accent-warning shrink-0">
                                        {t('linkedFolders.rootUnavailable')}
                                    </span>
                                )}
                            </button>
                            {isRoot && !unavailable && (
                                <>
                                    <button
                                        type="button"
                                        className={iconButtonClassName}
                                        aria-label={t('linkedFolderSearch.buttonLabel')}
                                        title={t('linkedFolderSearch.buttonLabel')}
                                        onClick={() =>
                                            setSearchFolder(
                                                folders.find(
                                                    (folder) => folder.id === row.folderId,
                                                ) ?? null,
                                            )
                                        }
                                    >
                                        <Search size={12} aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        className={iconButtonClassName}
                                        aria-label={t('linkedGit.title')}
                                        title={t('linkedGit.title')}
                                        onClick={() =>
                                            setGitFolder(
                                                folders.find(
                                                    (folder) => folder.id === row.folderId,
                                                ) ?? null,
                                            )
                                        }
                                    >
                                        <GitBranch size={12} aria-hidden="true" />
                                    </button>
                                </>
                            )}
                            {isRoot && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const folder = folders.find((f) => f.id === row.folderId);
                                        if (folder) void unlinkFolder(folder);
                                    }}
                                    className={`${iconButtonClassName} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
                                    aria-label={t('linkedFolders.unlink', {name: row.name})}
                                    title={t('linkedFolders.unlink', {name: row.name})}
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
            {gitFolder && (
                <LinkedFolderGitModal
                    key={gitFolder.id}
                    folder={gitFolder}
                    onClose={() => setGitFolder(null)}
                />
            )}
            {searchFolder && (
                <LinkedFolderSearchModal
                    key={searchFolder.id}
                    folder={searchFolder}
                    onClose={() => setSearchFolder(null)}
                    onOpenFile={onOpenFile}
                />
            )}
        </div>
    );
}
