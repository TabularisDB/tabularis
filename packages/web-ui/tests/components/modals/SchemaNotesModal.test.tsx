import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SchemaNotesModal} from '@/components/modals/SchemaNotesModal';
import type {SchemaNotesState} from '@/types/schemaNotes';

const {client, platform} = vi.hoisted(() => ({
    client: {call: vi.fn()},
    platform: {
        chooseInputFile: vi.fn(),
        readInputFile: vi.fn(),
        downloadFile: vi.fn(),
    },
}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => client}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({usePlatformCapabilities: () => platform}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key,
    }),
}));

const stored: SchemaNotesState = {
    projectNote: 'Shop',
    includeInAiContext: false,
    notes: [
        {schema: 'public', table: 'orders', domain: 'Billing', note: 'One row per checkout'},
        {schema: 'public', table: 'orders', column: 'legacy', note: 'removed last year'},
        {schema: 'archive', table: 'orders', note: 'Archived orders'},
    ],
};

function backend(overrides: Record<string, (request: Record<string, unknown>) => unknown> = {}) {
    client.call.mockImplementation(async (command: string, request: Record<string, unknown>) => {
        if (overrides[command]) return overrides[command](request);
        switch (command) {
            case 'get_schema_notes':
                return stored;
            case 'get_columns':
                return request.schema === 'public'
                    ? [
                          {
                              name: 'id',
                              data_type: 'int',
                              is_pk: true,
                              is_nullable: false,
                              is_auto_increment: true,
                          },
                          {
                              name: 'status',
                              data_type: 'int',
                              is_pk: false,
                              is_nullable: false,
                              is_auto_increment: false,
                              comment: 'status code',
                          },
                      ]
                    : [];
            case 'get_tables':
                return request.schema === 'public'
                    ? [{name: 'orders', comment: 'Customer orders'}]
                    : [];
            default:
                return stored;
        }
    });
}

const target = {connectionId: 'conn-1', tableName: 'orders', schema: 'public'};

function renderModal() {
    return render(
        <SchemaNotesModal isOpen onClose={vi.fn()} target={target} connectionName="Shop DB" />,
    );
}

