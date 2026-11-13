import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {DatabaseOperationModal} from '@/components/modals/DatabaseOperationModal';

const {call} = vi.hoisted(() => ({call: vi.fn()}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => ({call})}));

const mount = (operation: 'drop' | 'empty' | 'truncate' = 'drop') => {
    const onClose = vi.fn();
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    render(
        <DatabaseOperationModal
            isOpen
            connectionId="connection"
            database="quoted db"
            operation={operation}
            onClose={onClose}
            onSuccess={onSuccess}
        />,
    );
    return {onClose, onSuccess};
};

beforeEach(() => {
    call.mockReset();
});

describe('DatabaseOperationModal', () => {
    it.each(['drop', 'empty', 'truncate'] as const)(
        'requires exact confirmation and routes %s to the selected database',
        async (operation) => {
            call.mockResolvedValue(undefined);
            const {onClose, onSuccess} = mount(operation);
            const input = screen.getByRole('textbox');
            const button = screen.getAllByRole('button').at(-1)!;
            expect(button).toBeDisabled();
            fireEvent.change(input, {target: {value: 'quoted db '}});
            expect(button).toBeDisabled();
            fireEvent.change(input, {target: {value: 'quoted db'}});
            fireEvent.click(button);
            await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
            expect(onClose).toHaveBeenCalledOnce();
            expect(call).toHaveBeenCalledWith('database_operation', {
                connectionId: 'connection',
                database: 'quoted db',
                operation,
                confirmation: 'quoted db',
            });
        },
    );

    it('shows a server error and leaves the modal available without reporting success', async () => {
        call.mockRejectedValue(new Error('Permission denied'));
        const {onClose, onSuccess} = mount();
        fireEvent.change(screen.getByRole('textbox'), {target: {value: 'quoted db'}});
        fireEvent.click(screen.getAllByRole('button').at(-1)!);
        expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
        expect(onClose).not.toHaveBeenCalled();
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('blocks a second submission and closing while the server is working', async () => {
        call.mockReturnValue(new Promise(() => {}));
        const {onClose} = mount();
        fireEvent.change(screen.getByRole('textbox'), {target: {value: 'quoted db'}});
        fireEvent.click(screen.getAllByRole('button').at(-1)!);
        expect(screen.getByRole('textbox')).toBeDisabled();
        fireEvent.click(screen.getAllByRole('button').at(-1)!);
        fireEvent.keyDown(document, {key: 'Escape'});
        expect(call).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });
});
