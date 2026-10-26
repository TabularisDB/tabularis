import {lazy, Suspense} from 'react';
import {Loader2} from 'lucide-react';
import type {ResultChartProps} from './ResultChart';
import {loadResultChart} from './loadResultChart';

const ResultChart = lazy(() => loadResultChart().then((m) => ({default: m.ResultChart})));

/**
 * Holds the chart's place while its chunk loads. The spinner fades in only
 * after 200ms, so the usual near-instant load shows no flash.
 */
function ResultChartFallback() {
    return (
        <div className="flex-1 min-h-0 flex items-center justify-center" aria-busy="true">
            <span className="text-muted animate-[fade-in_150ms_ease-out_200ms_both]">
                <Loader2 size={20} aria-hidden="true" className="motion-safe:animate-spin" />
            </span>
        </div>
    );
}

/** `ResultChart`, loaded on first use. */
export function LazyResultChart(props: ResultChartProps) {
    return (
        <Suspense fallback={<ResultChartFallback />}>
            <ResultChart {...props} />
        </Suspense>
    );
}
