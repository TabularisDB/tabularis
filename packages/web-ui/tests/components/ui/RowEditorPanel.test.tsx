import {beforeEach, describe, expect, it, vi} from 'vitest';
import {screen, waitFor} from '@testing-library/react';
import {RowEditorPanel} from '@/components/ui/RowEditorPanel';
import {useDatabase} from '@/hooks/useDatabase';
import {renderWithSlotProbe} from '../../fixtures/pluginSlotProbe';

vi.mock('@/hooks/useDatabase', () => ({useDatabase: vi.fn()}));

const row = {id: 7};
const props = {
    onClose: vi.fn(),
    rowData: row,
    rowIndex: 0,
    isInsertion: false,
    columns: [{name: 'id', type: 'integer'}],
    onChange: vi.fn(),
    connectionId: 'pg-pane',
    tableName: 'users',
    schema: 'tenant',
    database: 'shop',
};
const slots = ['row-editor-sidebar.header.actions', 'row-editor-sidebar.field.after'] as const;

function setDatabase(activeDriver: string, includeTarget = true) {
    vi.mocked(useDatabase).mockReturnValue({
        activeDriver,
        activeConnectionId: 'mysql-pane',
        connectionDataMap: includeTarget ? {'pg-pane': {driver: 'postgres'}} : {},
    } as ReturnType<typeof useDatabase>);
}

describe('RowEditorPanel plugin context', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setDatabase('mysql');
    });

    it('renders PostgreSQL plugins for the row connection while MySQL is globally active', async () => {
        await renderWithSlotProbe(<RowEditorPanel {...props} />, [...slots]);
        const probes = await screen.findAllByTestId('postgres-slot');
        expect(probes).toHaveLength(2);
        for (const probe of probes) {
            expect(JSON.parse(probe.textContent ?? '{}')).toMatchObject({
                driver: 'postgres',
                connectionId: 'pg-pane',
                schema: 'tenant',
                tableName: 'users',
                database: 'shop',
                rowData: row,
                rowIndex: 0,
                isInsertion: false,
            });
        }
        expect(screen.queryByTestId('mysql-slot')).not.toBeInTheDocument();
    });

    it('keeps the row connection context when global focus changes', async () => {
        const {rerender} = await renderWithSlotProbe(<RowEditorPanel {...props} />, [...slots]);
        await screen.findAllByTestId('postgres-slot');
        setDatabase('sqlite');
        rerender(<RowEditorPanel {...props} />);
        expect(screen.getAllByTestId('postgres-slot')).toHaveLength(2);
        expect(screen.queryByTestId('mysql-slot')).not.toBeInTheDocument();
    });

    it('hides driver-filtered plugins when the row connection disappears', async () => {
        const {rerender} = await renderWithSlotProbe(<RowEditorPanel {...props} />, [...slots]);
        await screen.findAllByTestId('postgres-slot');
        setDatabase('mysql', false);
        rerender(<RowEditorPanel {...props} />);
        await waitFor(() => expect(screen.queryByTestId('postgres-slot')).not.toBeInTheDocument());
        expect(screen.queryByTestId('mysql-slot')).not.toBeInTheDocument();
    });

    it('does not borrow the active driver when the row has no connection', async () => {
        await renderWithSlotProbe(<RowEditorPanel {...props} connectionId={null} />, [...slots]);
        const probes = await screen.findAllByTestId('unfiltered-slot');
        expect(probes).toHaveLength(2);
        for (const probe of probes) {
            expect(JSON.parse(probe.textContent ?? '{}')).toMatchObject({
                driver: null,
                connectionId: null,
            });
        }
        expect(screen.queryByTestId('mysql-slot')).not.toBeInTheDocument();
        expect(screen.queryByTestId('postgres-slot')).not.toBeInTheDocument();
    });
});
