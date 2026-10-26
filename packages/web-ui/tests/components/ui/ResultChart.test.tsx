import {describe, it, expect, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {ResultChart} from '@/components/ui/ResultChart';
import type {QueryResult} from '@/types/editor';
import type {ResultChartConfig} from '@/utils/resultChart';

const translations = vi.hoisted(() => [] as {key: string; options?: Record<string, unknown>}[]);
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => {
            translations.push({key, options});
            return key;
        },
        i18n: {language: 'de'},
    }),
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

interface MockPlotProps {
    type: string;
    data: unknown[];
    series: {key: string; name: string; color: string; dash?: string}[];
    animate: boolean;
}

vi.mock('@/components/ui/ResultChartPlot', () => ({
    ResultChartPlot: ({type, data, series, animate}: MockPlotProps) => (
        <div
            data-testid={`${type}-chart`}
            data-points={data.length}
            data-series={series.map((s) => s.name).join(',')}
            data-colors={series.map((s) => s.color).join(',')}
            data-dashes={series.map((s) => s.dash ?? 'solid').join(',')}
            data-animate={String(animate)}
        />
    ),
}));

const sales: QueryResult = {
    columns: ['id', 'region', 'revenue', 'cost'],
    rows: [
        [1, 'North', 100, 40],
        [2, 'South', 200, 80],
    ],
    affected_rows: 0,
};

