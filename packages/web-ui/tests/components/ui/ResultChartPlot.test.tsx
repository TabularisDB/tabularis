import {describe, it, expect, vi} from 'vitest';
import {cloneElement, type ReactElement} from 'react';
import {render} from '@testing-library/react';
import {ResultChartPlot} from '@/components/ui/ResultChartPlot';
import type {ChartPalette} from '@/hooks/useChartPalette';

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
});
