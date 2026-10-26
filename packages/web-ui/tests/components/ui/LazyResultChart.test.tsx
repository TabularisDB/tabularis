import {describe, it, expect, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {ResultEntryContent} from '@/components/ui/ResultEntryContent';
import type {QueryResult, QueryResultEntry} from '@/types/editor';

// Counts imports of the chart module, which pulls in Recharts.
const chartModule = vi.hoisted(() => ({loads: 0}));
vi.mock('@/components/ui/ResultChart', () => {
    chartModule.loads++;
    return {
        ResultChart: ({result}: {result: QueryResult}) => (
            <div data-testid="result-chart">{result.columns.join(',')}</div>
        ),
    };
});

vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: () => <div data-testid="mock-data-grid" />,
}));

const entry: QueryResultEntry = {
    id: 'lazy-1',
    queryIndex: 0,
    query: 'SELECT region, revenue FROM sales',
    isLoading: false,
    error: '',
    executionTime: 5,
    page: 1,
    activeTable: null,
    pkColumns: null,
    result: {
        columns: ['region', 'revenue'],
        rows: [['North', 100]],
        affected_rows: 0,
    },
};

describe('LazyResultChart', () => {
    it('loads the chart only when chart view opens, with a placeholder meanwhile', async () => {
        const {container} = render(
            <ResultEntryContent
                entry={entry}
                connectionId="c1"
                copyFormat="csv"
                csvDelimiter=","
                csvIncludeHeaders
                onPageChange={vi.fn()}
                allowChart
            />,
        );
        expect(screen.getByTestId('mock-data-grid')).toBeInTheDocument();
        expect(chartModule.loads).toBe(0);

        fireEvent.click(screen.getByRole('button', {name: 'editor.resultChart.viewChart'}));
        // The grid is gone and the chart's place is held while its chunk loads.
        expect(screen.queryByTestId('mock-data-grid')).not.toBeInTheDocument();
        const placeholder = container.querySelector('[aria-busy="true"]');
        expect(placeholder).toHaveClass('flex-1');

        expect(await screen.findByTestId('result-chart')).toHaveTextContent('region,revenue');
        expect(chartModule.loads).toBe(1);
        expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
    });
});
