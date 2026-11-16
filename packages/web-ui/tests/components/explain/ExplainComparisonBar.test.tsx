import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {ExplainComparisonBar} from '@/components/explain/ExplainComparisonBar';
import type {PlanComparisonResult} from '@tabularis/explain';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, defaultValue?: string) => defaultValue || key,
    }),
}));

describe('ExplainComparisonBar', () => {
    it('renders incompatible warning when plans cannot be compared', () => {
        const incompatibleComparison: PlanComparisonResult = {
            isCompatible: false,
            incompatibilityReason: 'Engine mismatch: postgres vs mysql',
            hasAnalyzeMismatch: false,
            baselineSnapshotId: 'base-1',
            currentSnapshotId: 'curr-1',
            summary: {
                totalCostDelta: {baselineValue: null, currentValue: null, delta: null, ratio: null},
                executionTimeDelta: {
                    baselineValue: null,
                    currentValue: null,
                    delta: null,
                    ratio: null,
                },
                planningTimeDelta: {
                    baselineValue: null,
                    currentValue: null,
                    delta: null,
                    ratio: null,
                },
                nodesAdded: 0,
                nodesRemoved: 0,
                operatorsChanged: 0,
            },
            nodeComparisons: [],
        };

        const onClear = vi.fn();
        render(
            <ExplainComparisonBar
                comparison={incompatibleComparison}
                baselineName="Old PostgreSQL Plan"
                onClearBaseline={onClear}
            />,
        );

        expect(screen.getByText(/Incompatible baseline/i)).toBeInTheDocument();
        expect(screen.getByText(/Engine mismatch: postgres vs mysql/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /Clear/i}));
        expect(onClear).toHaveBeenCalled();
    });

    it('renders comparison metrics and delta badges when compatible', () => {
        const compatibleComparison: PlanComparisonResult = {
            isCompatible: true,
            hasAnalyzeMismatch: false,
            baselineSnapshotId: 'base-1',
            currentSnapshotId: 'curr-1',
            summary: {
                totalCostDelta: {
                    baselineValue: 100,
                    currentValue: 80,
                    delta: -20,
                    ratio: 0.8,
                },
                executionTimeDelta: {
                    baselineValue: 50,
                    currentValue: 65,
                    delta: 15,
                    ratio: 1.3,
                },
                planningTimeDelta: {
                    baselineValue: 1,
                    currentValue: 1,
                    delta: 0,
                    ratio: 1,
                },
                nodesAdded: 0,
                nodesRemoved: 0,
                operatorsChanged: 1,
            },
            nodeComparisons: [
                {
                    baselineNodeId: 'node-1',
                    currentNodeId: 'node-1',
                    operatorChanged: true,
                    baselineNodeType: 'Seq Scan',
                    currentNodeType: 'Index Scan',
                    relation: 'users',
                    status: 'matched',
                    costDelta: {baselineValue: 100, currentValue: 80, delta: -20, ratio: 0.8},
                    timeDelta: {baselineValue: 50, currentValue: 65, delta: 15, ratio: 1.3},
                    rowsDelta: {baselineValue: 10, currentValue: 10, delta: 0, ratio: 1},
                },
            ],
        };

        const onClear = vi.fn();
        render(
            <ExplainComparisonBar
                comparison={compatibleComparison}
                baselineName="Pre-migration Baseline"
                onClearBaseline={onClear}
            />,
        );

        expect(screen.getByText(/Pre-migration Baseline/i)).toBeInTheDocument();
        expect(screen.getByText(/-20.00/)).toBeInTheDocument(); // cost delta
        expect(screen.getByText(/\+15.00 ms/)).toBeInTheDocument(); // time delta
        expect(screen.getByText(/operators changed/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /Clear/i}));
        expect(onClear).toHaveBeenCalled();
    });
});
