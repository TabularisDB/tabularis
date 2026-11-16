import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {ExplainSnapshotsModal} from '@/components/explain/ExplainSnapshotsModal';
import type {ExplainSnapshot, ExplainPlan} from '@tabularis/explain';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, defaultValue?: string) => defaultValue || key,
    }),
}));

describe('ExplainSnapshotsModal', () => {
    const mockPlan: ExplainPlan = {
        format: 'postgres',
        driver: 'postgres',
        summary: {
            planning_time_ms: 1,
            execution_time_ms: 20,
            total_cost: 150,
            actual_rows: 50,
        },
        root: {
            id: 'root-1',
            name: 'Seq Scan',
            cost: {startup: 0, total: 150},
            rows: {estimated: 50, actual: 50},
            actual_loops: 1,
            children: [],
        },
    };

    const mockSnapshots: ExplainSnapshot[] = [
        {
            id: 'snap-1',
            name: 'Initial baseline',
            createdAt: '2026-11-07T10:00:00.000Z',
            sql: 'SELECT * FROM users',
            context: {engine: 'postgres'},
            hasAnalyzeData: true,
            planningTimeMs: 1,
            executionTimeMs: 20,
            totalCost: 150,
            rawOutput: null,
            plan: mockPlan,
            isPinned: false,
        },
        {
            id: 'snap-2',
            name: 'Pinned MySQL plan',
            createdAt: '2026-11-07T10:05:00.000Z',
            sql: 'SELECT * FROM accounts',
            context: {engine: 'mysql'},
            hasAnalyzeData: false,
            planningTimeMs: null,
            executionTimeMs: null,
            totalCost: 80,
            rawOutput: null,
            plan: {...mockPlan, driver: 'mysql'},
            isPinned: true,
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders snapshot list and saves a new snapshot', () => {
        const onSaveCurrent = vi.fn();
        const onClose = vi.fn();
        const onSelectBaseline = vi.fn();
        const onTogglePinSnapshot = vi.fn();
        const onDeleteSnapshot = vi.fn();

        render(
            <ExplainSnapshotsModal
                isOpen={true}
                onClose={onClose}
                snapshots={mockSnapshots}
                currentBaselineId={null}
                onSelectBaseline={onSelectBaseline}
                onSaveCurrent={onSaveCurrent}
                onTogglePinSnapshot={onTogglePinSnapshot}
                onDeleteSnapshot={onDeleteSnapshot}
                canSaveCurrent={true}
            />,
        );

        expect(screen.getByText('Initial baseline')).toBeInTheDocument();
        expect(screen.getByText('Pinned MySQL plan')).toBeInTheDocument();

        // Dialog accessibility attributes
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby');

        // Input accessible label
        const input = screen.getByLabelText(/Snapshot name/i);
        fireEvent.change(input, {target: {value: 'My New Snapshot'}});
        fireEvent.click(screen.getByRole('button', {name: /Save Snapshot/i}));

        expect(onSaveCurrent).toHaveBeenCalledWith('My New Snapshot');
    });

    it('handles baseline selection, pin toggle, and delete with accessible controls', () => {
        const onSelectBaseline = vi.fn();
        const onTogglePinSnapshot = vi.fn();
        const onDeleteSnapshot = vi.fn();
        const onClose = vi.fn();

        render(
            <ExplainSnapshotsModal
                isOpen={true}
                onClose={onClose}
                snapshots={mockSnapshots}
                currentBaselineId="snap-1"
                onSelectBaseline={onSelectBaseline}
                onSaveCurrent={vi.fn()}
                onTogglePinSnapshot={onTogglePinSnapshot}
                onDeleteSnapshot={onDeleteSnapshot}
                canSaveCurrent={true}
            />,
        );

        // Active baseline should show Selected
        expect(screen.getByText(/Selected/i)).toBeInTheDocument();

        // Pin toggle on snap-1 (snap-1 is unpinned, aria-label is "Pin")
        const pinButton = screen.getByRole('button', {name: 'Pin'});
        fireEvent.click(pinButton);
        expect(onTogglePinSnapshot).toHaveBeenCalledWith('snap-1');

        // Delete snap-1
        const deleteButtons = screen.getAllByRole('button', {name: 'Delete'});
        fireEvent.click(deleteButtons[0]);
        expect(onDeleteSnapshot).toHaveBeenCalledWith('snap-1');

        // Close button
        const closeButton = screen.getByRole('button', {name: 'Close'});
        fireEvent.click(closeButton);
        expect(onClose).toHaveBeenCalled();
    });

    it('supports escape key dismissal via shared Modal', () => {
        const onClose = vi.fn();

        render(
            <ExplainSnapshotsModal
                isOpen={true}
                onClose={onClose}
                snapshots={[]}
                currentBaselineId={null}
                onSelectBaseline={vi.fn()}
                onSaveCurrent={vi.fn()}
                onTogglePinSnapshot={vi.fn()}
                onDeleteSnapshot={vi.fn()}
                canSaveCurrent={false}
            />,
        );

        fireEvent.keyDown(window, {key: 'Escape'});
        expect(onClose).toHaveBeenCalled();
    });
});
