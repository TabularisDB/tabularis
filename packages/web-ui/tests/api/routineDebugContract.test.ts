import {describe, expect, it, vi} from 'vitest';
import type {invoke} from '@tauri-apps/api/core';
import {TauriTransport} from '@/api/transports/tauriTransport';
import {HttpTransport} from '@/api/transports/httpTransport';
import type {DebugCommand, DebugResponse} from '@/types/routineDebug';

const session = {
    apiVersion: 'v1',
    serverVersion: 'test',
    serverBuild: {target: 'test', profile: 'debug', commit: null},
    authenticated: true,
    csrfToken: 'test-csrf',
    access: {remote: false, authorizationLevel: 'database', highRiskCapabilities: false},
    capabilities: {
        rpc: true,
        events: false,
        uploads: false,
        downloads: false,
        pluginAssets: false,
        mcpHostConfiguration: false,
        nativeUpdater: false,
    },
    queryResponsePolicy: {maxRowsPerPage: 100, maxResponseBytes: 100000, streaming: false},
};
const unavailable = {state: 'unavailable', reason: 'Native debug information unavailable'} as const;
const snapshot: DebugResponse = {
    kind: 'session',
    version: 1,
    session: {
        session_id: 'debug-session',
        revision: 4,
        execution: 'failed',
        transaction: 'unknown',
        resources: 'released',
        source: unavailable,
        stop: unavailable,
        stack: unavailable,
        variables: unavailable,
        outputs: unavailable,
        breakpoints: unavailable,
        error: 'ORA-20001',
    },
};

describe.each(['desktop', 'web'] as const)('native debug contract over %s', (mode) => {
    it('preserves commands, exception/transaction/resource distinctions and partial data', async () => {
        const requests: unknown[] = [];
        const invokeNative: typeof invoke = async <T>(
            command: string,
            args?: unknown,
        ): Promise<T> => {
            expect(command).toBe('routine_debug');
            requests.push(args);
            return snapshot as T;
        };
        const fetchNative: typeof fetch = vi.fn(async (url, options) => {
            if (String(url).endsWith('/session')) return Response.json(session);
            expect(String(url)).toContain('/rpc/routine_debug');
            requests.push(JSON.parse(String(options?.body)));
            return Response.json({ok: true, data: snapshot});
        });
        const transport =
            mode === 'desktop'
                ? new TauriTransport(invokeNative)
                : new HttpTransport({fetch: fetchNative});
        for (const command of [
            {action: 'start', preview_id: 'debug-session', session_id: 'debug-session'},
            {action: 'step', session_id: 'debug-session', mode: 'over'},
            {
                action: 'read_variables',
                session_id: 'debug-session',
                frame_id: 'frame-1',
                names: ['P_VALUE'],
            },
            {action: 'stop', session_id: 'debug-session'},
        ] satisfies DebugCommand[]) {
            const request = {connectionId: 'oracle', version: 1 as const, command};
            expect(await transport.call('routine_debug', request)).toEqual(snapshot);
            expect(requests.at(-1)).toEqual(request);
        }
        expect(requests).toHaveLength(4);
    });
});
