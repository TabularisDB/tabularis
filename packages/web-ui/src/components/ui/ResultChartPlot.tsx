import {
    Bar,
    BarChart,
    CartesianGrid,
    Dot,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    type TooltipContentProps,
} from 'recharts';
import type {ChartPalette} from '@/hooks/useChartPalette';
import {useContainerWidth} from '@/hooks/useContainerWidth';
import {
    BAR_GAP,
    MAX_BAR_SIZE,
    formatChartTick,
    getBarCategoryGap,
    getIsolatedPoints,
    formatChartValue,
    truncateChartLabel,
    type ResultChartPoint,
    type ResultChartType,
    type TemporalFormatters,
} from '@/utils/resultChart';
import {SeriesKey} from './SeriesKey';

/** Above this many points, line markers become clutter: show them on hover only. */
const MAX_LINE_MARKERS = 40;
const Y_AXIS_WIDTH = 48;
/** Entry animation: short and decelerating, skipped for reduced motion. */
const ANIMATION_MS = 250;

export interface ResultChartSeries {
    column: string;
    color: string;
    /** Dash pattern for line charts; undefined is a solid line. */
    dash?: string;
}

interface ResultChartPlotProps {
    type: ResultChartType;
    data: ResultChartPoint[];
    series: ResultChartSeries[];
    palette: ChartPalette;
    locale: string;
    temporal: TemporalFormatters | null;
    animate: boolean;
}

function ChartTooltip({
    active,
    payload,
    label,
    type,
    series,
    locale,
    temporal,
}: TooltipContentProps<number, string> & {
    type: ResultChartType;
    series: ResultChartSeries[];
    locale: string;
    temporal: TemporalFormatters | null;
}) {
    if (!active || !payload || payload.length === 0) return null;
    const title = String(label ?? '');
    return (
        <div className="bg-tooltip border border-default rounded-md shadow-lg px-2.5 py-2 text-[11px] min-w-[120px] max-w-[280px]">
            <div className="text-primary mb-1 break-words">
                {temporal ? temporal.full(title) : title}
            </div>
            <ul className="space-y-0.5">
                {series.map((s) => {
                    const entry = payload.find((p) => p.dataKey === s.column);
                    if (!entry) return null;
                    // NULL rows show a dash rather than disappearing, so the gap reads as missing data.
                    const missing = typeof entry.value !== 'number';
                    return (
                        <li key={s.column} className="flex items-center gap-2">
                            <SeriesKey type={type} color={s.color} dash={s.dash} />
                            <span
                                className={
                                    missing
                                        ? 'text-muted tabular-nums'
                                        : 'text-primary font-semibold tabular-nums'
                                }
                            >
                                {formatChartValue(entry.value, locale)}
                            </span>
                            <span className="text-primary truncate">{s.column}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/** Recharts bar/line plot styled after the theme: hairline grid, recessive axes, thin marks. */
export function ResultChartPlot({
    type,
    data,
    series,
    palette,
    locale,
    temporal,
    animate,
}: ResultChartPlotProps) {
    const {ref, width} = useContainerWidth<HTMLDivElement>();
    const tick = {
        fontSize: 11,
        fill: palette.tick,
        style: {fontVariantNumeric: 'tabular-nums'},
    };
    const formatX = (value: unknown) => {
        const text = String(value ?? '');
        return temporal ? temporal.tick(text) : truncateChartLabel(text);
    };
    const tooltip = (
        <Tooltip
            cursor={
                type === 'bar' ? {fill: palette.cursor} : {stroke: palette.axis, strokeWidth: 1}
            }
            isAnimationActive={false}
            // Keep NULL entries so the tooltip can show them as missing.
            filterNull={false}
            content={(props) => (
                <ChartTooltip
                    {...(props as TooltipContentProps<number, string>)}
                    type={type}
                    series={series}
                    locale={locale}
                    temporal={temporal}
                />
            )}
        />
    );
    const axes = (
        <>
            <CartesianGrid vertical={false} stroke={palette.grid} />
            <XAxis
                dataKey="label"
                tick={tick}
                tickLine={false}
                axisLine={{stroke: palette.axis}}
                tickFormatter={formatX}
                interval="preserveStartEnd"
                minTickGap={12}
                tickMargin={6}
            />
            <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatChartTick(v, locale)}
                width={Y_AXIS_WIDTH}
                domain={type === 'line' ? ['auto', 'auto'] : [0, 'auto']}
            />
        </>
    );
    const marker = (color: string) => ({
        r: 4,
        fill: color,
        stroke: palette.surface,
        strokeWidth: 2,
    });
    const showMarkers = data.length <= MAX_LINE_MARKERS;
    const margin = {top: 12, right: 16, left: 0, bottom: 4};
    const barCategoryGap = getBarCategoryGap(
        width - Y_AXIS_WIDTH - margin.right - margin.left,
        data.length,
        series.length,
    );

    return (
        <div ref={ref} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
                {type === 'line' ? (
                    <LineChart data={data} margin={margin}>
                        {axes}
                        {tooltip}
                        {series.map((s) => {
                            // Without markers, a value with NULLs on both sides has no
                            // segment to draw, so it gets a marker of its own.
                            const isolated = showMarkers ? null : getIsolatedPoints(data, s.column);
                            return (
                                <Line
                                    key={s.column}
                                    type="linear"
                                    dataKey={s.column}
                                    name={s.column}
                                    stroke={s.color}
                                    strokeWidth={2}
                                    strokeDasharray={s.dash}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    // NULLs break the line: joining across them would draw
                                    // values the query never returned.
                                    connectNulls={false}
                                    dot={
                                        isolated === null
                                            ? marker(s.color)
                                            : isolated.size > 0
                                              ? ({
                                                    index,
                                                    cx,
                                                    cy,
                                                }: {
                                                    index: number;
                                                    cx?: number;
                                                    cy?: number;
                                                }) =>
                                                    isolated.has(index) ? (
                                                        <Dot cx={cx} cy={cy} {...marker(s.color)} />
                                                    ) : null
                                              : false
                                    }
                                    activeDot={{...marker(s.color), r: 5}}
                                    isAnimationActive={animate}
                                    animationDuration={ANIMATION_MS}
                                    animationEasing="ease-out"
                                />
                            );
                        })}
                    </LineChart>
                ) : (
                    <BarChart
                        data={data}
                        margin={margin}
                        barGap={BAR_GAP}
                        barCategoryGap={barCategoryGap}
                    >
                        {axes}
                        {tooltip}
                        {series.map((s) => (
                            <Bar
                                key={s.column}
                                dataKey={s.column}
                                name={s.column}
                                fill={s.color}
                                maxBarSize={MAX_BAR_SIZE}
                                radius={[palette.barRadius, palette.barRadius, 0, 0]}
                                isAnimationActive={animate}
                                animationDuration={ANIMATION_MS}
                                animationEasing="ease-out"
                            />
                        ))}
                    </BarChart>
                )}
            </ResponsiveContainer>
        </div>
    );
}
