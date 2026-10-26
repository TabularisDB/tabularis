import {describe, expect, it, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import type {ExplainPlan, ExplainMetrics, ExplainDiagnostic} from '@tabularis/explain';
import {computeExplainMetrics} from '@tabularis/explain';
import {ExplainTableView} from '@tabularis/explain/react';

vi.mock('lucide-react', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        Download: (props: React.HTMLAttributes<HTMLSpanElement>) => (
            <span data-testid="download-icon" {...props} />
        ),
        ChevronRight: () => <span />,
        ChevronDown: () => <span />,
    };
});

function makePlan(): ExplainPlan {
    return {
        root: {
            id: 'node_0',
            node_type: 'Seq Scan',
            relation: 'users',
            startup_cost: 0,
            total_cost: 25.5,
            plan_rows: 100,
            actual_rows: null,
            actual_time_ms: null,
            actual_loops: null,
            buffers_hit: null,
            buffers_read: null,
            filter: null,
            index_condition: null,
            join_type: null,
            hash_condition: null,
            extra: {},
            children: [],
        },
        planning_time_ms: null,
        execution_time_ms: null,
        original_query: 'SELECT * FROM users',
        driver: 'postgres',
        has_analyze_data: false,
        raw_output: null,
    };
}

describe('ExplainTableView', () => {
    it('does not render export button when onExportCsv is omitted', () => {
        const plan = makePlan();
        const metrics: ExplainMetrics = computeExplainMetrics(plan);
        const diagnostics = new Map<string, ExplainDiagnostic[]>();

        render(
            <ExplainTableView
                plan={plan}
                metrics={metrics}
                diagnostics={diagnostics}
                selectedId={null}
                onSelect={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', {name: /exportCsv/i})).toBeNull();
    });

    it('renders export button and calls onExportCsv when clicked', () => {
        const plan = makePlan();
        const metrics: ExplainMetrics = computeExplainMetrics(plan);
        const diagnostics = new Map<string, ExplainDiagnostic[]>();
        const onExportCsv = vi.fn();

        render(
            <ExplainTableView
                plan={plan}
                metrics={metrics}
                diagnostics={diagnostics}
                selectedId={null}
                onSelect={vi.fn()}
                onExportCsv={onExportCsv}
            />,
        );

        const button = screen.getByRole('button', {name: /exportCsv/i});
        expect(button).toBeDefined();
        expect(button).not.toBeDisabled();

        fireEvent.click(button);
        expect(onExportCsv).toHaveBeenCalledTimes(1);
    });

    it('disables the export button when isExportingCsv is true', () => {
        const plan = makePlan();
        const metrics: ExplainMetrics = computeExplainMetrics(plan);
        const diagnostics = new Map<string, ExplainDiagnostic[]>();
        const onExportCsv = vi.fn();

        render(
            <ExplainTableView
                plan={plan}
                metrics={metrics}
                diagnostics={diagnostics}
                selectedId={null}
                onSelect={vi.fn()}
                onExportCsv={onExportCsv}
                isExportingCsv={true}
            />,
        );

        const button = screen.getByRole('button');
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(onExportCsv).not.toHaveBeenCalled();
    });
    it('renders the same cost, rows and estimate gap values the CSV export uses', () => {
        const plan = makePlan();
        // 100 estimated, 20 actual: a 5x overestimate.
        plan.root = {...plan.root, actual_rows: 20, actual_time_ms: 2, actual_loops: 1};
        plan.has_analyze_data = true;
        const metrics: ExplainMetrics = computeExplainMetrics(plan);

        render(
            <ExplainTableView
                plan={plan}
                metrics={metrics}
                diagnostics={new Map<string, ExplainDiagnostic[]>()}
                selectedId={null}
                onSelect={vi.fn()}
            />,
        );

        expect(screen.getByText('0.00 - 25.5')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('20')).toBeInTheDocument();
        expect(screen.getByText('2.00 ms')).toBeInTheDocument();
        expect(screen.getByText('5.00x')).toBeInTheDocument();
    });

    it('shows placeholders instead of zero when metrics are unavailable', () => {
        const plan = makePlan();
        plan.root = {...plan.root, startup_cost: null, total_cost: null, plan_rows: null};
        const metrics: ExplainMetrics = computeExplainMetrics(plan);

        render(
            <ExplainTableView
                plan={plan}
                metrics={metrics}
                diagnostics={new Map<string, ExplainDiagnostic[]>()}
                selectedId={null}
                onSelect={vi.fn()}
            />,
        );

        // cost, est rows, self time and estimate gap
        expect(screen.getAllByText('-')).toHaveLength(4);
        expect(screen.queryByText('0')).toBeNull();
    });
});
