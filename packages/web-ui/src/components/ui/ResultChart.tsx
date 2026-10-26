import {useId, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import clsx from 'clsx';
import {ChartColumn, ChartLine} from 'lucide-react';
import {useChartPalette} from '@/hooks/useChartPalette';
import {usePrefersReducedMotion} from '@/hooks/usePrefersReducedMotion';
import {ResultChartPlot, type ResultChartSeries} from './ResultChartPlot';
import {SeriesKey} from './SeriesKey';
import type {QueryResult} from '@/types/editor';
import {
    MAX_CHART_SERIES,
    RESULT_CHART_TYPES,
    buildTemporalFormatters,
    chartSeriesKey,
    classifyResultColumns,
    formatChartCount,
    getChartColumnLabels,
    getChartUnavailableReason,
    getResultChartScope,
    getSeriesDash,
    getSeriesSlots,
    reconcileResultChartConfig,
    setChartLabelColumn,
    shapeResultChartData,
    toggleChartValueColumn,
    type ResultChartConfig,
    type ResultChartType,
} from '@/utils/resultChart';

interface ResultChartProps {
    result: QueryResult;
    /** Stored config for this result; null means "use the defaults". */
    config: ResultChartConfig | null;
    onConfigChange: (config: ResultChartConfig) => void;
    /** Switches the panel back to the grid (offered from the empty states). */
    onShowGrid?: () => void;
    /** A refresh is running: keep the chart, dimmed, instead of blanking it. */
    isRefreshing?: boolean;
}

const FOCUS_RING =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const CHART_TYPES: Record<ResultChartType, {labelKey: string; icon: typeof ChartColumn}> = {
    bar: {labelKey: 'editor.resultChart.typeBar', icon: ChartColumn},
    line: {labelKey: 'editor.resultChart.typeLine', icon: ChartLine},
};

/** Bar/line chart of the loaded rows of a query result, with axis pickers. */
export function ResultChart({
    result,
    config,
    onConfigChange,
    onShowGrid,
    isRefreshing = false,
}: ResultChartProps) {
    const {t, i18n} = useTranslation();
    const locale = i18n?.language || 'en';
    const palette = useChartPalette();
    const reducedMotion = usePrefersReducedMotion();
    const xSelectId = useId();
    const yLabelId = useId();
    const captionId = useId();

    const unavailable = useMemo(() => getChartUnavailableReason(result), [result]);
    const effective = useMemo(() => reconcileResultChartConfig(config, result), [config, result]);
    const data = useMemo(
        () => (effective ? shapeResultChartData(result, effective) : []),
        [result, effective],
    );
    const labels = useMemo(() => getChartColumnLabels(result.columns), [result.columns]);
    const labelIsTemporal = useMemo(
        () => !!effective && classifyResultColumns(result)[effective.labelIndex] === 'temporal',
        [result, effective],
    );
    const temporal = useMemo(
        () =>
            labelIsTemporal
                ? buildTemporalFormatters(
                      data.map((d) => d.label),
                      locale,
                  )
                : null,
        [labelIsTemporal, data, locale],
    );
    const slots = useMemo(
        () =>
            effective ? getSeriesSlots(result, effective.labelIndex) : new Map<number, number>(),
        [result, effective],
    );

    if (unavailable || !effective) {
        const noRows = unavailable === 'noRows';
        return (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <ChartColumn size={28} aria-hidden="true" className="text-muted" />
                <p className="text-sm font-medium text-secondary">
                    {noRows
                        ? t('editor.resultChart.emptyNoRowsTitle')
                        : t('editor.resultChart.emptyNoNumericTitle')}
                </p>
                {!noRows && (
                    <p className="text-xs text-muted max-w-sm">
                        {t('editor.resultChart.emptyNoNumericHint')}
                    </p>
                )}
                {onShowGrid && (
                    <button
                        type="button"
                        onClick={onShowGrid}
                        className={clsx(
                            'mt-1 px-2.5 py-1 text-xs rounded border border-strong text-secondary hover:text-primary hover:bg-surface-secondary transition-colors',
                            FOCUS_RING,
                        )}
                    >
                        {t('editor.resultChart.showGrid')}
                    </button>
                )}
            </div>
        );
    }

    const scope = getResultChartScope(result);
    // Passed as strings: these keys have no plural forms, so i18next uses them as written.
    const plotted = formatChartCount(scope.plotted, locale);
    const chartType = effective.type;
    // Map iteration follows slot order.
    const yCandidates = [...slots.keys()];
    const colorFor = (index: number) =>
        palette.categorical[(slots.get(index) ?? 0) % palette.categorical.length];
    const visible = yCandidates.filter((index) => effective.valueIndices.includes(index));
    // Colour follows the column; the dash follows the visible order, so the
    // first line drawn is always solid.
    const dashFor = (index: number) =>
        chartType === 'line' ? getSeriesDash(visible.indexOf(index)) : undefined;
    const series: ResultChartSeries[] = visible.map((index) => ({
        key: chartSeriesKey(index),
        name: labels[index],
        color: colorFor(index),
        dash: dashFor(index),
    }));
    // A custom theme with fewer distinct colours lowers the limit so colours never repeat.
    const maxSeries = Math.max(1, Math.min(MAX_CHART_SERIES, palette.categorical.length));
    const atSeriesLimit = effective.valueIndices.length >= maxSeries;

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-x-4 gap-y-1.5 px-3 py-1.5 bg-elevated border-b border-default flex-wrap text-[11px] shrink-0">
                <div
                    role="group"
                    aria-label={t('editor.resultChart.chartType')}
                    className="flex items-center bg-surface-secondary rounded border border-strong overflow-hidden"
                >
                    {RESULT_CHART_TYPES.map((type, i) => {
                        const {labelKey, icon: Icon} = CHART_TYPES[type];
                        const active = chartType === type;
                        return (
                            <button
                                key={type}
                                type="button"
                                aria-pressed={active}
                                onClick={() => onConfigChange({...effective, type})}
                                className={clsx(
                                    'flex items-center gap-1 px-1.5 py-0.5 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                                    i > 0 && 'border-l border-strong',
                                    active
                                        ? 'bg-accent-primary/15 text-accent'
                                        : 'text-secondary hover:text-primary hover:bg-surface-tertiary',
                                )}
                            >
                                <Icon size={12} aria-hidden="true" />
                                {t(labelKey)}
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-1.5">
                    <label htmlFor={xSelectId} className="text-muted font-medium">
                        {t('editor.resultChart.xAxis')}
                    </label>
                    <select
                        id={xSelectId}
                        value={effective.labelIndex}
                        onChange={(e) =>
                            onConfigChange(
                                setChartLabelColumn(effective, Number(e.target.value), result),
                            )
                        }
                        className={clsx(
                            'bg-surface-secondary border border-strong rounded px-1 py-0.5 text-primary max-w-[180px] truncate',
                            FOCUS_RING,
                        )}
                    >
                        {/* Keyed by index: a result can repeat a column name. */}
                        {labels.map((label, index) => (
                            <option key={index} value={index}>
                                {label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-1.5 min-w-0">
                    <span id={yLabelId} className="text-muted font-medium">
                        {t('editor.resultChart.yAxis')}
                    </span>
                    <div
                        role="group"
                        aria-labelledby={yLabelId}
                        className="flex items-center gap-1 flex-wrap"
                    >
                        {yCandidates.map((index) => {
                            const selected = effective.valueIndices.includes(index);
                            const blocked = !selected && atSeriesLimit;
                            return (
                                <button
                                    key={index}
                                    type="button"
                                    aria-pressed={selected}
                                    disabled={blocked}
                                    title={
                                        blocked
                                            ? t('editor.resultChart.maxSeries', {max: maxSeries})
                                            : undefined
                                    }
                                    onClick={() =>
                                        onConfigChange(
                                            toggleChartValueColumn(effective, index, maxSeries),
                                        )
                                    }
                                    className={clsx(
                                        'flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors max-w-[180px] disabled:opacity-40 disabled:cursor-not-allowed',
                                        FOCUS_RING,
                                        selected
                                            ? 'border-strong bg-surface-secondary text-primary'
                                            : 'border-default text-muted hover:text-primary hover:bg-surface-secondary',
                                    )}
                                >
                                    {selected && (
                                        <SeriesKey
                                            type={chartType}
                                            color={colorFor(index)}
                                            dash={dashFor(index)}
                                        />
                                    )}
                                    <span className="truncate">{labels[index]}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <p
                    className={clsx(
                        'ml-auto whitespace-nowrap tabular-nums',
                        scope.capped ? 'text-accent-warning' : 'text-muted',
                    )}
                >
                    {scope.capped
                        ? t('editor.resultChart.scopeCapped', {
                              plotted,
                              loaded: formatChartCount(scope.loaded, locale),
                          })
                        : t('editor.resultChart.scopeLoaded', {count: plotted})}
                    {scope.hasMore && ` · ${t('editor.resultChart.scopeMore')}`}
                </p>
            </div>

            <figure
                aria-labelledby={captionId}
                aria-busy={isRefreshing || undefined}
                className={clsx(
                    'flex-1 min-h-0 m-0 px-2 pt-2 pb-1 transition-opacity duration-200',
                    '[&_svg:focus]:outline-none [&_svg:focus-visible]:outline [&_svg:focus-visible]:outline-2 [&_svg:focus-visible]:outline-focus',
                    isRefreshing && 'opacity-60',
                )}
            >
                <figcaption id={captionId} className="sr-only">
                    {t('editor.resultChart.summary', {
                        type: t(CHART_TYPES[chartType].labelKey),
                        values: series.map((s) => s.name).join(', '),
                        label: labels[effective.labelIndex],
                        count: plotted,
                    })}
                </figcaption>
                <ResultChartPlot
                    type={chartType}
                    data={data}
                    series={series}
                    palette={palette}
                    locale={locale}
                    temporal={temporal}
                    animate={!reducedMotion}
                />
            </figure>
        </div>
    );
}
