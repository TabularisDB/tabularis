// @vitest-environment jsdom
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useAuthRead} from '../../src/hooks/useAuthRead';

const {call} = vi.hoisted(() => ({call: vi.fn()}));
vi.mock('@tabularis/plugin-api', () => {
    const rpc = {call};
    return {usePluginRpc: () => rpc};
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return {promise, resolve, reject};
}

describe('Auth connection-scoped reads', () => {
    beforeEach(() => call.mockReset());

    it('ignores a stale search result after the query changes', async () => {
        const old = deferred<{users: string[]}>();
        call.mockImplementation((_method: string, args: {search?: string} = {}) =>
            args.search === 'old' ? old.promise : Promise.resolve({users: ['new-user']}),
        );
        const {result, rerender} = renderHook(
            ({search}) =>
                useAuthRead<{users: string[]}>('connection', 'neon_auth_users_page', {search}),
            {initialProps: {search: 'old'}},
        );
        await waitFor(() => expect(call).toHaveBeenCalledOnce());
        rerender({search: 'new'});
        await waitFor(() => expect(result.current.data).toEqual({users: ['new-user']}));
        await act(async () => {
            old.resolve({users: ['old-user']});
        });
        expect(result.current.data).toEqual({users: ['new-user']});
    });

    it('does not display another user while the selected user is loading', async () => {
        const next = deferred<{id: string}>();
        call.mockImplementation((_method: string, args: {userId?: string} = {}) =>
            args.userId === 'first' ? Promise.resolve({id: 'first'}) : next.promise,
        );
        const {result, rerender} = renderHook(
            ({userId}) =>
                useAuthRead<{id: string}>('connection', 'neon_auth_user_details', {userId}),
            {initialProps: {userId: 'first'}},
        );
        await waitFor(() => expect(result.current.data?.id).toBe('first'));
        rerender({userId: 'second'});
        expect(result.current.data).toBeUndefined();
        expect(result.current.pending).toBe(true);
        await act(async () => {
            next.resolve({id: 'second'});
        });
        expect(result.current.data?.id).toBe('second');
    });

    it('refreshes a stable request and reports read permission errors', async () => {
        call.mockResolvedValueOnce({total: 2}).mockRejectedValueOnce(
            new Error('Permission denied'),
        );
        const {result} = renderHook(() =>
            useAuthRead<{total: number}>('connection', 'neon_auth_users_page', {
                offset: 0,
                limit: 25,
            }),
        );
        await waitFor(() => expect(result.current.data?.total).toBe(2));
        act(() => result.current.reload());
        await waitFor(() => expect(result.current.error).toBe('Permission denied'));
        expect(result.current.pending).toBe(false);
        expect(call).toHaveBeenLastCalledWith('neon_auth_users_page', {offset: 0, limit: 25});
    });
});
