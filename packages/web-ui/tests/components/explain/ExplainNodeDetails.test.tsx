import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ExplainDiagnostic, ExplainNode} from '@tabularis/explain';
import {ExplainNodeDetails} from '@tabularis/explain/react';

vi.unmock('lucide-react');

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: string | {defaultValue?: string}) => {
            if (key === 'probeDescription') return 'A scan dominates execution time';
            return typeof options === 'string' ? options : (options?.defaultValue ?? key);
        },
    }),
}));

afterEach(cleanup);

const node: ExplainNode = {
    id: 'scan-a',
    node_type: 'Seq Scan',
    relation: 'orders',
    startup_cost: 0,
    total_cost: 12,
    plan_rows: 10,
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
};

describe('ExplainNodeDetails copy feedback', () => {
    it('renders diagnostics once and includes them in copied details', async () => {
        const diagnostic: ExplainDiagnostic = {
            kind: 'hotspot',
            severity: 'warning',
            labelKey: 'probeDiagnostic',
            descriptionKey: 'probeDescription',
            value: '75%',
        };
        const copy = vi.fn().mockResolvedValue(true);
        render(
            <ExplainNodeDetails
                node={node}
                hasAnalyzeData={false}
                diagnostics={[diagnostic]}
                onCopyDetails={copy}
            />,
        );
        expect(screen.getAllByText('Diagnostics')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', {name: 'Copy Details'}));
        await waitFor(() => expect(copy).toHaveBeenCalledOnce());
        expect(copy.mock.calls[0][0]).toContain('Diagnostics');
        expect(copy.mock.calls[0][0]).toContain('A scan dominates execution time');
    });

    it('shows copy feedback for the selected node and resets it when selection changes', async () => {
        const copy = vi.fn().mockResolvedValue(true);
        const {rerender} = render(
            <ExplainNodeDetails node={node} hasAnalyzeData={false} onCopyDetails={copy} />,
        );
        fireEvent.click(screen.getByRole('button', {name: 'Copy Details'}));
        await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
        rerender(
            <ExplainNodeDetails
                node={{...node, id: 'scan-b'}}
                hasAnalyzeData={false}
                onCopyDetails={copy}
            />,
        );
        expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    });
});
