import {useEffect, useState, type ReactNode} from 'react';
import {render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Edge, Node} from '@xyflow/react';
import {computeExplainMetrics, getPlanDiagnostics, type ExplainPlan} from '@tabularis/explain';
import {ExplainGraph} from '@tabularis/explain/react';

const mocks = vi.hoisted(() => {
    const fitView = vi.fn();
    // The hook result keeps its identity across renders, as React Flow's does.
    return {fitView, reactFlow: {fitView}};
});

vi.mock('lucide-react', () => vi.importActual('lucide-react'));

// React Flow measures the DOM, which jsdom cannot. The stand-in calls onInit
// once on mount, as React Flow does when its viewport is ready.
vi.mock('@xyflow/react', () => ({
    ReactFlowProvider: ({children}: {children: ReactNode}) => <>{children}</>,
    ReactFlow: ({onInit, children}: {onInit?: () => void; children?: ReactNode}) => {
        useEffect(() => {
            onInit?.();
        }, [onInit]);
        return <div>{children}</div>;
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    useNodesState: (initial: Node[]) => {
        const [nodes, setNodes] = useState(initial);
        return [nodes, setNodes, () => {}];
    },
    useEdgesState: (initial: Edge[]) => {
        const [edges, setEdges] = useState(initial);
        return [edges, setEdges, () => {}];
    },
    useReactFlow: () => mocks.reactFlow,
}));

const plan: ExplainPlan = {
    root: {
        id: 'root',
        node_type: 'Seq Scan',
        relation: 'users',
        startup_cost: null,
        total_cost: null,
        plan_rows: null,
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
    original_query: 'SELECT 1',
    driver: 'postgres',
    has_analyze_data: false,
    raw_output: null,
};

function renderGraph() {
    const metrics = computeExplainMetrics(plan);
    return render(
        <ExplainGraph
            plan={plan}
            metrics={metrics}
            diagnostics={getPlanDiagnostics(plan, metrics)}
            selectedNodeId={null}
            onSelectNode={vi.fn()}
        />,
    );
}

describe('ExplainGraph', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.fitView.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fits the view shortly after React Flow is ready', () => {
        renderGraph();
        expect(mocks.fitView).not.toHaveBeenCalled();

        vi.advanceTimersByTime(50);

        expect(mocks.fitView).toHaveBeenCalledTimes(1);
        expect(mocks.fitView).toHaveBeenCalledWith({padding: 0.2});
    });

    it('does not fit the view after the graph has unmounted', () => {
        const {unmount} = renderGraph();
        unmount();

        vi.advanceTimersByTime(50);

        expect(mocks.fitView).not.toHaveBeenCalled();
    });
});
