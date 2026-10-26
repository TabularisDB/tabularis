import {useTranslation} from 'react-i18next';
import clsx from 'clsx';
import {ChartColumn, Table2} from 'lucide-react';
import type {ResultView} from '@/utils/resultChart';

interface ResultViewToggleProps {
    view: ResultView;
    onChange: (view: ResultView) => void;
    className?: string;
}

const OPTIONS: {view: ResultView; icon: typeof Table2; labelKey: string}[] = [
    {view: 'grid', icon: Table2, labelKey: 'editor.resultChart.viewGrid'},
    {
        view: 'chart',
        icon: ChartColumn,
        labelKey: 'editor.resultChart.viewChart',
    },
];

/** Segmented Grid | Chart switch shown in a result status bar. */
export function ResultViewToggle({view, onChange, className}: ResultViewToggleProps) {
    const {t} = useTranslation();
    return (
        <div
            role="group"
            aria-label={t('editor.resultChart.viewLabel')}
            className={clsx(
                'flex items-center bg-surface-secondary rounded border border-strong shrink-0 overflow-hidden',
                className,
            )}
        >
            {OPTIONS.map(({view: option, icon: Icon, labelKey}, i) => {
                const active = view === option;
                const label = t(labelKey);
                return (
                    <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        aria-label={label}
                        title={label}
                        onClick={() => onChange(option)}
                        className={clsx(
                            'flex items-center gap-1 px-1.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                            i > 0 && 'border-l border-strong',
                            active
                                ? 'bg-accent-primary/15 text-accent'
                                : 'text-secondary hover:text-primary hover:bg-surface-tertiary',
                        )}
                    >
                        <Icon size={13} aria-hidden="true" />
                        <span className="hidden @[560px]:inline">{label}</span>
                    </button>
                );
            })}
        </div>
    );
}
