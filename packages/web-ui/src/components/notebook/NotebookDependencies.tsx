import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, ChevronDown, GitBranch, PowerOff, RefreshCw} from 'lucide-react';
import type {NotebookCell, NotebookParam} from '@/types/notebook';
import type {DialectInput} from '@/utils/sqlSplitter';
import {
    inspectCellDependencies,
    type CellDependency,
    type CellIdentity,
} from '@/utils/notebookDependencies';

interface NotebookDependenciesProps {
    cells: NotebookCell[];
    params: NotebookParam[];
    dialect?: DialectInput;
    /** Expand the cell if collapsed and scroll to it. Must not execute it. */
    onRevealCell: (cellId: string) => void;
}

const LINK_CLASS =
    'text-left text-xs text-secondary hover:text-primary underline-offset-2 hover:underline rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function useCellLabel() {
    const {t} = useTranslation();
    return (cell: CellIdentity) =>
        cell.name
            ? t('editor.notebook.dependencies.namedCell', {
                  position: cell.cellIndex + 1,
                  name: cell.name,
              })
            : t('editor.notebook.dependencies.unnamedCell', {position: cell.cellIndex + 1});
}

function CellLink({
    cell,
    onRevealCell,
}: {
    cell: CellIdentity;
    onRevealCell: (cellId: string) => void;
}) {
    const label = useCellLabel();
    return (
        <button type="button" onClick={() => onRevealCell(cell.cellId)} className={LINK_CLASS}>
            {label(cell)}
        </button>
    );
}

function Diagnostic({children}: {children: React.ReactNode}) {
    return (
        <span className="inline-flex items-center gap-1 text-xs text-accent-warning">
            <AlertTriangle size={11} aria-hidden="true" className="shrink-0" />
            {children}
        </span>
    );
}

function Occurrences({count}: {count: number}) {
    const {t} = useTranslation();
    if (count < 2) return null;
    return (
        <span className="text-[10px] text-muted">
            {t('editor.notebook.dependencies.occurrences', {count})}
        </span>
    );
}

function UseEntry({
    dependency,
    onRevealCell,
}: {
    dependency: CellDependency;
    onRevealCell: (cellId: string) => void;
}) {
    const {t} = useTranslation();
    let content: React.ReactNode;
    if (dependency.kind === 'missing') {
        content = (
            <Diagnostic>
                {t('editor.notebook.dependencies.missingTarget', {position: dependency.position})}
            </Diagnostic>
        );
    } else if (dependency.kind === 'invalid') {
        content = (
            <>
                <CellLink cell={dependency.target} onRevealCell={onRevealCell} />
                <Diagnostic>
                    {dependency.reason === 'self'
                        ? t('editor.notebook.dependencies.selfReference')
                        : t('editor.notebook.dependencies.markdownTarget')}
                </Diagnostic>
            </>
        );
    } else {
        content = (
            <>
                <CellLink cell={dependency.target} onRevealCell={onRevealCell} />
                {dependency.disabled && (
                    <span
                        className="inline-flex items-center gap-1 text-[10px] text-muted"
                        title={t('editor.notebook.statusDisabled')}
                    >
                        <PowerOff size={10} aria-hidden="true" />
                        {t('editor.notebook.statusDisabled')}
                    </span>
                )}
            </>
        );
    }
    return (
        <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {content}
            <Occurrences count={dependency.occurrences} />
        </li>
    );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
    return (
        <section aria-label={title}>
            <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">{title}</h3>
            {children}
        </section>
    );
}

