import {describe, it, expect, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {LazyResultChart} from '@/components/ui/LazyResultChart';
import type {QueryResult} from '@/types/editor';

// The first chunk load fails, as an offline or stale bundle would; later ones work.
const load = vi.hoisted(() => ({calls: 0}));
vi.mock('@/components/ui/loadResultChart', () => ({
    loadResultChart: () => {
        load.calls++;
        if (load.calls === 1) return Promise.reject(new Error('chunk failed'));
        return Promise.resolve({
            ResultChart: ({result}: {result: QueryResult}) => (
                <div data-testid="result-chart">{result.columns.join(',')}</div>
            ),
        });
    },
}));

const result: QueryResult = {
    columns: ['region', 'revenue'],
    rows: [['North', 100]],
    affected_rows: 0,
};

describe('LazyResultChart load failure', () => {
    it('shows the failure in place and loads the chart on retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const onShowGrid = vi.fn();
        render(
            <LazyResultChart
                result={result}
                config={null}
                onConfigChange={vi.fn()}
                onShowGrid={onShowGrid}
            />,
        );

        expect(await screen.findByRole('alert')).toHaveTextContent('editor.resultChart.loadFailed');
        fireEvent.click(screen.getByRole('button', {name: 'editor.resultChart.showGrid'}));
        expect(onShowGrid).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', {name: 'editor.resultChart.retry'}));
        expect(await screen.findByTestId('result-chart')).toHaveTextContent('region,revenue');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(load.calls).toBe(2);
    });
});
