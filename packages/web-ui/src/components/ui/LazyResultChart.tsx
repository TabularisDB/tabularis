import {Component, lazy, Suspense} from 'react';
import type {ErrorInfo} from 'react';
import {useTranslation} from 'react-i18next';
import clsx from 'clsx';
import {ChartColumn, Loader2} from 'lucide-react';
import type {ResultChartProps} from './ResultChart';
import {loadResultChart} from './loadResultChart';

const FOCUS_RING =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const lazyResultChart = () => lazy(() => loadResultChart().then((m) => ({default: m.ResultChart})));

// `React.lazy` keeps a rejected load for good, so a retry swaps in a fresh one.
let ResultChart = lazyResultChart();

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

function ResultChartLoadError({
    onRetry,
    onShowGrid,
}: {
    onRetry: () => void;
    onShowGrid?: () => void;
}) {
    const {t} = useTranslation();
    const button = clsx(
        'mt-1 px-2.5 py-1 text-xs rounded border border-strong text-secondary hover:text-primary hover:bg-surface-secondary transition-colors',
        FOCUS_RING,
    );
    return (
        <div
            role="alert"
            className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
        >
            <ChartColumn size={28} aria-hidden="true" className="text-muted" />
            <p className="text-sm font-medium text-secondary">
                {t('editor.resultChart.loadFailed')}
            </p>
            <div className="flex gap-2">
                <button type="button" onClick={onRetry} className={button}>
                    {t('editor.resultChart.retry')}
                </button>
                {onShowGrid && (
                    <button type="button" onClick={onShowGrid} className={button}>
                        {t('editor.resultChart.showGrid')}
                    </button>
                )}
            </div>
        </div>
    );
}

/** Keeps a chart that fails to load or render from taking the editor down with it. */
class ResultChartBoundary extends Component<ResultChartProps, {failed: boolean}> {
    state = {failed: false};

    static getDerivedStateFromError() {
        return {failed: true};
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ResultChart] failed to load or render:', error, info.componentStack);
    }

    retry = () => {
        ResultChart = lazyResultChart();
        this.setState({failed: false});
    };

    render() {
        if (this.state.failed) {
            return <ResultChartLoadError onRetry={this.retry} onShowGrid={this.props.onShowGrid} />;
        }
        return (
            <Suspense fallback={<ResultChartFallback />}>
                <ResultChart {...this.props} />
            </Suspense>
        );
    }
}

/** `ResultChart`, loaded on first use. */
export function LazyResultChart(props: ResultChartProps) {
    return <ResultChartBoundary {...props} />;
}
