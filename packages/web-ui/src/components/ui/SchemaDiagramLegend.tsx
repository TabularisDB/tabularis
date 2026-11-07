import {memo, useState, useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {Key, Link, Info, ChevronDown, ChevronUp} from 'lucide-react';
import clsx from 'clsx';
import {useEscapeKey} from '@/hooks/useEscapeKey';

export interface SchemaDiagramLegendProps {
    className?: string;
}

export const SchemaDiagramLegend = memo(({className}: SchemaDiagramLegendProps) => {
    const {t} = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const close = useCallback(() => setIsOpen(false), []);

    // Integrate with the application modal escape stack
    useEscapeKey(isOpen, close);

    return (
        <div
            className={clsx(
                'relative bg-elevated/95 backdrop-blur-sm border border-strong rounded-lg shadow-lg overflow-visible text-sm font-sans select-none',
                className,
            )}
            data-testid="schema-diagram-legend"
        >
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className="flex items-center gap-2 px-3 py-2 text-primary hover:bg-surface-secondary rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus transition-colors font-medium"
                aria-expanded={isOpen}
                aria-controls="schema-diagram-legend-content"
                title={t('erDiagram.legend', 'Legend')}
            >
                <Info size={16} className="text-secondary" />
                <span>{t('erDiagram.legend', 'Legend')}</span>
                {isOpen ? (
                    <ChevronUp size={14} className="text-secondary" />
                ) : (
                    <ChevronDown size={14} className="text-secondary" />
                )}
            </button>

            {isOpen && (
                <div
                    id="schema-diagram-legend-content"
                    className="absolute top-full left-0 mt-1 p-3 bg-elevated border border-strong rounded-lg shadow-xl flex flex-col gap-2.5 min-w-[260px] max-w-[300px] z-20"
                >
                    {/* Primary Key Item */}
                    <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 p-1 rounded bg-semantic-pk/10 shrink-0">
                            <Key size={12} className="text-semantic-pk" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-semantic-pk text-xs leading-tight">
                                {t('erDiagram.primaryKey', 'Primary Key')}
                            </span>
                            <span className="text-[11px] text-muted leading-tight mt-0.5">
                                {t(
                                    'erDiagram.primaryKeyDesc',
                                    'Unique column identifying rows in the table',
                                )}
                            </span>
                        </div>
                    </div>

                    {/* Foreign Key Item */}
                    <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 p-1 rounded bg-semantic-fk/10 shrink-0">
                            <Link size={12} className="text-semantic-fk" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-semantic-fk text-xs leading-tight">
                                {t('erDiagram.foreignKey', 'Foreign Key')}
                            </span>
                            <span className="text-[11px] text-muted leading-tight mt-0.5">
                                {t(
                                    'erDiagram.foreignKeyDesc',
                                    'References a primary or unique key in another table',
                                )}
                            </span>
                        </div>
                    </div>

                    {/* Relationship Connector */}
                    <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 p-1 rounded bg-surface-secondary shrink-0 flex items-center justify-center w-5 h-5">
                            <div className="w-3 h-0.5 bg-accent-primary rounded-full shadow-[0_0_4px_var(--accent-primary)]" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-primary text-xs leading-tight">
                                {t('erDiagram.relationship', 'Relationship')}
                            </span>
                            <span className="text-[11px] text-muted leading-tight mt-0.5">
                                {t(
                                    'erDiagram.relationshipDesc',
                                    'Foreign key reference connecting child and parent tables',
                                )}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});
