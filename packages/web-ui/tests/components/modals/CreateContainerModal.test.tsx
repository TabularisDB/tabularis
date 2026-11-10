import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {CreateContainerModal} from '@/components/modals/CreateContainerModal';
import type {DriverCapabilities} from '@/types/plugins';

const clientMock = vi.hoisted(() => ({call: vi.fn()}));
const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: translateMock}),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => clientMock,
}));

const postgresCaps: DriverCapabilities = {
    schemas: true,
    views: true,
    routines: true,
    file_based: false,
    folder_based: false,
    identifier_quote: '"',
    alter_primary_key: true,
    sql_dialect: 'postgres',
};

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        activeConnectionId: 'conn-1',
        activeDriver: 'postgres',
        activeCapabilities: postgresCaps,
    }),
}));

vi.mock('@/components/ui/Modal', () => ({
    Modal: ({isOpen, children}: {isOpen: boolean; children: React.ReactNode}) =>
        isOpen ? <div data-testid="modal">{children}</div> : null,
}));

describe('CreateContainerModal', () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    beforeEach(() => {
        clientMock.call.mockReset();
        clientMock.call.mockResolvedValue({rows: [], columns: []});
        onClose.mockReset();
        onSuccess.mockReset();
        onSuccess.mockResolvedValue(undefined);
    });

    it('runs CREATE DATABASE with a quoted name, then notifies the parent', async () => {
        render(
            <CreateContainerModal isOpen kind="database" onClose={onClose} onSuccess={onSuccess} />,
        );

        fireEvent.change(screen.getByLabelText('createDatabase.name'), {
            target: {value: ' analytics '},
        });
        expect(screen.getByText('CREATE DATABASE "analytics"')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: 'createDatabase.create'}));

        await waitFor(() => {
            expect(clientMock.call).toHaveBeenCalledWith('execute_query', {
                connectionId: 'conn-1',
                query: 'CREATE DATABASE "analytics"',
            });
        });
        await waitFor(() => {
            expect(onSuccess).toHaveBeenCalledWith('analytics');
            expect(onClose).toHaveBeenCalled();
        });
    });

    it('scopes CREATE SCHEMA to the nested target database', async () => {
        render(
            <CreateContainerModal
                isOpen
                kind="schema"
                database="shop"
                onClose={onClose}
                onSuccess={onSuccess}
            />,
        );

        fireEvent.change(screen.getByLabelText('createSchema.name'), {
            target: {value: 'store'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'createSchema.create'}));

        await waitFor(() => {
            expect(clientMock.call).toHaveBeenCalledWith('execute_query', {
                connectionId: 'conn-1',
                query: 'CREATE SCHEMA "store"',
                database: 'shop',
            });
        });
    });

    it('keeps the dialog open and shows the server error when CREATE fails', async () => {
        clientMock.call.mockRejectedValue(new Error('permission denied'));

        render(
            <CreateContainerModal isOpen kind="database" onClose={onClose} onSuccess={onSuccess} />,
        );

        fireEvent.change(screen.getByLabelText('createDatabase.name'), {
            target: {value: 'blocked'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'createDatabase.create'}));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'createDatabase.failCreatepermission denied',
        );
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('disables create while the name is empty', () => {
        render(
            <CreateContainerModal isOpen kind="schema" onClose={onClose} onSuccess={onSuccess} />,
        );

        expect(screen.getByRole('button', {name: 'createSchema.create'})).toBeDisabled();
    });
});
