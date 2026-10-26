import {describe, it, expect, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {ResultChart} from '@/components/ui/ResultChart';
import type {QueryResult} from '@/types/editor';
import type {CellChartConfig} from '@/types/notebook';

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
    series: {column: string; color: string; dash?: string}[];
    animate: boolean;
}

vi.mock('@/components/ui/ResultChartPlot', () => ({
    ResultChartPlot: ({type, data, series, animate}: MockPlotProps) => (
        <div
            data-testid={`${type}-chart`}
            data-points={data.length}
            data-series={series.map((s) => s.column).join(',')}
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
        const config: CellChartConfig = {
            type: 'line',
            labelColumn: 'region',
            valueColumns: ['revenue', 'cost'],
        };
        render(<ResultChart result={sales} config={config} onConfigChange={vi.fn()} />);
        const chart = screen.getByTestId('line-chart');
        expect(chart).toHaveAttribute('data-series', 'revenue,cost');
        const dashes = chart.getAttribute('data-dashes')!.split(',');
        expect(dashes[0]).toBe('solid');
        expect(dashes[1]).not.toBe('solid');
    });

    it('keeps each series colour when another series is hidden', () => {
        const both: CellChartConfig = {
            type: 'bar',
            labelColumn: 'region',
            valueColumns: ['revenue', 'cost'],
        };
        const {rerender} = render(
            <ResultChart result={sales} config={both} onConfigChange={vi.fn()} />,
        );
        expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-colors', 'c0,c1');
        rerender(
            <ResultChart
                result={sales}
                config={{...both, valueColumns: ['cost']}}
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
            labelColumn: 'region',
            valueColumns: ['revenue'],
        });
    });

    it('picks the X column through a labelled select', () => {
        const onConfigChange = vi.fn();
        render(<ResultChart result={sales} config={null} onConfigChange={onConfigChange} />);
        const select = screen.getByLabelText('editor.resultChart.xAxis');
        expect(select).toHaveValue('region');
        fireEvent.change(select, {target: {value: 'id'}});
        expect(onConfigChange).toHaveBeenCalledWith({
            type: 'bar',
            labelColumn: 'id',
            valueColumns: ['revenue'],
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
            labelColumn: 'region',
            valueColumns: ['revenue', 'cost'],
        });
    });

    it('disables further Y columns once the series limit is reached', () => {
        const columns = ['label', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const wide: QueryResult = {
            columns,
            rows: [['x', 1, 2, 3, 4, 5, 6, 7]],
            affected_rows: 0,
        };
        const config: CellChartConfig = {
            type: 'bar',
            labelColumn: 'label',
            valueColumns: ['a', 'b', 'c', 'd', 'e'],
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
        const stale: CellChartConfig = {
            type: 'line',
            labelColumn: 'month',
            valueColumns: ['orders'],
        };
        render(<ResultChart result={sales} config={stale} onConfigChange={vi.fn()} />);
        expect(screen.getByTestId('line-chart')).toHaveAttribute('data-series', 'revenue');
        expect(screen.getByLabelText('editor.resultChart.xAxis')).toHaveValue('region');
    });
});