describe('ResultChart', () => {
    it('renders a bar chart from the defaults when no config is stored', () => {
        render(<ResultChart result={sales} config={null} onConfigChange={vi.fn()} />);
        const chart = screen.getByTestId('bar-chart');
        expect(chart).toHaveAttribute('data-series', 'revenue');
        expect(chart).toHaveAttribute('data-points', '2');
        expect(chart).toHaveAttribute('data-colors', 'c0');
    });

    it('gives line series after the first a dash pattern', () => {
        const config: ResultChartConfig = {
            type: 'line',
            labelIndex: 1,
            valueIndices: [2, 3],
            columns: sales.columns,
        };
        render(<ResultChart result={sales} config={config} onConfigChange={vi.fn()} />);
        const chart = screen.getByTestId('line-chart');
        expect(chart).toHaveAttribute('data-series', 'revenue,cost');
        const dashes = chart.getAttribute('data-dashes')!.split(',');
        expect(dashes[0]).toBe('solid');
        expect(dashes[1]).not.toBe('solid');
    });

    it('keeps each series colour when another series is hidden', () => {
        const both: ResultChartConfig = {
            type: 'bar',
            labelIndex: 1,
            valueIndices: [2, 3],
            columns: sales.columns,
        };
        const {rerender} = render(
            <ResultChart result={sales} config={both} onConfigChange={vi.fn()} />,
        );
        expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-colors', 'c0,c1');
        rerender(
            <ResultChart
                result={sales}
                config={{...both, valueIndices: [3]}}
                onConfigChange={vi.fn()}
            />,
        );
        expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-colors', 'c1');
    });

    it('switches chart type through pressed-state buttons', () => {
        const onConfigChange = vi.fn();
        render(<ResultChart result={sales} config={null} onConfigChange={onConfigChange} />);
        expect(
            screen.getByRole('group', {name: 'editor.resultChart.chartType'}),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'editor.resultChart.typeBar'})).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        fireEvent.click(screen.getByRole('button', {name: 'editor.resultChart.typeLine'}));
        expect(onConfigChange).toHaveBeenCalledWith({
            type: 'line',
            labelIndex: 1,
            valueIndices: [2],
            columns: sales.columns,
        });
    });

    it('picks the X column through a labelled select', () => {
        const onConfigChange = vi.fn();
        render(<ResultChart result={sales} config={null} onConfigChange={onConfigChange} />);
        const select = screen.getByLabelText('editor.resultChart.xAxis');
        expect(select).toHaveDisplayValue('region');
        fireEvent.change(select, {target: {value: '0'}});
        expect(onConfigChange).toHaveBeenCalledWith({
            type: 'bar',
            labelIndex: 0,
            valueIndices: [2],
            columns: sales.columns,
        });
    });

    it('offers numeric columns other than X as Y toggles, id columns last', () => {
        const onConfigChange = vi.fn();
        render(<ResultChart result={sales} config={null} onConfigChange={onConfigChange} />);
        const yGroup = screen.getByRole('group', {
            name: 'editor.resultChart.yAxis',
        });
        const names = Array.from(yGroup.querySelectorAll('button')).map((b) => b.textContent);
        expect(names).toEqual(['revenue', 'cost', 'id']);
        expect(screen.getByRole('button', {name: 'revenue'})).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        fireEvent.click(screen.getByRole('button', {name: 'cost'}));
        expect(onConfigChange).toHaveBeenCalledWith({
            type: 'bar',
            labelIndex: 1,
            valueIndices: [2, 3],
            columns: sales.columns,
        });
    });

    it('disables further Y columns once the series limit is reached', () => {
        const columns = ['label', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const wide: QueryResult = {
            columns,
            rows: [['x', 1, 2, 3, 4, 5, 6, 7]],
            affected_rows: 0,
        };
        const config: ResultChartConfig = {
            type: 'bar',
            labelIndex: 0,
            valueIndices: [1, 2, 3, 4, 5],
            columns,
        };
        render(<ResultChart result={wide} config={config} onConfigChange={vi.fn()} />);
        const extra = screen.getByRole('button', {name: 'f'});
        expect(extra).toBeDisabled();
        expect(extra).toHaveAttribute('title', 'editor.resultChart.maxSeries');
        expect(screen.getByRole('button', {name: 'a'})).toBeEnabled();
    });

    it('describes the chart for screen readers in a figure caption', () => {
        render(<ResultChart result={sales} config={null} onConfigChange={vi.fn()} />);
        const figure = screen.getByRole('figure');
        expect(figure).toHaveAccessibleName('editor.resultChart.summary');
        expect(figure.querySelector('figcaption')).toHaveClass('sr-only');
    });

    it('shows how many loaded rows are plotted and flags unloaded rows', () => {
        render(
            <ResultChart
                result={{
                    ...sales,
                    pagination: {
                        page: 1,
                        page_size: 2,
                        total_rows: null,
                        has_more: true,
                    },
                }}
                config={null}
                onConfigChange={vi.fn()}
            />,
        );
        expect(screen.getByText(/editor\.resultChart\.scopeLoaded/)).toHaveTextContent(
            'editor.resultChart.scopeLoaded · editor.resultChart.scopeMore',
        );
    });

    it('formats the plotted row count for the locale', () => {
        const rows = Array.from({length: 1000}, (_, i) => [i, `r${i}`, i * 10, i]);
        translations.length = 0;
        render(<ResultChart result={{...sales, rows}} config={null} onConfigChange={vi.fn()} />);
        const options = (key: string) => translations.find((c) => c.key === key)?.options;
        expect(options('editor.resultChart.scopeLoaded')).toEqual({count: '1.000'});
        expect(options('editor.resultChart.summary')).toMatchObject({count: '1.000'});

        translations.length = 0;
        render(
            <ResultChart
                result={{...sales, rows: [...rows, ...rows.slice(0, 234)]}}
                config={null}
                onConfigChange={vi.fn()}
            />,
        );
        expect(options('editor.resultChart.scopeCapped')).toEqual({
            plotted: '1.000',
            loaded: '1.234',
        });
    });

    it('dims the chart and marks it busy while a refresh runs', () => {
        render(<ResultChart result={sales} config={null} onConfigChange={vi.fn()} isRefreshing />);
        const figure = screen.getByRole('figure');
        expect(figure).toHaveAttribute('aria-busy', 'true');
        expect(figure).toHaveClass('opacity-60');
    });

    it('animates the plot unless reduced motion is requested', () => {
        const original = window.matchMedia;
        window.matchMedia = vi.fn().mockReturnValue({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }) as unknown as typeof window.matchMedia;
        try {
            render(<ResultChart result={sales} config={null} onConfigChange={vi.fn()} />);
            expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-animate', 'false');
        } finally {
            window.matchMedia = original;
        }
    });

    it('explains a result without numeric columns and offers the grid', () => {
        const onShowGrid = vi.fn();
        render(
            <ResultChart
                result={{columns: ['name'], rows: [['Ada']], affected_rows: 0}}
                config={null}
                onConfigChange={vi.fn()}
                onShowGrid={onShowGrid}
            />,
        );
        expect(screen.getByText('editor.resultChart.emptyNoNumericTitle')).toBeInTheDocument();
        expect(screen.queryByRole('figure')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'editor.resultChart.showGrid'}));
        expect(onShowGrid).toHaveBeenCalled();
    });

    it('explains when the result has no rows', () => {
        render(
            <ResultChart
                result={{columns: ['a', 'b'], rows: [], affected_rows: 0}}
                config={null}
                onConfigChange={vi.fn()}
            />,
        );
        expect(screen.getByText('editor.resultChart.emptyNoRowsTitle')).toBeInTheDocument();
    });

    it('recovers from a stored config whose columns changed', () => {
        const stale: ResultChartConfig = {
            type: 'line',
            labelIndex: 0,
            valueIndices: [1],
            columns: ['month', 'orders'],
        };
        render(<ResultChart result={sales} config={stale} onConfigChange={vi.fn()} />);
        expect(screen.getByTestId('line-chart')).toHaveAttribute('data-series', 'revenue');
        expect(screen.getByLabelText('editor.resultChart.xAxis')).toHaveDisplayValue('region');
    });

    describe('with repeated column names', () => {
        // SELECT o.id, c.id, c.name, o.total ...
        const joined: QueryResult = {
            columns: ['id', 'id', 'name', 'total'],
            rows: [
                [1, 10, 'Ada', 5],
                [2, 20, 'Lin', 6],
            ],
            affected_rows: 0,
        };

        it('gives every X option its own value and a distinct label', () => {
            const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                render(<ResultChart result={joined} config={null} onConfigChange={vi.fn()} />);
                const options = Array.from(
                    screen.getByLabelText('editor.resultChart.xAxis').querySelectorAll('option'),
                );
                expect(options.map((o) => o.value)).toEqual(['0', '1', '2', '3']);
                expect(options.map((o) => o.textContent)).toEqual([
                    'id',
                    'id (2)',
                    'name',
                    'total',
                ]);
                // No duplicate React keys.
                expect(errors).not.toHaveBeenCalled();
            } finally {
                errors.mockRestore();
            }
        });

        it('puts the second column on X when its option is picked', () => {
            const onConfigChange = vi.fn();
            render(<ResultChart result={joined} config={null} onConfigChange={onConfigChange} />);
            fireEvent.change(screen.getByLabelText('editor.resultChart.xAxis'), {
                target: {value: '1'},
            });
            expect(onConfigChange).toHaveBeenLastCalledWith(
                expect.objectContaining({labelIndex: 1}),
            );
        });

        it('offers both columns as separate Y series', () => {
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 2,
                valueIndices: [0, 1],
                columns: joined.columns,
            };
            render(<ResultChart result={joined} config={config} onConfigChange={vi.fn()} />);
            const chart = screen.getByTestId('bar-chart');
            expect(chart).toHaveAttribute('data-series', 'id,id (2)');
            expect(chart.getAttribute('data-colors')!.split(',')).toHaveLength(2);
            expect(screen.getByRole('button', {name: 'id (2)'})).toHaveAttribute(
                'aria-pressed',
                'true',
            );
        });
    });
});
