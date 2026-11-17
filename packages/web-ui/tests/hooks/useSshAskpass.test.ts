import {createElement, type ReactNode} from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {renderHook as renderHookBase, act, waitFor} from '@testing-library/react';
import {listen, type EventCallback} from '@tauri-apps/api/event';
import {invoke} from '@tauri-apps/api/core';
import {TabularisClient} from '@/api/client';
import {TauriTransport} from '@/api/transports/tauriTransport';
import {TabularisClientProvider} from '@/contexts/TabularisClientProvider';
import {useSshAskpass} from '@/hooks/useSshAskpass';
import type {SshAskpassRequest} from '@/types/askpass';

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(),
    emit: vi.fn(),
}));

const listenMock = vi.mocked(listen);
const invokeMock = vi.mocked(invoke);

describe('useSshAskpass', () => {
    let handlers: Record<string, EventCallback<unknown>>;
    const client = new TabularisClient(new TauriTransport());
    const wrapper = ({children}: {children: ReactNode}) =>
        createElement(TabularisClientProvider, {client}, children);
    const renderHook = <Result>(callback: () => Result) => renderHookBase(callback, {wrapper});

    beforeEach(() => {
        handlers = {};
        listenMock.mockReset();
        invokeMock.mockReset();
        listenMock.mockImplementation((event, handler) => {
            handlers[event as string] = handler as EventCallback<unknown>;
            return Promise.resolve(() => {});
        });
        invokeMock.mockResolvedValue(undefined);
    });

    const emitRequest = (payload: SshAskpassRequest) => {
        act(() => {
            handlers['ssh-askpass://request']({
                event: 'ssh-askpass://request',
                id: 1,
                payload,
            });
        });
    };

    const request = (overrides: Partial<SshAskpassRequest> = {}): SshAskpassRequest => ({
        id: 1,
        kind: 'secret',
        prompt: 'Enter PIN for key:',
        ...overrides,
    });

    it('starts with no pending prompt', () => {
        const {result} = renderHook(() => useSshAskpass());
        expect(result.current.current).toBeNull();
    });

    it('handles rejected subscriptions while mounted without unhandled rejections', async () => {
        const error = new Error('The session is not authorized for this event');
        listenMock.mockRejectedValue(error);
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const {result, unmount} = renderHook(() => useSshAskpass());
            await waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
            expect(logged).toHaveBeenCalledWith(
                'Failed to subscribe to SSH askpass requests:',
                expect.objectContaining({message: error.message}),
            );
            expect(logged).toHaveBeenCalledWith(
                'Failed to subscribe to SSH askpass dismissals:',
                expect.objectContaining({message: error.message}),
            );
            expect(result.current.current).toBeNull();
            unmount();
        } finally {
            logged.mockRestore();
        }
    });

    it('releases subscriptions that finish after unmount', async () => {
        const releases = [vi.fn(), vi.fn()];
        const resolveListeners: Array<(unlisten: () => void) => void> = [];
        listenMock.mockImplementation(
            () => new Promise((resolve) => resolveListeners.push(resolve)),
        );
        const {unmount} = renderHook(() => useSshAskpass());
        unmount();
        await act(async () => {
            resolveListeners.forEach((resolve, index) => resolve(releases[index]));
        });
        releases.forEach((release) => expect(release).toHaveBeenCalledOnce());
    });

    it('exposes a prompt received via the request event', () => {
        const {result} = renderHook(() => useSshAskpass());
        emitRequest(request());

        expect(result.current.current).toEqual(request());
    });

    it('shows prompts one at a time, oldest first', () => {
        const {result} = renderHook(() => useSshAskpass());
        emitRequest(request({id: 1, prompt: 'first'}));
        emitRequest(request({id: 2, prompt: 'second'}));

        expect(result.current.current?.id).toBe(1);
    });

    it('respond sends the answer to the backend and pops the prompt', async () => {
        const {result} = renderHook(() => useSshAskpass());
        emitRequest(request({id: 7}));

        await act(async () => {
            await result.current.respond(7, '1234');
        });

        expect(invokeMock).toHaveBeenCalledWith('respond_ssh_askpass', {
            id: 7,
            response: '1234',
        });
        expect(result.current.current).toBeNull();
    });

    it('respond with null forwards the cancellation', async () => {
        const {result} = renderHook(() => useSshAskpass());
        emitRequest(request({id: 3}));

        await act(async () => {
            await result.current.respond(3, null);
        });

        expect(invokeMock).toHaveBeenCalledWith('respond_ssh_askpass', {
            id: 3,
            response: null,
        });
    });

    it('removes a prompt when the backend dismisses it', () => {
        const {result} = renderHook(() => useSshAskpass());
        emitRequest(request({id: 5, kind: 'notify'}));
        expect(result.current.current?.id).toBe(5);

        act(() => {
            handlers['ssh-askpass://dismiss']({
                event: 'ssh-askpass://dismiss',
                id: 1,
                payload: 5,
            });
        });

        expect(result.current.current).toBeNull();
    });

    it('dismiss removes a prompt locally without calling the backend', () => {
        const {result} = renderHook(() => useSshAskpass());
        emitRequest(request({id: 9, kind: 'notify'}));

        act(() => {
            result.current.dismiss(9);
        });

        expect(result.current.current).toBeNull();
        expect(invokeMock).not.toHaveBeenCalled();
    });
});
