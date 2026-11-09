import {StrictMode} from 'react';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DebugRoutineModal} from '@/components/modals/DebugRoutineModal';

const {call, guard, clientState} = vi.hoisted(() => {
    const call = vi.fn();
    return {call, guard: vi.fn(), clientState: {current: {call}}};
});
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => clientState.current}));
vi.mock('@/hooks/useProductionGuard', () => ({useProductionGuard: () => guard}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));

const target = {
    database: 'FREEPDB1',
    schema: 'APP',
    name: 'TEST',
    routine_type: 'PROCEDURE',
    identity_args: '1',
};
const preview = {
    kind: 'preview',
    version: 1,
    preview_id: 'preview',
    target,
    arguments: [],
    source: {state: 'unavailable', reason: 'No source'},
    warnings: ['May commit'],
};

describe('routine debugger execution safety', () => {
    it('allows an explicit close after cleanup cannot be confirmed', async () => {
        const onClose = vi.fn();
        render(
            <DebugRoutineModal
                connectionId="oracle"
                routine={{name: 'TEST', routine_type: 'PROCEDURE'}}
                schema="APP"
                database="FREEPDB1"
                onClose={onClose}
            />,
        );
        await waitFor(() =>
            expect(screen.getByRole('button', {name: 'routineDebug.preview'})).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.preview'}));
        await screen.findByText('May commit');
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.start'}));
        const close = await screen.findByRole('button', {name: 'routineDebug.closeUnconfirmed'});
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(close);
        expect(onClose).toHaveBeenCalledOnce();
        expect(
            call.mock.calls.filter(([, request]) => request.command?.action === 'start'),
        ).toHaveLength(1);
    });
    beforeEach(() => {
        clientState.current = {call};
        call.mockReset();
        guard.mockReset();
        guard.mockResolvedValue(true);
        call.mockImplementation(async (method: string, request: {command?: {action: string}}) => {
            if (method === 'get_routine_parameters') return [];
            if (request.command?.action === 'preview') return preview;
            throw new Error('native connection lost');
        });
    });
    afterEach(cleanup);

    it.each([false, true])(
        'stops a late preview after close (replace client: %s)',
        async (replaceClient) => {
            let resolvePreview!: (value: typeof preview) => void;
            const pendingPreview = new Promise<typeof preview>((resolve) => {
                resolvePreview = resolve;
            });
            call.mockImplementation((method: string) =>
                method === 'get_routine_parameters' ? Promise.resolve([]) : pendingPreview,
            );
            const onClose = vi.fn();
            const modal = (connectionId: string) => (
                <StrictMode>
                    <DebugRoutineModal
                        connectionId={connectionId}
                        routine={{name: 'TEST', routine_type: 'PROCEDURE'}}
                        schema="APP"
                        database="FREEPDB1"
                        onClose={onClose}
                    />
                </StrictMode>
            );
            const {rerender, unmount} = render(modal('oracle'));
            await waitFor(() =>
                expect(screen.getByRole('button', {name: 'routineDebug.preview'})).toBeEnabled(),
            );
            fireEvent.click(screen.getByRole('button', {name: 'routineDebug.preview'}));
            const latestCall = replaceClient ? vi.fn().mockResolvedValue([]) : call;
            if (replaceClient) {
                clientState.current = {call: latestCall};
                rerender(modal('other-connection'));
            }
            fireEvent.click(screen.getByRole('button', {name: 'common.close'}));
            expect(onClose).toHaveBeenCalledOnce();
            unmount();
            expect(
                latestCall.mock.calls.filter(([, request]) => request.command?.action === 'stop'),
            ).toHaveLength(0);
            await act(async () => resolvePreview(preview));
            expect(latestCall).toHaveBeenCalledWith('routine_debug', {
                connectionId: 'oracle',
                version: 1,
                command: {action: 'stop', session_id: 'preview'},
            });
            expect(
                latestCall.mock.calls.filter(([, request]) => request.command?.action === 'stop'),
            ).toHaveLength(1);
            if (replaceClient)
                expect(
                    call.mock.calls.filter(([, request]) => request.command?.action === 'stop'),
                ).toHaveLength(0);
        },
    );

    it('requires preview and explicit start, retaining stop after an uncertain start', async () => {
        render(
            <DebugRoutineModal
                connectionId="oracle"
                routine={{name: 'TEST', routine_type: 'PROCEDURE', identity_args: '1'}}
                schema="APP"
                database="FREEPDB1"
                onClose={vi.fn()}
            />,
        );
        await waitFor(() =>
            expect(screen.getByRole('button', {name: 'routineDebug.preview'})).toBeEnabled(),
        );
        expect(call).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', {name: 'routineDebug.start'})).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.preview'}));
        await screen.findByText('May commit');
        expect(
            call.mock.calls.filter(([, request]) => request.command?.action === 'start'),
        ).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.start'}));
        await screen.findByRole('alert');
        expect(guard).toHaveBeenCalledWith('oracle');
        expect(screen.getByRole('button', {name: 'routineDebug.start'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'routineDebug.stop'})).toBeEnabled();
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.status'}));
        await waitFor(() =>
            expect(
                call.mock.calls.filter(([, request]) => request.command?.action === 'status'),
            ).toHaveLength(1),
        );
        expect(
            call.mock.calls.filter(([, request]) => request.command?.action === 'start'),
        ).toHaveLength(1);
    });

    it('preserves production cancellation without sending start', async () => {
        guard.mockResolvedValue(false);
        render(
            <DebugRoutineModal
                connectionId="oracle"
                routine={{name: 'TEST', routine_type: 'PROCEDURE'}}
                schema="APP"
                database="FREEPDB1"
                onClose={vi.fn()}
            />,
        );
        await waitFor(() =>
            expect(screen.getByRole('button', {name: 'routineDebug.preview'})).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.preview'}));
        await screen.findByText('May commit');
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.start'}));
        await waitFor(() => expect(guard).toHaveBeenCalled());
        expect(
            call.mock.calls.filter(([, request]) => request.command?.action === 'start'),
        ).toHaveLength(0);
    });

    it('keeps a live session on client replacement and uses the latest client on unmount', async () => {
        const modal = (
            <DebugRoutineModal
                connectionId="oracle"
                routine={{name: 'TEST', routine_type: 'PROCEDURE'}}
                schema="APP"
                database="FREEPDB1"
                onClose={vi.fn()}
            />
        );
        const {rerender, unmount} = render(modal);
        await waitFor(() =>
            expect(screen.getByRole('button', {name: 'routineDebug.preview'})).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.preview'}));
        await screen.findByText('May commit');
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.start'}));
        await screen.findByRole('alert');
        const latestCall = vi.fn(call.getMockImplementation());
        clientState.current = {call: latestCall};
        rerender(
            <DebugRoutineModal
                connectionId="oracle"
                routine={{name: 'TEST', routine_type: 'PROCEDURE'}}
                schema="APP"
                database="FREEPDB1"
                onClose={vi.fn()}
            />,
        );
        await waitFor(() =>
            expect(latestCall).toHaveBeenCalledWith('get_routine_parameters', expect.anything()),
        );
        expect(
            call.mock.calls.filter(([, request]) => request.command?.action === 'stop'),
        ).toHaveLength(0);
        expect(
            latestCall.mock.calls.filter(([, request]) => request.command?.action === 'stop'),
        ).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', {name: 'routineDebug.status'}));
        await waitFor(() =>
            expect(latestCall).toHaveBeenCalledWith(
                'routine_debug',
                expect.objectContaining({command: {action: 'status', session_id: 'preview'}}),
            ),
        );
        unmount();
        expect(
            latestCall.mock.calls.filter(([, request]) => request.command?.action === 'stop'),
        ).toHaveLength(1);
    });
});
