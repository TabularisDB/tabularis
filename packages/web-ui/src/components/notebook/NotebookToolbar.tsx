import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
    Plus,
    Play,
    Download,
    Upload,
    Loader2,
    OctagonX,
    FileCode,
    FileText,
    FileDown,
    Database,
    ChevronsDownUp,
    ChevronsUpDown,
    ChevronDown,
    Undo2,
    Redo2,
    History,
    Eraser,
    Pencil,
    Presentation,
} from 'lucide-react';
import type {NotebookViewMode} from '@/types/notebook';
import {ContextMenu, type ContextMenuItem} from '@/components/ui/ContextMenu';

interface NotebookToolbarProps {
    onAddSqlCell: () => void;
    onAddMarkdownCell: () => void;
    onRunAll: () => void;
    onExport: () => void;
    onExportHtml: () => void;
    onExportSql: () => void;
    onExportMarkdown: () => void;
    onImport: () => void;
    isRunning: boolean;
    stopOnError: boolean;
    onToggleStopOnError: () => void;
    onCollapseAll: () => void;
    onExpandAll: () => void;
    onClearOutputs: () => void;
    canClearOutputs: boolean;
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onToggleHistory: () => void;
    historyOpen: boolean;
    viewMode?: NotebookViewMode;
    onViewModeChange?: (mode: NotebookViewMode) => void;
}

function ToolbarButton({
    onClick,
    disabled,
    title,
    children,
}: {
    onClick: (e: React.MouseEvent) => void;
    disabled?: boolean;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-secondary hover:text-primary hover:bg-surface-secondary rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
            {children}
        </button>
    );
}

function Separator() {
    return <div className="w-px h-5 bg-default mx-1 shrink-0" />;
}

function ToolbarGroup({children}: {children: React.ReactNode}) {
    return <div className="flex items-center gap-0.5 shrink-0">{children}</div>;
}