describe('SchemaNotesModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        backend();
    });

    it('shows local notes next to separate database comments and keeps notes of missing columns', async () => {
        renderModal();
        expect(await screen.findByDisplayValue('One row per checkout')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Billing')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Shop')).toBeInTheDocument();
        expect(await screen.findByText('Customer orders')).toBeInTheDocument();
        expect(screen.getByText('status code')).toBeInTheDocument();
        expect(screen.getAllByText('schemaNotes.databaseComment')).toHaveLength(2);
        expect(screen.getByDisplayValue('removed last year')).toBeInTheDocument();
        expect(screen.getByText('schemaNotes.columnNotFound')).toBeInTheDocument();
    });

    it('does not report documented columns as missing when only the columns fail to load', async () => {
        backend({
            get_columns: () => {
                throw new Error('permission denied for table orders');
            },
        });
        renderModal();
        expect(await screen.findByDisplayValue('removed last year')).toBeInTheDocument();
        expect(await screen.findByText('schemaNotes.metadataUnavailable')).toBeInTheDocument();
        expect(screen.getByText('Customer orders')).toBeInTheDocument();
        expect(screen.queryByText('schemaNotes.columnNotFound')).not.toBeInTheDocument();
        expect(screen.queryByText('schemaNotes.tableNotFound')).not.toBeInTheDocument();
    });

    it('saves only changed notes with the qualified identity', async () => {
        renderModal();
        const status = await screen.findByRole('textbox', {
            name: 'schemaNotes.columnNote:{"column":"status"}',
        });
        fireEvent.change(status, {target: {value: '4 means payment captured'}});
        fireEvent.click(screen.getByRole('button', {name: 'schemaNotes.save'}));
        await screen.findByText('schemaNotes.saved');
        const saves = client.call.mock.calls.filter(([command]) => command === 'set_schema_note');
        expect(saves).toEqual([
            [
                'set_schema_note',
                {
                    connectionId: 'conn-1',
                    target: {schema: 'public', table: 'orders', column: 'status'},
                    domain: null,
                    note: '4 means payment captured',
                },
            ],
        ]);
    });

    it('browses a same-named table in another schema separately', async () => {
        renderModal();
        await screen.findByDisplayValue('One row per checkout');
        fireEvent.click(screen.getByRole('button', {name: 'archive.orders'}));
        expect(await screen.findByDisplayValue('Archived orders')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('One row per checkout')).toBeNull();
        expect(await screen.findByText('schemaNotes.tableNotFound')).toBeInTheDocument();
        await waitFor(() =>
            expect(client.call).toHaveBeenCalledWith('get_columns', {
                connectionId: 'conn-1',
                schema: 'archive',
                tableName: 'orders',
            }),
        );
    });

    it('reports an unreadable notes file and offers nothing that could overwrite it', async () => {
        backend({
            get_schema_notes: () => {
                throw new Error(
                    'The schema notes file /x.json could not be read and was left unchanged',
                );
            },
        });
        renderModal();
        expect(await screen.findByRole('alert')).toHaveTextContent('left unchanged');
        expect(screen.getByRole('button', {name: 'schemaNotes.save'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'schemaNotes.import'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'schemaNotes.export'})).toBeDisabled();
        expect(screen.getByRole('checkbox')).toBeDisabled();
    });

    it('turns the AI context on only when the user ticks it', async () => {
        renderModal();
        const checkbox = await screen.findByRole('checkbox');
        await waitFor(() => expect(checkbox).not.toBeDisabled());
        expect(checkbox).not.toBeChecked();
        expect(client.call.mock.calls.map(([command]) => command)).not.toContain(
            'set_schema_notes_ai_context',
        );
        backend({set_schema_notes_ai_context: () => ({...stored, includeInAiContext: true})});
        fireEvent.click(checkbox);
        await waitFor(() => expect(checkbox).toBeChecked());
        expect(client.call).toHaveBeenCalledWith('set_schema_notes_ai_context', {
            connectionId: 'conn-1',
            enabled: true,
        });
    });

    it('imports a chosen file and exports the sidecar through the platform', async () => {
        platform.chooseInputFile.mockResolvedValue({name: 'notes.json', reference: 'ref-1'});
        platform.readInputFile.mockResolvedValue(new TextEncoder().encode('{"format":"x"}'));
        platform.downloadFile.mockResolvedValue(true);
        backend({export_schema_notes: () => '{"format":"tabularis-schema-notes"}\n'});
        renderModal();
        await screen.findByDisplayValue('One row per checkout');

        fireEvent.click(screen.getByRole('button', {name: 'schemaNotes.import'}));
        await screen.findByText('schemaNotes.imported:{"name":"notes.json"}');
        expect(client.call).toHaveBeenCalledWith('import_schema_notes', {
            connectionId: 'conn-1',
            contents: '{"format":"x"}',
        });

        fireEvent.click(screen.getByRole('button', {name: 'schemaNotes.export'}));
        await waitFor(() => expect(platform.downloadFile).toHaveBeenCalled());
        const request = platform.downloadFile.mock.calls[0][0];
        expect(request.fileName).toBe('Shop_DB.tabularis-notes.json');
        expect(new TextDecoder().decode(request.contents)).toBe(
            '{"format":"tabularis-schema-notes"}\n',
        );
    });

    it('shows an import error without changing the notes', async () => {
        platform.chooseInputFile.mockResolvedValue({name: 'bad.json', reference: 'ref'});
        platform.readInputFile.mockResolvedValue(new TextEncoder().encode('nope'));
        backend({
            import_schema_notes: () => {
                throw new Error('Invalid schema notes document');
            },
        });
        renderModal();
        await screen.findByDisplayValue('One row per checkout');
        fireEvent.click(screen.getByRole('button', {name: 'schemaNotes.import'}));
        expect(await screen.findByRole('alert')).toHaveTextContent('Invalid schema notes document');
        expect(screen.getByDisplayValue('One row per checkout')).toBeInTheDocument();
    });

    it('previews notes as sanitized Markdown', async () => {
        backend({
            get_schema_notes: () => ({
                ...stored,
                notes: [
                    {
                        schema: 'public',
                        table: 'orders',
                        note: '**paid** <img src=x onerror="alert(1)"> [x](javascript:alert(1))',
                    },
                ],
            }),
        });
        const {container} = renderModal();
        await screen.findByDisplayValue(/paid/);
        fireEvent.click(screen.getByRole('button', {name: 'schemaNotes.preview'}));
        expect(await screen.findByText('paid')).toBeInTheDocument();
        expect(document.body.querySelector('img, a, [onerror]')).toBeNull();
        expect(container).toBeDefined();
    });
});
