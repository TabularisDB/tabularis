import {describe, expect, it, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import {PluginDataGrid} from '@/components/plugins/PluginDataGrid';

const {grid} = vi.hoisted(() => ({grid: vi.fn()}));
vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: (props: unknown) => {
        grid(props);
        return <div>Native grid</div>;
    },
}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({
        settings: {copyFormat: 'json', csvDelimiter: ';', csvIncludeHeaders: false},
    }),
}));

describe('PluginDataGrid', () => {
    it('uses the native grid in a bounded read-only region with copy preferences and no mutations', async () => {
        const columns = ['id'];
        const rows = [[1]];
        render(
            <PluginDataGrid
                columns={columns}
                rows={rows}
                connectionId="connection-1"
                label="Accounts"
            />,
        );
        await waitFor(() => expect(screen.getByText('Native grid')).toBeInTheDocument());
        const region = screen.getByRole('region', {name: 'Accounts'});
        expect(region).toHaveClass('min-h-0');
        expect(parseFloat(region.style.height)).toBeLessThan(150);
        expect(grid).toHaveBeenLastCalledWith({
            columns,
            data: rows,
            connectionId: 'connection-1',
            readonly: true,
            tableName: null,
            copyFormat: 'json',
            csvDelimiter: ';',
            csvIncludeHeaders: false,
        });
    });
});