export function NotebookToolbar({
    onAddSqlCell,
    onAddMarkdownCell,
    onRunAll,
    onExport,
    onExportHtml,
    onExportSql,
    onExportMarkdown,
    onImport,
    isRunning,
    stopOnError,
    onToggleStopOnError,
    onCollapseAll,
    onExpandAll,
    onClearOutputs,
    canClearOutputs,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onToggleHistory,
    historyOpen,
    viewMode = 'edit',
    onViewModeChange,
}: NotebookToolbarProps) {
    const {t} = useTranslation();
    const isReportMode = viewMode === 'report';
    const [menu, setMenu] = useState<{
        x: number;
        y: number;
        items: ContextMenuItem[];
    } | null>(null);

    const openMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setMenu((prev) => (prev ? null : {x: rect.left, y: rect.bottom, items}));
    };

    const addItems: ContextMenuItem[] = [
        {label: t('editor.notebook.sqlCell'), icon: Database, action: onAddSqlCell},
        {
            label: t('editor.notebook.markdownCell'),
            icon: FileText,
            action: onAddMarkdownCell,
        },
    ];

    const exportItems: ContextMenuItem[] = [
        {label: t('editor.notebook.export'), icon: Download, action: onExport},
        {
            label: t('editor.notebook.exportHtml'),
            icon: FileCode,
            action: onExportHtml,
        },
        {
            label: t('editor.notebook.exportSql'),
            icon: FileDown,
            action: onExportSql,
        },
        {
            label: t('editor.notebook.exportMarkdown'),
            icon: FileText,
            action: onExportMarkdown,
        },
    ];

    return (
        <div className="@container h-10 bg-elevated border-b border-default flex items-center px-2 gap-0.5 shrink-0 overflow-x-auto">
            {!isReportMode && (
                <>
                    <button
                        type="button"
                        onClick={(e) => openMenu(e, addItems)}
                        title={t('editor.notebook.addCell')}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-primary hover:bg-surface-secondary rounded transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        <Plus size={14} />
                        <span className="hidden @[440px]:inline">
                            {t('editor.notebook.addCell')}
                        </span>
                        <ChevronDown size={12} className="text-muted" />
                    </button>

                    <Separator />

                    <ToolbarGroup>
                        <ToolbarButton
                            onClick={onUndo}
                            disabled={!canUndo}
                            title={t('editor.notebook.undo')}
                        >
                            <Undo2 size={14} />
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={onRedo}
                            disabled={!canRedo}
                            title={t('editor.notebook.redo')}
                        >
                            <Redo2 size={14} />
                        </ToolbarButton>
                        <button
                            type="button"
                            onClick={onToggleHistory}
                            title={t('editor.notebook.history.title')}
                            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                                historyOpen
                                    ? 'bg-surface-secondary text-primary'
                                    : 'text-secondary hover:text-primary hover:bg-surface-secondary'
                            }`}
                        >
                            <History size={14} />
                        </button>
                    </ToolbarGroup>

                    <Separator />
                </>
            )}

            <ToolbarGroup>
                <ToolbarButton
                    onClick={onRunAll}
                    disabled={isRunning}
                    title={t('editor.notebook.runAllTooltip')}
                >
                    {isRunning ? (
                        <Loader2 size={14} className="animate-spin" />
                    ) : (
                        <Play size={14} className="text-accent-success" />
                    )}
                    <span className="hidden @[440px]:inline">{t('editor.notebook.runAll')}</span>
                </ToolbarButton>

                {!isReportMode && (
                    <button
                        type="button"
                        onClick={onToggleStopOnError}
                        title={t('editor.notebook.stopOnErrorTooltip')}
                        className={`flex items-center gap-1 px-1.5 py-1 text-[10px] rounded transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                            stopOnError
                                ? 'bg-accent-error/15 text-accent-error font-semibold'
                                : 'text-muted hover:text-secondary hover:bg-surface-secondary'
                        }`}
                    >
                        <OctagonX size={12} />
                        <span className="hidden @[540px]:inline">
                            {t('editor.notebook.stopOnError')}
                        </span>
                    </button>
                )}
            </ToolbarGroup>

            {!isReportMode && (
                <>
                    <Separator />

                    <ToolbarGroup>
                        <ToolbarButton
                            onClick={onCollapseAll}
                            title={t('editor.notebook.collapseAll')}
                        >
                            <ChevronsDownUp size={14} />
                            <span className="hidden @[720px]:inline">
                                {t('editor.notebook.collapseAll')}
                            </span>
                        </ToolbarButton>
                        <ToolbarButton onClick={onExpandAll} title={t('editor.notebook.expandAll')}>
                            <ChevronsUpDown size={14} />
                            <span className="hidden @[720px]:inline">
                                {t('editor.notebook.expandAll')}
                            </span>
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={onClearOutputs}
                            disabled={!canClearOutputs}
                            title={t('editor.notebook.clearOutputs')}
                        >
                            <Eraser size={14} />
                            <span className="hidden @[720px]:inline">
                                {t('editor.notebook.clearOutputs')}
                            </span>
                        </ToolbarButton>
                    </ToolbarGroup>
                </>
            )}

            <div className="flex-1 min-w-2" />

            {onViewModeChange && (
                <>
                    <div
                        role="group"
                        aria-label={t('editor.notebook.viewMode')}
                        className="flex items-center bg-base border border-default rounded p-0.5 gap-0.5 shrink-0"
                    >
                        <button
                            type="button"
                            onClick={() => onViewModeChange('edit')}
                            aria-pressed={viewMode === 'edit'}
                            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                                viewMode === 'edit'
                                    ? 'bg-surface-secondary text-primary font-semibold'
                                    : 'text-muted hover:text-secondary'
                            }`}
                        >
                            <Pencil size={12} />
                            <span>{t('editor.notebook.editMode')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onViewModeChange('report')}
                            aria-pressed={viewMode === 'report'}
                            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                                viewMode === 'report'
                                    ? 'bg-accent-primary text-inverse font-semibold'
                                    : 'text-muted hover:text-secondary'
                            }`}
                        >
                            <Presentation size={12} />
                            <span>{t('editor.notebook.reportMode')}</span>
                        </button>
                    </div>
                    <Separator />
                </>
            )}

            <ToolbarGroup>
                <ToolbarButton
                    onClick={(e) => openMenu(e, exportItems)}
                    title={t('editor.notebook.export')}
                >
                    <Download size={14} />
                    <span className="hidden @[560px]:inline">{t('editor.notebook.export')}</span>
                    <ChevronDown size={12} className="text-muted" />
                </ToolbarButton>

                {!isReportMode && (
                    <ToolbarButton onClick={onImport} title={t('editor.notebook.import')}>
                        <Upload size={14} />
                        <span className="hidden @[640px]:inline">
                            {t('editor.notebook.import')}
                        </span>
                    </ToolbarButton>
                )}
            </ToolbarGroup>

            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={menu.items}
                    onClose={() => setMenu(null)}
                />
            )}
        </div>
    );
}
