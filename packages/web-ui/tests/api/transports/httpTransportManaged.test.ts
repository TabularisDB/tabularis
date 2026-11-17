import {describe, expect, it, vi} from 'vitest';
import {HttpTransport} from '@/api/transports/httpTransport';
import {resolveConnectionCapabilities, type ConnectionCapabilities} from '@/api/session';

const MANAGED: ConnectionCapabilities = {
    managed: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    canDuplicate: false,
    canImport: false,
    canExport: false,
    canTest: false,
    canEditBranding: false,
    canEditOrganization: true,
};

const SESSION = {
    apiVersion: 'v1',
    serverVersion: '0.32.0',
    serverBuild: {target: 'linux-x86_64', profile: 'release', commit: null},
    authenticated: true,
    csrfToken: 'csrf-token',
    access: {remote: true, authorizationLevel: 'database', highRiskCapabilities: false},
    capabilities: {
        rpc: true,
        events: true,
        uploads: true,
        downloads: false,
        pluginAssets: false,
        mcpHostConfiguration: false,
        serverFileBrowser: false,
        nativeUpdater: false,
    },
    connections: MANAGED,
    queryResponsePolicy: {maxRowsPerPage: 10_000, maxResponseBytes: 16_777_216, streaming: false},
};

const denial = {
    ok: false,
    error: {
        code: 'managed_connection_denied',
        message: 'This connection is managed by an administrator and cannot be changed here',
        details: {action: 'delete'},
        requestId: 'request-server',
    },
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'content-type': 'application/json'},
    });
}

function transport(...responses: Response[]) {
    const fetchRequest = vi.fn<typeof fetch>();
    for (const response of responses) fetchRequest.mockResolvedValueOnce(response);
    return {
        fetchRequest,
        transport: new HttpTransport({baseUrl: 'http://127.0.0.1:8080', fetch: fetchRequest}),
    };
}

describe('HttpTransport managed mode', () => {
    it('exposes the negotiated connection capabilities', async () => {
        const {transport: http} = transport(jsonResponse(SESSION));

        const session = await http.initialize();

        expect(session.connections).toEqual(MANAGED);
        expect(resolveConnectionCapabilities(session)).toEqual(MANAGED);
    });

    it('accepts a session from a server without the connections block', async () => {
        const {connections: _connections, ...legacy} = SESSION;
        const {transport: http} = transport(jsonResponse(legacy));

        const session = await http.initialize();

        expect(session.connections).toBeUndefined();
        expect(resolveConnectionCapabilities(session).managed).toBe(false);
    });

    it.each([
        ['not an object', 'managed'],
        ['a non-boolean flag', {...MANAGED, canCreate: 'yes'}],
        ['a missing flag', {managed: true}],
    ])('rejects a session whose connections block is %s', async (_label, connections) => {
        const {transport: http} = transport(jsonResponse({...SESSION, connections}));

        await expect(http.initialize()).rejects.toMatchObject({code: 'INVALID_SESSION_RESPONSE'});
    });

    it('surfaces an RPC denial with its stable code', async () => {
        const {transport: http} = transport(jsonResponse(SESSION), jsonResponse(denial, 403));

        await expect(http.call('delete_connection', {id: 'c1'})).rejects.toMatchObject({
            code: 'managed_connection_denied',
            details: {action: 'delete'},
        });
    });

    it('maps an icon upload denial to the stable code instead of an expired session', async () => {
        const {transport: http, fetchRequest} = transport(
            jsonResponse(SESSION),
            jsonResponse(denial, 403),
        );

        await expect(
            http.uploadConnectionIcon(new Blob(['png'], {type: 'image/png'})),
        ).rejects.toMatchObject({code: 'managed_connection_denied', requestId: 'request-server'});
        // Only the session and the upload: no session renewal was attempted.
        expect(fetchRequest).toHaveBeenCalledTimes(2);
    });

    it('maps a connection import upload denial to the stable code', async () => {
        const {transport: http} = transport(jsonResponse(SESSION), jsonResponse(denial, 403));

        await expect(
            http.uploadFile({
                purpose: 'connection-import',
                fileName: 'connections.json',
                contents: new Blob(['{}'], {type: 'application/json'}),
            }),
        ).rejects.toMatchObject({code: 'managed_connection_denied'});
    });

    it('still treats a plain 403 upload as an expired session', async () => {
        const {transport: http} = transport(
            jsonResponse(SESSION),
            new Response(null, {status: 403}),
            jsonResponse(SESSION),
        );

        await expect(
            http.uploadConnectionIcon(new Blob(['png'], {type: 'image/png'})),
        ).rejects.toMatchObject({code: 'SESSION_EXPIRED'});
    });
});
