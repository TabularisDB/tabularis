import {useId} from 'react';
import {useTranslation} from 'react-i18next';
import type {QueryResult} from '@/types/editor';
import type {CellKpiConfig} from '@/types/notebook';
import {KPI_MAX_DECIMALS, computeKpiState, normalizeKpiDecimals} from '@/utils/notebookKpi';

interface CellKpiProps {
    result: QueryResult | null;
    error?: string;
    config: CellKpiConfig;
    onConfigChange: (config: CellKpiConfig) => void;
}

const fieldLabelClass = 'text-[10px] text-muted uppercase font-semibold';
const inputClass =
    'text-[10px] bg-surface-secondary border border-strong rounded px-1 py-0.5 text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function CellKpi({result, error, config, onConfigChange}: CellKpiProps) {
    const {t, i18n} = useTranslation();
    const id = useId();
    const columns = result?.columns ?? [];
    const columnMissing = !columns.includes(config.column);
    const state = computeKpiState(result, error, config, i18n.language);
    const label = config.label?.trim() || config.column;

    const message = (() => {
        switch (state.kind) {
            case 'value':
                return null;
            case 'multipleRows':
                return t('editor.notebook.kpiState.multipleRows', {count: state.count});
            case 'missingColumn':
                return t('editor.notebook.kpiState.missingColumn', {column: state.column});
            case 'notNumeric':
                return t('editor.notebook.kpiState.notNumeric', {raw: state.raw});
            default:
                return t(`editor.notebook.kpiState.${state.kind}`);
        }
    })();

    return (
        <div className="border-t border-default">
            <div className="flex items-center gap-3 px-3 py-1.5 bg-elevated border-b border-default flex-wrap">
                <div className="flex items-center gap-1.5">
                    <label htmlFor={`${id}-column`} className={fieldLabelClass}>
                        {t('editor.notebook.kpiColumn')}
                    </label>
                    <select
                        id={`${id}-column`}
                        value={config.column}
                        onChange={(e) => onConfigChange({...config, column: e.target.value})}
                        className={inputClass}
                    >
                        {columnMissing && (
                            <option value={config.column}>
                                {t('editor.notebook.kpiMissingColumnOption', {
                                    column: config.column,
                                })}
                            </option>
                        )}
                        {columns.map((col) => (
                            <option key={col} value={col}>
                                {col}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-1.5">
                    <label htmlFor={`${id}-label`} className={fieldLabelClass}>
                        {t('editor.notebook.kpiLabel')}
                    </label>
                    <input
                        id={`${id}-label`}
                        type="text"
                        value={config.label ?? ''}
                        placeholder={config.column}
                        onChange={(e) => onConfigChange({...config, label: e.target.value})}
                        className={`${inputClass} w-32`}
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    <label htmlFor={`${id}-decimals`} className={fieldLabelClass}>
                        {t('editor.notebook.kpiDecimals')}
                    </label>
                    <input
                        id={`${id}-decimals`}
                        type="number"
                        min={0}
                        max={KPI_MAX_DECIMALS}
                        step={1}
                        value={config.decimals ?? ''}
                        placeholder={t('editor.notebook.kpiDecimalsAuto')}
                        onChange={(e) =>
                            onConfigChange({
                                ...config,
                                decimals:
                                    e.target.value === ''
                                        ? null
                                        : normalizeKpiDecimals(Number(e.target.value)),
                            })
                        }
                        className={`${inputClass} w-14`}
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    <label htmlFor={`${id}-prefix`} className={fieldLabelClass}>
                        {t('editor.notebook.kpiPrefix')}
                    </label>
                    <input
                        id={`${id}-prefix`}
                        type="text"
                        value={config.prefix ?? ''}
                        onChange={(e) => onConfigChange({...config, prefix: e.target.value})}
                        className={`${inputClass} w-14`}
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    <label htmlFor={`${id}-suffix`} className={fieldLabelClass}>
                        {t('editor.notebook.kpiSuffix')}
                    </label>
                    <input
                        id={`${id}-suffix`}
                        type="text"
                        value={config.suffix ?? ''}
                        onChange={(e) => onConfigChange({...config, suffix: e.target.value})}
                        className={`${inputClass} w-14`}
                    />
                </div>
            </div>
            <section aria-label={label} className="px-4 py-4">
                <p className="text-sm font-medium text-secondary">{label}</p>
                {state.kind === 'value' ? (
                    <p className="mt-1 text-4xl font-semibold text-primary tabular-nums break-all">
                        {state.text}
                    </p>
                ) : (
                    <p role="status" className="mt-1 text-sm text-muted">
                        {message}
                    </p>
                )}
            </section>
        </div>
    );
}
