import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
    AlertTriangle,
    CaseSensitive,
    ExternalLink,
    FileCode,
    Loader2,
    Search,
    X,
} from 'lucide-react';
import {ThemeDialog} from '@/components/ui/ThemeDialog';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {toErrorMessage} from '@/utils/errors';
import {readLinkedSqlFile} from '@/utils/linkedFolders';
import type {
    LinkedFolderSearchMatch,
    LinkedFolderSearchResult,
    LinkedFolderStatus,
} from '@/types/linkedFolders';

interface LinkedFolderSearchModalProps {
    folder: LinkedFolderStatus;
    onClose: () => void;
    onOpenFile: (folderId: string, relativePath: string) => void;
}

export function LinkedFolderSearchModal({
    folder,
    onClose,
    onOpenFile,
}: LinkedFolderSearchModalProps) {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const inputId = useId();

    const [query, setQuery] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [searchResult, setSearchResult] = useState<LinkedFolderSearchResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);

    const [previewContent, setPreviewContent] = useState<string | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);

    const searchRequestId = useRef(0);
    const previewRequestId = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const previewLineRef = useRef<HTMLDivElement>(null);

    const available = platform.supports('linkLocalFolders');

    const executeSearch = useCallback(
        async (searchQuery: string, isCaseSensitive: boolean) => {
            const trimmed = searchQuery.trim();
            if (!trimmed) {
                setSearchResult(null);
                setError(null);
                setIsSearching(false);
                setSelectedIndex(-1);
                setPreviewContent(null);
                return;
            }

            const reqId = ++searchRequestId.current;
            setIsSearching(true);
            setError(null);

            try {
                const res = await client.call('search_linked_folder', {
                    id: folder.id,
                    query: trimmed,
                    caseSensitive: isCaseSensitive,
                });
                if (searchRequestId.current !== reqId) return;
                setSearchResult(res);
                setSelectedIndex(res.matches.length > 0 ? 0 : -1);
            } catch (err) {
                if (searchRequestId.current !== reqId) return;
                setError(toErrorMessage(err));
                setSearchResult(null);
                setSelectedIndex(-1);
            } finally {
                if (searchRequestId.current === reqId) {
                    setIsSearching(false);
                }
            }
        },
        [client, folder.id],
    );

    useEffect(() => {
        const timer = setTimeout(() => {
            void executeSearch(query, caseSensitive);
        }, 250);
        return () => clearTimeout(timer);
    }, [query, caseSensitive, executeSearch]);

    const selectedMatch: LinkedFolderSearchMatch | undefined =
        selectedIndex >= 0 && searchResult ? searchResult.matches[selectedIndex] : undefined;

    useEffect(() => {
        if (!selectedMatch) {
            setPreviewContent(null);
            setPreviewError(null);
            return;
        }

        const reqId = ++previewRequestId.current;
        setIsLoadingPreview(true);
        setPreviewError(null);

        readLinkedSqlFile(client, folder.id, selectedMatch.relativePath)
            .then((file) => {
                if (previewRequestId.current !== reqId) return;
                setPreviewContent(file.content);
            })
            .catch((err) => {
                if (previewRequestId.current !== reqId) return;
                setPreviewError(toErrorMessage(err));
                setPreviewContent(null);
            })
            .finally(() => {
                if (previewRequestId.current === reqId) {
                    setIsLoadingPreview(false);
                }
            });
    }, [client, folder.id, selectedMatch]);

    useEffect(() => {
        if (previewLineRef.current) {
            previewLineRef.current.scrollIntoView({
                block: 'center',
                behavior: 'smooth',
            });
        }
    }, [previewContent, selectedMatch?.lineNumber]);

    const handleOpenCurrent = () => {
        if (!selectedMatch) return;
        onOpenFile(folder.id, selectedMatch.relativePath);
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!searchResult || searchResult.matches.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, searchResult.matches.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && selectedMatch) {
            e.preventDefault();
            handleOpenCurrent();
        }
    };

    const renderSnippet = (
        snippet: string,
        queryStr: string,
        isCaseSensitive: boolean,
        match?: LinkedFolderSearchMatch,
    ) => {
        if (!queryStr) return snippet;

        if (match && match.columnNumber > 0) {
            const chars = Array.from(snippet);
            const start = match.columnNumber - 1;
            const len = match.matchLength || queryStr.length;
            if (start < chars.length) {
                const before = chars.slice(0, start).join('');
                const matchedText = chars.slice(start, start + len).join('');
                const after = chars.slice(start + len).join('');
                return (
                    <>
                        {before}
                        <mark className="bg-accent-warning/30 text-primary font-semibold rounded px-0.5">
                            {matchedText}
                        </mark>
                        {after}
                    </>
                );
            }
        }

        const haystack = isCaseSensitive ? snippet : snippet.toLowerCase();
        const needle = isCaseSensitive ? queryStr : queryStr.toLowerCase();
        const index = haystack.indexOf(needle);
        if (index === -1) return snippet;

        const before = snippet.slice(0, index);
        const matchedText = snippet.slice(index, index + queryStr.length);
        const after = snippet.slice(index + queryStr.length);

        return (
            <>
                {before}
                <mark className="bg-accent-warning/30 text-primary font-semibold rounded px-0.5">
                    {matchedText}
                </mark>
                {after}
            </>
        );
    };

    const PREVIEW_WINDOW_RADIUS = 150;
    const allLines = previewContent ? previewContent.replace(/\r/g, '').split('\n') : [];
    const matchLineIdx = (selectedMatch?.lineNumber ?? 1) - 1;
    const startLineIdx = Math.max(0, matchLineIdx - PREVIEW_WINDOW_RADIUS);
    const endLineIdx = Math.min(allLines.length, matchLineIdx + PREVIEW_WINDOW_RADIUS + 1);
    const previewLines = allLines.slice(startLineIdx, endLineIdx);

    return (
        <ThemeDialog
            isOpen
            onClose={onClose}
            title={t('linkedFolderSearch.title', {name: folder.name})}
            subtitle={folder.path}
            icon={<Search size={20} className="text-accent" />}
            widthClass="w-[1000px] max-w-[95vw]"
        >
            <div className="flex flex-col h-[650px] max-h-[75vh]">
                {/* Search Bar */}
                <div className="flex items-center gap-2 pb-3 border-b border-default shrink-0">
                    <div className="relative flex-1 flex items-center">
                        <Search
                            size={16}
                            className="absolute left-3 text-muted pointer-events-none"
                            aria-hidden="true"
                        />
                        <input
                            ref={inputRef}
                            id={inputId}
                            type="text"
                            data-autofocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('linkedFolderSearch.inputPlaceholder')}
                            className="w-full pl-9 pr-8 py-1.5 bg-surface border border-default rounded-lg text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition-all"
                            aria-label={t('linkedFolderSearch.inputPlaceholder')}
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery('');
                                    inputRef.current?.focus();
                                }}
                                className="absolute right-2.5 p-0.5 text-muted hover:text-secondary rounded"
                                title={t('linkedFolderSearch.clearInput')}
                                aria-label={t('linkedFolderSearch.clearInput')}
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={() => setCaseSensitive((prev) => !prev)}
                        className={`p-1.5 rounded-lg border transition-colors flex items-center gap-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                            caseSensitive
                                ? 'bg-accent-primary/15 border-accent text-accent'
                                : 'border-default text-muted hover:text-secondary hover:bg-surface-secondary'
                        }`}
                        title={t('linkedFolderSearch.matchCase')}
                        aria-pressed={caseSensitive}
                        aria-label={t('linkedFolderSearch.matchCase')}
                    >
                        <CaseSensitive size={16} aria-hidden="true" />
                        <span className="hidden sm:inline font-mono">Aa</span>
                    </button>

                    {isSearching && (
                        <div className="flex items-center text-muted px-1" role="status">
                            <Loader2 size={16} className="animate-spin" />
                            <span className="sr-only">{t('common.loading')}</span>
                        </div>
                    )}
                </div>

                {/* Summary / Warnings Bar */}
                {searchResult && (
                    <div className="py-2 px-1 text-xs flex items-center justify-between gap-2 border-b border-default/50 text-muted shrink-0">
                        <div className="flex items-center gap-2">
                            <span>
                                {t('linkedFolderSearch.matchesSummary', {
                                    count: searchResult.matches.length,
                                    files: searchResult.filesSearched,
                                })}
                            </span>
                            {searchResult.filesSkipped > 0 && (
                                <span className="text-accent-warning">
                                    (
                                    {t('linkedFolderSearch.skippedFiles', {
                                        count: searchResult.filesSkipped,
                                    })}
                                    )
                                </span>
                            )}
                        </div>
                        {searchResult.truncated && (
                            <span className="flex items-center gap-1 text-accent-warning font-medium">
                                <AlertTriangle size={12} aria-hidden="true" />
                                {t('linkedFolderSearch.truncatedWarning')}
                            </span>
                        )}
                    </div>
                )}

                {/* Main Split Body */}
                <div className="flex flex-1 min-h-0 divide-x divide-default pt-2">
                    {/* Left Pane: Search Matches List */}
                    <div className="w-[380px] shrink-0 flex flex-col pr-2 overflow-y-auto">
                        {!available && (
                            <div className="p-4 text-center text-xs text-muted">
                                {t('linkedFolders.unavailableMessage')}
                            </div>
                        )}

                        {error && (
                            <div className="p-3 my-2 rounded-lg bg-accent-error/10 border border-accent-error/30 text-accent-error text-xs flex items-start gap-2">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        {!query.trim() && (
                            <div className="flex-1 flex flex-col items-center justify-center text-muted text-xs p-6 text-center">
                                <Search size={28} className="mb-2 opacity-40" />
                                <p>{t('linkedFolderSearch.typeToSearch')}</p>
                            </div>
                        )}

                        {query.trim() && !isSearching && searchResult?.matches.length === 0 && (
                            <div className="flex-1 flex flex-col items-center justify-center text-muted text-xs p-6 text-center">
                                <p className="font-medium text-secondary">
                                    {t('linkedFolderSearch.noMatchesTitle')}
                                </p>
                                <p className="mt-1">
                                    {t('linkedFolderSearch.noMatchesMessage', {
                                        query: query.trim(),
                                    })}
                                </p>
                            </div>
                        )}

                        {searchResult && searchResult.matches.length > 0 && (
                            <ul
                                className="space-y-1"
                                role="listbox"
                                aria-label={t('linkedFolderSearch.resultsListLabel')}
                            >
                                {searchResult.matches.map((match, idx) => {
                                    const isSelected = idx === selectedIndex;
                                    return (
                                        <li
                                            key={`${match.relativePath}:${match.lineNumber}:${match.columnNumber}`}
                                            role="presentation"
                                        >
                                            <button
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => setSelectedIndex(idx)}
                                                onDoubleClick={handleOpenCurrent}
                                                className={`w-full p-2 rounded-lg cursor-pointer transition-colors text-left border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                                                    isSelected
                                                        ? 'bg-surface-secondary border-accent-primary/40 shadow-sm'
                                                        : 'border-transparent hover:bg-surface-secondary/60 hover:border-default/50'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-1 text-[11px] mb-1">
                                                    <div className="flex items-center gap-1.5 truncate font-medium text-secondary">
                                                        <FileCode
                                                            size={12}
                                                            className="shrink-0 text-accent"
                                                        />
                                                        <span className="truncate">
                                                            {match.relativePath}
                                                        </span>
                                                    </div>
                                                    <span className="font-mono text-muted shrink-0 text-[10px] bg-base px-1.5 py-0.5 rounded border border-default/40">
                                                        {match.lineNumber}:{match.columnNumber}
                                                    </span>
                                                </div>
                                                <div className="font-mono text-xs text-primary truncate pl-4">
                                                    {renderSnippet(
                                                        match.lineContent,
                                                        query.trim(),
                                                        caseSensitive,
                                                    )}
                                                </div>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    {/* Right Pane: Read-only File Preview */}
                    <div className="flex-1 min-w-0 pl-3 flex flex-col">
                        {selectedMatch ? (
                            <div className="flex flex-col h-full">
                                {/* Preview Header & Open Button */}
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-default shrink-0">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1 text-xs text-secondary font-medium truncate">
                                            <span className="text-primary truncate">
                                                {selectedMatch.relativePath}
                                            </span>
                                            <span className="text-muted font-mono">
                                                :{selectedMatch.lineNumber}:
                                                {selectedMatch.columnNumber}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleOpenCurrent}
                                        className="flex items-center gap-1.5 px-3 py-1 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus shrink-0"
                                    >
                                        <ExternalLink size={12} aria-hidden="true" />
                                        <span>{t('linkedFolderSearch.openInEditor')}</span>
                                    </button>
                                </div>

                                {/* Preview Content Area */}
                                <div className="flex-1 min-h-0 bg-base rounded-lg border border-default p-2 overflow-auto font-mono text-xs">
                                    {isLoadingPreview && (
                                        <div className="flex items-center justify-center h-full text-muted gap-2">
                                            <Loader2 size={16} className="animate-spin" />
                                            <span>{t('common.loading')}</span>
                                        </div>
                                    )}

                                    {previewError && (
                                        <div className="p-4 text-center text-accent-error text-xs">
                                            {previewError}
                                        </div>
                                    )}

                                    {!isLoadingPreview &&
                                        !previewError &&
                                        previewLines.length > 0 && (
                                            <div className="space-y-0.5">
                                                {startLineIdx > 0 && (
                                                    <div className="text-muted text-center py-1 text-[11px] select-none italic">
                                                        ... {startLineIdx} lines omitted ...
                                                    </div>
                                                )}
                                                {previewLines.map((line, lIdx) => {
                                                    const currentLineNum = startLineIdx + lIdx + 1;
                                                    const isMatchedLine =
                                                        currentLineNum === selectedMatch.lineNumber;
                                                    return (
                                                        <div
                                                            key={currentLineNum}
                                                            ref={
                                                                isMatchedLine
                                                                    ? previewLineRef
                                                                    : null
                                                            }
                                                            className={`flex gap-3 px-2 py-0.5 rounded ${
                                                                isMatchedLine
                                                                    ? 'bg-accent-warning/20 border-l-2 border-accent-warning font-semibold text-primary'
                                                                    : 'text-secondary hover:bg-surface-secondary/40'
                                                            }`}
                                                        >
                                                            <span className="w-8 shrink-0 text-right text-muted select-none text-[10px]">
                                                                {currentLineNum}
                                                            </span>
                                                            <pre className="flex-1 whitespace-pre-wrap break-all font-mono">
                                                                {isMatchedLine
                                                                    ? renderSnippet(
                                                                          line,
                                                                          query.trim(),
                                                                          caseSensitive,
                                                                          selectedMatch,
                                                                      )
                                                                    : line || ' '}
                                                            </pre>
                                                        </div>
                                                    );
                                                })}
                                                {endLineIdx < allLines.length && (
                                                    <div className="text-muted text-center py-1 text-[11px] select-none italic">
                                                        ... {allLines.length - endLineIdx} lines
                                                        omitted ...
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-muted text-xs p-6 text-center">
                                <FileCode size={32} className="mb-2 opacity-30" />
                                <p>{t('linkedFolderSearch.selectToPreview')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ThemeDialog>
    );
}