export function NotebookDependencies({
    cells,
    params,
    dialect,
    onRevealCell,
}: NotebookDependenciesProps) {
    const {t} = useTranslation();
    const label = useCellLabel();
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const sqlCells = useMemo(
        () =>
            cells.flatMap((cell, index) =>
                cell.type === 'sql'
                    ? [{cellId: cell.id, cellIndex: index, ...(cell.name ? {name: cell.name} : {})}]
                    : [],
            ),
        [cells],
    );
    // Fall back to the first SQL cell when the selection was deleted or never set.
    const currentId =
        sqlCells.find((c) => c.cellId === selectedId)?.cellId ?? sqlCells[0]?.cellId ?? null;
    const inspection = useMemo(
        () => (currentId ? inspectCellDependencies(cells, currentId, params, dialect) : null),
        [cells, currentId, params, dialect],
    );

    if (sqlCells.length === 0) return null;

    const isEmpty =
        inspection !== null &&
        inspection.uses.length === 0 &&
        inspection.params.length === 0 &&
        inspection.usedBy.length === 0;

    return (
        <div className="mb-3 bg-base border border-default rounded-lg overflow-hidden">
            <button
                type="button"
                onClick={() => setIsCollapsed((v) => !v)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-elevated border-b border-default hover:bg-base/40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
            >
                <ChevronDown
                    size={12}
                    aria-hidden="true"
                    className={`text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                />
                <GitBranch size={12} aria-hidden="true" className="text-muted" />
                <span className="text-[10px] font-semibold uppercase text-muted flex-1 text-left">
                    {t('editor.notebook.dependencies.title')}
                </span>
            </button>
            {!isCollapsed && inspection && (
                <div className="px-3 py-2 space-y-3">
                    <select
                        value={currentId ?? ''}
                        onChange={(e) => setSelectedId(e.target.value)}
                        aria-label={t('editor.notebook.dependencies.selectCell')}
                        className="w-full bg-surface-secondary text-xs text-secondary rounded px-2 py-1 border border-default focus:outline-none focus:border-focus/50"
                    >
                        {sqlCells.map((cell) => (
                            <option key={cell.cellId} value={cell.cellId}>
                                {label(cell)}
                            </option>
                        ))}
                    </select>

                    {inspection.cycle && (
                        <div
                            role="alert"
                            className="flex items-start gap-1.5 text-xs text-accent-error"
                        >
                            <RefreshCw size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
                            <span>
                                {t('editor.notebook.dependencies.cycle', {
                                    path: inspection.cycle.map(label).join(' → '),
                                })}
                            </span>
                        </div>
                    )}

                    {isEmpty ? (
                        <p className="text-xs text-muted">
                            {t('editor.notebook.dependencies.empty')}
                        </p>
                    ) : (
                        <>
                            <Section title={t('editor.notebook.dependencies.uses')}>
                                {inspection.uses.length === 0 ? (
                                    <p className="text-xs text-muted">
                                        {t('editor.notebook.dependencies.noUses')}
                                    </p>
                                ) : (
                                    <ul className="space-y-0.5">
                                        {inspection.uses.map((dependency) => (
                                            <UseEntry
                                                key={
                                                    dependency.kind === 'missing'
                                                        ? `missing-${dependency.position}`
                                                        : dependency.target.cellId
                                                }
                                                dependency={dependency}
                                                onRevealCell={onRevealCell}
                                            />
                                        ))}
                                    </ul>
                                )}
                            </Section>
                            <Section title={t('editor.notebook.dependencies.params')}>
                                {inspection.params.length === 0 ? (
                                    <p className="text-xs text-muted">
                                        {t('editor.notebook.dependencies.noParams')}
                                    </p>
                                ) : (
                                    <ul className="space-y-0.5">
                                        {inspection.params.map((param) => (
                                            <li
                                                key={param.name}
                                                className="flex flex-wrap items-center gap-x-2 text-xs"
                                            >
                                                <code className="font-mono text-secondary">
                                                    {param.name}
                                                </code>
                                                {!param.defined && (
                                                    <Diagnostic>
                                                        {t(
                                                            'editor.notebook.dependencies.undefinedParam',
                                                        )}
                                                    </Diagnostic>
                                                )}
                                                <Occurrences count={param.occurrences} />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Section>
                            <Section title={t('editor.notebook.dependencies.usedBy')}>
                                {inspection.usedBy.length === 0 ? (
                                    <p className="text-xs text-muted">
                                        {t('editor.notebook.dependencies.noUsedBy')}
                                    </p>
                                ) : (
                                    <ul className="space-y-0.5">
                                        {inspection.usedBy.map((cell) => (
                                            <li key={cell.cellId}>
                                                <CellLink cell={cell} onRevealCell={onRevealCell} />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Section>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
