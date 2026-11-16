import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {DumpDatabaseModal} from '@/components/modals/DumpDatabaseModal';
import {useDatabase} from '@/hooks/useDatabase';

const mocks = vi.hoisted(() => ({
    call: vi.fn().mockResolvedValue(null),
    chooseSaveTarget: vi.fn().mockResolvedValue({reference: '/tmp/backup.bin'}),
}));
vi.mock('lucide-react', (importOriginal) => importOriginal());

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: vi.fn(),
}));

vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: vi.fn()}),
}));

function mockUseDatabase(overrides: Partial<ReturnType<typeof useDatabase>>) {
    vi.mocked(useDatabase).mockReturnValue({
        activeSchema: null,
        activeCapabilities: null,
        databaseDataMap: {},
        nestedDatabaseDataMap: {},
        refreshDatabaseData: vi.fn(),
        refreshNestedSchemaData: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useDatabase>);
}

describe('DumpDatabaseModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.call.mockResolvedValue(null);
    });

    it('exports the entire native backup without applying table or SQL-only selections', async () => {
        mocks.call.mockImplementation(async (command) =>
            command === 'get_database_sql_capabilities'
                ? {
                      format: 'sql',
                      native_backup: {
                          format: 'opaque',
                          extension: 'bin',
                          label: 'Opaque backup (.bin)',
                          description: 'Whole-file plugin backup',
                      },
                      create_database: true,
                      requires_empty_target: true,
                      target_label: 'Path',
                  }
                : null,
        );
        mockUseDatabase({});
        render(
            <DumpDatabaseModal
                isOpen
                onClose={vi.fn()}
                connectionId="plugin"
                databaseName="example"
                tables={['ONE_TABLE']}
            />,
        );
        fireEvent.change(await screen.findByRole('combobox'), {target: {value: 'opaque'}});
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.getByText('Whole-file plugin backup')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: /export/i}));
        await waitFor(() =>
            expect(mocks.call).toHaveBeenCalledWith(
                'dump_database',
                expect.objectContaining({
                    options: {format: 'opaque', structure: true, data: true},
                }),
                expect.any(Object),
            ),
        );
        expect(mocks.chooseSaveTarget).toHaveBeenCalledWith(
            expect.objectContaining({
                filters: [{name: 'Opaque backup (.bin)', extensions: ['bin']}],
            }),
        );
    });

    it("refreshes the nested schema's table list on open for a schema-based (nested multi-db) dump", () => {
        const refreshNestedSchemaData = vi.fn();
        const refreshDatabaseData = vi.fn();
        mockUseDatabase({
            activeCapabilities: {schemas: true},
            nestedDatabaseDataMap: {
                analytics: {
                    schemas: ['public'],
                    schemasLoaded: true,
                    isLoadingSchemas: false,
                    selectedSchemas: ['public'],
                    activeSchema: 'public',
                    needsSchemaSelection: false,
                    schemaDataMap: {},
                },
            },
            refreshDatabaseData,
            refreshNestedSchemaData,
        });

        render(
            <DumpDatabaseModal
                isOpen
                onClose={vi.fn()}
                connectionId="conn-1"
                databaseName="analytics"
                tables={[]}
                schema="public"
                database="analytics"
            />,
        );

        expect(refreshNestedSchemaData).toHaveBeenCalledWith('analytics', 'public', 'conn-1');
        expect(refreshDatabaseData).not.toHaveBeenCalled();
    });

    it("refreshes the flat multi-db database's table list on open, not the nested loader", () => {
        const refreshNestedSchemaData = vi.fn();
        const refreshDatabaseData = vi.fn();
        mockUseDatabase({
            activeCapabilities: {
                schemas: false,
                file_based: false,
                folder_based: false,
            },
            databaseDataMap: {},
            refreshDatabaseData,
            refreshNestedSchemaData,
        });

        render(
            <DumpDatabaseModal
                isOpen
                onClose={vi.fn()}
                connectionId="conn-1"
                databaseName="sales_db"
                tables={[]}
            />,
        );

        expect(refreshDatabaseData).toHaveBeenCalledWith('sales_db');
        expect(refreshNestedSchemaData).not.toHaveBeenCalled();
    });
});

vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call: mocks.call, subscribe: async () => () => {}};
    return {useTabularisClient: () => client};
});

vi.mock('@/hooks/usePlatformCapabilities', () => {
    const platform = {
        negotiation: {environment: 'tauri'},
        chooseSaveTarget: mocks.chooseSaveTarget,
    };
    return {usePlatformCapabilities: () => platform};
});
