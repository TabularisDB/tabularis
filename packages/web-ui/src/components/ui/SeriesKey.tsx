import type {ResultChartType} from '@/utils/resultChart';

interface SeriesKeyProps {
    type: ResultChartType;
    color: string;
    dash?: string;
}

/** Colour key that mirrors the mark: a block for bars, a stroke for lines. */
export function SeriesKey({type, color, dash}: SeriesKeyProps) {
    return (
        <svg width={14} height={10} viewBox="0 0 14 10" aria-hidden="true" className="shrink-0">
            {type === 'line' ? (
                <line
                    x1={1}
                    y1={5}
                    x2={13}
                    y2={5}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray={dash}
                    strokeLinecap="round"
                />
            ) : (
                <rect x={3} y={1} width={8} height={8} rx={2} fill={color} />
            )}
        </svg>
    );
}
