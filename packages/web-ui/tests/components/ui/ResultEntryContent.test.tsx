import {describe, it, expect, vi, beforeEach} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {ResultEntryContent} from '@/components/ui/ResultEntryContent';
import {resetResultChartStates} from '@/hooks/useResultChartState';
import type {QueryResult, QueryResultEntry} from '@/types/editor';

vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: () => <div data-testid="mock-data-grid" />,
}));

vi.mock('@/hooks/useChartPalette', () => ({
    useChartPalette: () => ({
        series: ['var(--a)', 'var(--b)'],
        categorical: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'],
        grid: 'var(--grid)',
        tick: 'var(--tick)',
        axis: 'var(--axis)',
        surface: 'var(--surface)',
        cursor: 'var(--cursor)',
        tooltipBackground: 'var(--tooltip)',
        tooltipBorder: 'var(--border)',
        tooltipText: 'var(--text)',
        radius: '4px',
        barRadius: 4,
    }),
    chartTooltipStyle: () => ({}),
}));

vi.mock('@/components/ui/ResultChartPlot', () => ({
    ResultChartPlot: ({type}: {type: string}) => <div data-testid={`mock-${type}-chart`} />,
}));

describe('ResultEntryContent timing tooltip', () => {
    it('renders timing tooltip on total duration when server_time_ms and fetch_time_ms are present', () => {
        const entry: QueryResultEntry = {
            id: 'entry-1',
            queryIndex: 0,
            query: 'SELECT 1',
            isLoading: false,
            error: '',
            executionTime: 45,
            page: 1,
            activeTable: null,
            pkColumns: null,
            result: {
                columns: ['id'],
                rows: [[1]],
                affected_rows: 0,
                server_time_ms: 30,
                fetch_time_ms: 15,
            },
        };

        render(<ResultEntryContent entry={entry} connectionId="conn-1" />);

        const durationSpan = screen.getByText('(45 ms)');
        expect(durationSpan).toBeInTheDocument();
        const title = durationSpan.getAttribute('title');
        expect(title).toContain('30 ms');
        expect(title).toContain('15 ms');
        expect(title).toContain('45 ms');
    });

    it('does not render timing tooltip when breakdown is missing', () => {
        const entry: QueryResultEntry = {
            id: 'entry-2',
            queryIndex: 0,
            query: 'SELECT 1',
            isLoading: false,
            error: '',
            executionTime: 45,
            page: 1,
            activeTable: null,
            pkColumns: null,
            result: {
                columns: ['id'],
                rows: [[1]],
                affected_rows: 0,
            },
        };

        render(<ResultEntryContent entry={entry} connectionId="conn-1" />);

        const durationSpan = screen.getByText('(45 ms)');
        expect(durationSpan).toBeInTheDocument();
        expect(durationSpan).not.toHaveAttribute('title');
    });
});

describe('ResultEntryContent grid/chart toggle', () => {
    const chartable: QueryResult = {
        columns: ['region', 'revenue'],
        rows: [
            ['North', 100],
            ['South', 200],
        ],
        affected_rows: 0,
    };

    function makeEntry(id: string): QueryResultEntry {
        return {
            id,
            queryIndex: 0,
            query: 'SELECT region, revenue FROM sales',
            isLoading: false,
            error: '',
            executionTime: 5,
            page: 1,
            activeTable: null,
            pkColumns: null,
            result: chartable,
        };
    }

    const gridProps = {
        connectionId: 'c1',
        copyFormat: 'csv' as const,
        csvDelimiter: ',',
        csvIncludeHeaders: true,
        onPageChange: vi.fn(),
    };

    const chartButton = () => screen.getByRole('button', {name: 'editor.resultChart.viewChart'});
    const gridButton = () => screen.getByRole('button', {name: 'editor.resultChart.viewGrid'});

    beforeEach(() => {
        resetResultChartStates();
    });

    it('does not offer the toggle unless the caller allows charts', () => {
        render(<ResultEntryContent entry={makeEntry('e-off')} {...gridProps} />);
        expect(
            screen.queryByRole('group', {name: 'editor.resultChart.viewLabel'}),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId('mock-data-grid')).toBeInTheDocument();
    });

    it('does not offer the toggle in compact mode', () => {
        render(
            <ResultEntryContent entry={makeEntry('e-compact')} {...gridProps} compact allowChart />,
        );
        expect(
            screen.queryByRole('group', {name: 'editor.resultChart.viewLabel'}),
        ).not.toBeInTheDocument();
    });

    it('starts on the grid and switches between grid and chart', async () => {
        render(<ResultEntryContent entry={makeEntry('e-1')} {...gridProps} allowChart />);
        expect(gridButton()).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('mock-data-grid')).toBeInTheDocument();

        fireEvent.click(chartButton());
        expect(chartButton()).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('mock-data-grid')).not.toBeInTheDocument();
        expect(await screen.findByTestId('mock-bar-chart')).toBeInTheDocument();
        // The status bar (row count) stays visible in chart view.
        expect(screen.getByText(/editor\.rowsRetrieved/)).toBeInTheDocument();

        fireEvent.click(gridButton());
        expect(screen.getByTestId('mock-data-grid')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-bar-chart')).not.toBeInTheDocument();
    });

    it('keeps the view per entry', async () => {
        const {rerender} = render(
            <ResultEntryContent entry={makeEntry('e-a')} {...gridProps} allowChart />,
        );
        fireEvent.click(chartButton());

        rerender(<ResultEntryContent entry={makeEntry('e-b')} {...gridProps} allowChart />);
        expect(screen.getByTestId('mock-data-grid')).toBeInTheDocument();

        rerender(<ResultEntryContent entry={makeEntry('e-a')} {...gridProps} allowChart />);
        expect(await screen.findByTestId('mock-bar-chart')).toBeInTheDocument();
    });
});
