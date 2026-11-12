import {useState, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {List, ChevronDown, Sparkles, Loader2, AlertCircle, CheckCircle2} from 'lucide-react';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import type {NotebookCell} from '@/types/notebook';
import {
    extractOutline,
    getUnnamedCellsWithContent,
    type SqlCellExecutionStatus,
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

function SqlStatusIndicator({status}: {status?: SqlCellExecutionStatus}) {
    const {t} = useTranslation();
    if (!status || status === 'idle') return null;

    if (status === 'running') {
        return (
            <span
                className="inline-flex items-center ml-auto pl-1 text-accent-warning shrink-0"
                title={t('editor.notebook.statusRunning')}
                aria-label={t('editor.notebook.statusRunning')}
            >
                <Loader2 size={11} className="animate-spin" />
            </span>
        );
    }

    if (status === 'failed') {
        return (
            <span
                className="inline-flex items-center ml-auto pl-1 text-accent-error shrink-0"
                title={t('editor.notebook.statusFailed')}
                aria-label={t('editor.notebook.statusFailed')}
            >
                <AlertCircle size={11} />
            </span>
        );
    }

    if (status === 'has_output') {
        return (
            <span
                className="inline-flex items-center ml-auto pl-1 text-accent-success shrink-0"
                title={t('editor.notebook.statusOutputAvailable')}
                aria-label={t('editor.notebook.statusOutputAvailable')}
            >
                <CheckCircle2 size={11} />
            </span>
        );
    }

    return null;
}

export function NotebookOutline({
    cells,
    onScrollToCell,
    onCellNameGenerated,
}: NotebookOutlineProps) {
    const {t} = useTranslation();
    const entries = useMemo(() => extractOutline(cells), [cells]);
    const [isCollapsed, setIsCollapsed] = useState(false);

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
                <div className="px-3 py-2 space-y-0.5">
                    {entries.map((entry, i) => (
                        <button
                            key={`${entry.cellId}-${i}`}
                            type="button"
                            onClick={() => onScrollToCell(entry.cellId)}
                            className="flex items-center w-full text-left text-xs text-secondary hover:text-primary transition-colors truncate"
                            style={{paddingLeft: `${(entry.level - 1) * 12}px`}}
                        >
                            <CellTypeBadge cellType={entry.cellType} />
                            <span className="truncate flex-1">{entry.text}</span>
                            {entry.cellType === 'sql' && (
                                <SqlStatusIndicator status={entry.status} />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
