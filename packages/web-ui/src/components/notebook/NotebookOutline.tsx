import {useState, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {List, ChevronDown, Sparkles, Loader2, Search, X} from 'lucide-react';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import type {NotebookCell} from '@/types/notebook';
import {
    extractOutline,
    filterOutlineEntries,
    getUnnamedCellsWithContent,
} from '@/utils/notebookOutline';
import {useSettings} from '@/hooks/useSettings';

interface NotebookOutlineProps {
    cells: NotebookCell[];
    onScrollToCell: (cellId: string) => void;
    onCellNameGenerated?: (cellId: string, name: string) => void;
}

function OutlineAiButton({
    cells,
    onCellNameGenerated,
}: {
    cells: NotebookCell[];
    onCellNameGenerated: (cellId: string, name: string) => void;
}) {
    const {t} = useTranslation();
    const {settings} = useSettings();
    const client = useTabularisClient();
    const [isGenerating, setIsGenerating] = useState(false);

    const unnamed = getUnnamedCellsWithContent(cells);
    if (!settings.aiEnabled || !settings.aiProvider || unnamed.length === 0) return null;

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const provider = settings.aiProvider;
        if (isGenerating || !provider) return;
        setIsGenerating(true);
        try {
            for (const cell of unnamed) {
                try {
                    const name = await client.call('generate_cell_name', {
                        req: {
                            provider,
                            model: settings.aiModel || '',
                            query: cell.content,
                        },
                    });
                    onCellNameGenerated(cell.id, name.trim());
                } catch (e) {
                    console.error(`Failed to generate name for cell ${cell.id}:`, e);
                }
            }
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <span
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick(e as unknown as React.MouseEvent);
                }
            }}
            className="p-0.5 text-muted hover:text-accent-secondary transition-colors rounded"
            title={t('editor.notebook.aiGenerateOutlineNames')}
        >
            {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
        </span>
    );
}

function CellTypeBadge({cellType}: {cellType: 'sql' | 'markdown'}) {
    if (cellType === 'sql') {
        return <span className="text-accent-success mr-1">SQL</span>;
    }
    return <span className="text-accent mr-1">MD</span>;
}

export function NotebookOutline({
    cells,
    onScrollToCell,
    onCellNameGenerated,
}: NotebookOutlineProps) {
    const {t} = useTranslation();
    const entries = useMemo(() => extractOutline(cells), [cells]);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredEntries = useMemo(
        () => filterOutlineEntries(entries, searchQuery),
        [entries, searchQuery],
    );

    if (entries.length === 0) return null;

    return (
        <div className="mb-3 bg-base border border-default rounded-lg overflow-hidden">
            <button
                type="button"
                onClick={() => setIsCollapsed((v) => !v)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-elevated border-b border-default hover:bg-base/40 transition-colors"
            >
                <ChevronDown
                    size={12}
                    className={`text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                />
                <List size={12} className="text-muted" />
                <span className="text-[10px] font-semibold uppercase text-muted flex-1 text-left">
                    {t('editor.notebook.outline')}
                </span>
                {onCellNameGenerated && (
                    <OutlineAiButton cells={cells} onCellNameGenerated={onCellNameGenerated} />
                )}
            </button>
            {!isCollapsed && (
                <div className="px-3 py-2 space-y-2">
                    <div className="relative flex items-center">
                        <Search
                            size={11}
                            className="absolute left-2 text-muted pointer-events-none"
                        />
                        <input
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape' && searchQuery) {
                                    e.preventDefault();
                                    setSearchQuery('');
                                }
                            }}
                            placeholder={t('editor.notebook.filterOutline')}
                            aria-label={t('editor.notebook.filterOutline')}
                            className="w-full bg-surface-secondary text-xs text-secondary placeholder:text-muted rounded pl-6 pr-6 py-1 border border-default focus:outline-none focus:border-focus/50"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                aria-label={t('editor.notebook.clearOutlineFilter')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary p-0.5 rounded transition-colors"
                            >
                                <X size={11} />
                            </button>
                        )}
                    </div>
                    {filteredEntries.length === 0 ? (
                        <div className="py-2 text-center text-xs text-muted">
                            {t('editor.notebook.noOutlineMatches')}
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {filteredEntries.map((entry, i) => (
                                <button
                                    key={`${entry.cellId}-${entry.cellIndex}-${i}`}
                                    type="button"
                                    onClick={() => onScrollToCell(entry.cellId)}
                                    className="block w-full text-left text-xs text-secondary hover:text-primary transition-colors truncate"
                                    style={{paddingLeft: `${(entry.level - 1) * 12}px`}}
                                >
                                    <CellTypeBadge cellType={entry.cellType} />
                                    {entry.text}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
