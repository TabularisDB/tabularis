import {describe, it, expect, vi} from 'vitest';
import {cloneElement, type ReactElement} from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {ResultChartPlot} from '@/components/ui/ResultChartPlot';
import type {ChartPalette} from '@/hooks/useChartPalette';
import type {ResultChartPoint} from '@/utils/resultChart';

// jsdom has no layout, so give the chart a real size instead of measuring.
vi.mock('recharts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('recharts')>();
    return {
        ...actual,
        ResponsiveContainer: ({children}: {children: ReactElement}) =>
            cloneElement(children as ReactElement<{width: number; height: number}>, {
                width: 600,
                height: 300,
            }),
    };
});

const palette: ChartPalette = {
    series: [],
    categorical: ['#111111', '#222222'],
    grid: '#333333',
    tick: '#444444',
    axis: '#555555',
    surface: '#000000',
    cursor: '#666666',
    tooltipBackground: '#777777',
    tooltipBorder: '#888888',
    tooltipText: '#999999',
    radius: '4px',
    barRadius: 4,
};

const data = [
    {label: 'North', revenue: 100, cost: 40},
    {label: 'South', revenue: 200, cost: 80},
];

describe('ResultChartPlot', () => {
    it('draws one bar per point and series with a horizontal-only hairline grid', () => {
        const {container} = render(
            <ResultChartPlot
                type="bar"
                data={data}
                series={[
                    {column: 'revenue', color: '#111111'},
                    {column: 'cost', color: '#222222'},
                ]}
                palette={palette}
                locale="en"
                temporal={null}
                animate={false}
            />,
        );
        expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(4);
        expect(container.querySelectorAll('.recharts-cartesian-grid-vertical line')).toHaveLength(
            0,
        );
        expect(
            container.querySelector('.recharts-cartesian-grid-horizontal line'),
        ).not.toHaveAttribute('stroke-dasharray');
    });

    it('draws a dashed second line', () => {
        const {container} = render(
            <ResultChartPlot
                type="line"
                data={[
                    {label: 'a', revenue: 1200, cost: 4000},
                    {label: 'b', revenue: 2500, cost: 8000},
                ]}
                series={[
                    {column: 'revenue', color: '#111111'},
                    {column: 'cost', color: '#222222', dash: '6 3'},
                ]}
                palette={palette}
                locale="en"
                temporal={null}
                animate={false}
            />,
        );
        const curves = container.querySelectorAll('.recharts-line-curve');
        expect(curves).toHaveLength(2);
        expect(curves[1]).toHaveAttribute('stroke-dasharray', '6 3');
    });

    describe('missing values', () => {
        const sparse: ResultChartPoint[] = [
            {label: 'Jan', signups: 4},
            {label: 'Feb', signups: 6},
            {label: 'Mar', signups: null},
            {label: 'Apr', signups: 5},
            {label: 'May', signups: 8},
        ];
        const renderPlot = (type: 'bar' | 'line', data: ResultChartPoint[]) =>
            render(
                <ResultChartPlot
                    type={type}
                    data={data}
                    series={[{column: 'signups', color: '#111111'}]}
                    palette={palette}
                    locale="en"
                    temporal={null}
                    animate={false}
                />,
            );

        it('breaks the line at a NULL instead of dipping to 0', () => {
            const {container} = renderPlot('line', sparse);
            const path = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? '';
            // Two separate segments: Jan-Feb and Apr-May.
            expect(path.match(/M/g)).toHaveLength(2);
            expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(4);
        });

        it('leaves the bar slot of a NULL empty', () => {
            const {container} = renderPlot('bar', sparse);
            expect(container.querySelectorAll('.recharts-bar-rectangle path')).toHaveLength(4);
        });

        it('marks a value isolated between NULLs when line markers are off', () => {
            const many: ResultChartPoint[] = Array.from({length: 60}, (_, i) => ({
                label: `p${i}`,
                signups: i === 30 ? 7 : i > 30 && i < 33 ? null : i === 29 ? null : i,
            }));
            const {container} = renderPlot('line', many);
            expect(container.querySelectorAll('.recharts-dot')).toHaveLength(1);
        });

        it('shows a NULL as a dash in the tooltip', async () => {
            const {container} = renderPlot('line', sparse);
            const surface = container.querySelector('.recharts-wrapper');
            expect(surface).not.toBeNull();
            // The Mar point sits in the middle of the plot.
            fireEvent.mouseMove(surface!, {clientX: 316, clientY: 150});
            const value = await screen.findByText('—');
            const tooltip = container.querySelector('.recharts-tooltip-wrapper') as HTMLElement;
            expect(within(tooltip).getByText('Mar')).toBeInTheDocument();
            expect(within(tooltip).getByText('signups')).toBeInTheDocument();
            expect(value).toHaveClass('text-muted');
        });
    });
});
