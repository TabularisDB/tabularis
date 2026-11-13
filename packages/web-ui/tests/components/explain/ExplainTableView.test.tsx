import {afterEach, describe, expect, it, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import type {
    ExplainPlan,
    ExplainMetrics,
    ExplainDiagnostic,
    ExplainTableColumnId,
} from '@tabularis/explain';
import {computeExplainMetrics, EXPLAIN_TABLE_COLUMNS} from '@tabularis/explain';
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

        const button = screen.getByRole('button', {name: /exportCsv/i});
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

    describe('loops column', () => {
        function makeLoopPlan(): ExplainPlan {
            const plan = makePlan();
            plan.root = {
                ...plan.root,
                node_type: 'Nested Loop',
                actual_rows: 1334,
                actual_time_ms: 20,
                actual_loops: 1,
                children: [
                    {
                        ...plan.root,
                        id: 'node_1',
                        node_type: 'Index Lookup',
                        relation: 'orders',
                        actual_rows: 25,
                        actual_time_ms: 0.0133,
                        actual_loops: 331603,
                    },
                    {
                        ...plan.root,
                        id: 'node_2',
                        node_type: 'Materialize',
                        relation: null,
                        actual_rows: 3,
                        actual_time_ms: 0.01,
                        actual_loops: null,
                    },
                ],
            };
            plan.has_analyze_data = true;
            return plan;
        }

        function renderTable(plan: ExplainPlan) {
            return render(
                <ExplainTableView
                    plan={plan}
                    metrics={computeExplainMetrics(plan)}
                    diagnostics={new Map<string, ExplainDiagnostic[]>()}
                    selectedId={null}
                    onSelect={vi.fn()}
                />,
            );
        }

        it('shows how often each node ran next to Actual Rows when the plan has ANALYZE data', () => {
            renderTable(makeLoopPlan());

            expect(headerNames()).toEqual([
                '#',
                'editor.visualExplain.nodeType',
                'editor.visualExplain.relation',
                'editor.visualExplain.cost',
                'editor.visualExplain.estRows',
                'editor.visualExplain.actualRows',
                'editor.visualExplain.loops',
                'editor.visualExplain.selfTime',
                'editor.visualExplain.largestEstimateGap',
                'editor.visualExplain.filter',
            ]);
            expect(cellsOfColumn('editor.visualExplain.loops')).toEqual(['1', '331.6K', '-']);
            // The exact count is one hover away.
            expect(screen.getByText('331.6K')).toHaveAttribute('title', '331603');
        });

        it('leaves the Loops column out for an estimate-only plan', () => {
            const plan = makeLoopPlan();
            plan.has_analyze_data = false;
            renderTable(plan);

            expect(headerNames()).not.toContain('editor.visualExplain.loops');
            expect(headerNames()).not.toContain('editor.visualExplain.actualRows');
            expect(screen.queryByText('331.6K')).toBeNull();
        });
    });

    describe('column order', () => {
        afterEach(async () => {
            vi.restoreAllMocks();
            // A finished drag swallows the click its release makes, until the next tick.
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        function makeAnalyzedPlan(): ExplainPlan {
            const plan = makePlan();
            plan.root = {...plan.root, actual_rows: 20, actual_time_ms: 2, actual_loops: 4};
            plan.has_analyze_data = true;
            return plan;
        }

        function renderTable(
            props: {
                plan?: ExplainPlan;
                columnOrder?: readonly ExplainTableColumnId[];
                onColumnOrderChange?: (order: readonly ExplainTableColumnId[]) => void;
            } = {},
        ) {
            const plan = props.plan ?? makeAnalyzedPlan();
            return render(
                <ExplainTableView
                    plan={plan}
                    metrics={computeExplainMetrics(plan)}
                    diagnostics={new Map<string, ExplainDiagnostic[]>()}
                    selectedId={null}
                    onSelect={vi.fn()}
                    columnOrder={props.columnOrder}
                    onColumnOrderChange={props.onColumnOrderChange}
                />,
            );
        }

        /** Lays the movable headers out side by side, 100px each, from x = 0. */
        function layOutHeaders() {
            const headers = document.querySelectorAll<HTMLElement>('th[data-column]');
            headers.forEach((header, index) => {
                vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
                    left: index * 100,
                    right: index * 100 + 99,
                    top: 0,
                    bottom: 30,
                    width: 99,
                    height: 30,
                    x: index * 100,
                    y: 0,
                    toJSON: () => ({}),
                });
            });
        }

        function headerButton(name: string): HTMLElement {
            return screen.getByRole('button', {name});
        }

        it('renders the columns in the given order, keeping # first', () => {
            renderTable({
                columnOrder: ['filter', 'loops', 'operation', 'cost'],
            });

            // Columns the saved order lacks go back after the column they follow by default.
            expect(headerNames()).toEqual([
                '#',
                'editor.visualExplain.filter',
                'editor.visualExplain.loops',
                'editor.visualExplain.selfTime',
                'editor.visualExplain.largestEstimateGap',
                'editor.visualExplain.nodeType',
                'editor.visualExplain.relation',
                'editor.visualExplain.cost',
                'editor.visualExplain.estRows',
                'editor.visualExplain.actualRows',
            ]);
            // Cells follow their header.
            expect(cellsOfColumn('editor.visualExplain.loops')).toEqual(['4']);
            expect(cellsOfColumn('editor.visualExplain.nodeType')[0]).toContain('Seq Scan');
        });

        it('moves a column to where its header is dropped', () => {
            const onColumnOrderChange = vi.fn();
            renderTable({onColumnOrderChange});
            layOutHeaders();

            // Loops (6th movable column, x 500-599) onto Cost (3rd, x 200-299).
            fireEvent.mouseDown(headerButton('editor.visualExplain.loops'), {
                button: 0,
                clientX: 550,
                clientY: 10,
            });
            fireEvent.mouseMove(document, {clientX: 400, clientY: 12});
            fireEvent.mouseMove(document, {clientX: 250, clientY: 12});
            fireEvent.mouseUp(document, {clientX: 250, clientY: 12});

            const expected = [
                'operation',
                'relation',
                'loops',
                'cost',
                'estRows',
                'actualRows',
                'selfTime',
                'estimateGap',
                'filter',
            ];
            expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
            expect(onColumnOrderChange).toHaveBeenCalledWith(expected);
            // Without a controlled order the view keeps the new one itself.
            expect(headerNames().slice(1, 5)).toEqual([
                'editor.visualExplain.nodeType',
                'editor.visualExplain.relation',
                'editor.visualExplain.loops',
                'editor.visualExplain.cost',
            ]);
        });

        it('treats a click on a header as a click, not a move', () => {
            const onColumnOrderChange = vi.fn();
            renderTable({onColumnOrderChange});
            layOutHeaders();

            fireEvent.mouseDown(headerButton('editor.visualExplain.loops'), {
                button: 0,
                clientX: 550,
                clientY: 10,
            });
            fireEvent.mouseMove(document, {clientX: 552, clientY: 11});
            fireEvent.mouseUp(document, {clientX: 552, clientY: 11});

            expect(onColumnOrderChange).not.toHaveBeenCalled();
        });

        it('keeps the order when a header is dropped outside the headers', () => {
            const onColumnOrderChange = vi.fn();
            renderTable({onColumnOrderChange});
            layOutHeaders();

            fireEvent.mouseDown(headerButton('editor.visualExplain.cost'), {
                button: 0,
                clientX: 250,
                clientY: 10,
            });
            fireEvent.mouseMove(document, {clientX: 5000, clientY: 10});
            fireEvent.mouseUp(document, {clientX: 5000, clientY: 10});

            expect(onColumnOrderChange).not.toHaveBeenCalled();
        });

        it('ignores drags with buttons other than the main one', () => {
            const onColumnOrderChange = vi.fn();
            renderTable({onColumnOrderChange});
            layOutHeaders();

            fireEvent.mouseDown(headerButton('editor.visualExplain.loops'), {
                button: 2,
                clientX: 550,
                clientY: 10,
            });
            fireEvent.mouseMove(document, {clientX: 250, clientY: 10});
            fireEvent.mouseUp(document, {clientX: 250, clientY: 10});

            expect(onColumnOrderChange).not.toHaveBeenCalled();
        });

        it('moves the focused column with Alt+Left and Alt+Right', () => {
            const onColumnOrderChange = vi.fn();
            renderTable({onColumnOrderChange});

            fireEvent.keyDown(headerButton('editor.visualExplain.cost'), {
                key: 'ArrowLeft',
                altKey: true,
            });
            expect(onColumnOrderChange).toHaveBeenLastCalledWith([
                'operation',
                'cost',
                'relation',
                'estRows',
                'actualRows',
                'loops',
                'selfTime',
                'estimateGap',
                'filter',
            ]);

            fireEvent.keyDown(headerButton('editor.visualExplain.cost'), {
                key: 'ArrowRight',
                altKey: true,
            });
            expect(onColumnOrderChange).toHaveBeenLastCalledWith([...EXPLAIN_TABLE_COLUMNS]);

            // Arrows without Alt and Alt+Left on the first column change nothing.
            onColumnOrderChange.mockClear();
            fireEvent.keyDown(headerButton('editor.visualExplain.cost'), {key: 'ArrowLeft'});
            fireEvent.keyDown(headerButton('editor.visualExplain.nodeType'), {
                key: 'ArrowLeft',
                altKey: true,
            });
            expect(onColumnOrderChange).not.toHaveBeenCalled();
        });

        it('skips columns hidden for estimate-only plans when moving with the keyboard', () => {
            const onColumnOrderChange = vi.fn();
            renderTable({plan: makePlan(), onColumnOrderChange});

            // Est. Rows is followed by Actual Rows and Loops, both hidden here.
            fireEvent.keyDown(headerButton('editor.visualExplain.estRows'), {
                key: 'ArrowRight',
                altKey: true,
            });

            expect(onColumnOrderChange).toHaveBeenCalledWith([
                'operation',
                'relation',
                'cost',
                'actualRows',
                'loops',
                'selfTime',
                'estRows',
                'estimateGap',
                'filter',
            ]);
        });

        it('offers a reset only once the order was changed', () => {
            const onColumnOrderChange = vi.fn();
            renderTable({onColumnOrderChange});
            expect(
                screen.queryByRole('button', {name: 'editor.visualExplain.resetColumnOrder'}),
            ).toBeNull();

            fireEvent.keyDown(headerButton('editor.visualExplain.filter'), {
                key: 'ArrowLeft',
                altKey: true,
            });
            fireEvent.click(
                screen.getByRole('button', {name: 'editor.visualExplain.resetColumnOrder'}),
            );

            expect(onColumnOrderChange).toHaveBeenLastCalledWith(EXPLAIN_TABLE_COLUMNS);
            expect(headerNames().at(-1)).toBe('editor.visualExplain.filter');
            expect(
                screen.queryByRole('button', {name: 'editor.visualExplain.resetColumnOrder'}),
            ).toBeNull();
        });
    });
});

function headerNames(): string[] {
    return screen.getAllByRole('columnheader').map((header) => header.textContent ?? '');
}

/** Text of every body cell under the header named `name`, top to bottom. */
function cellsOfColumn(name: string): string[] {
    const index = headerNames().indexOf(name);
    return Array.from(document.querySelectorAll('tbody tr')).map(
        (row) => row.querySelectorAll('td')[index]?.textContent ?? '',
    );
}
