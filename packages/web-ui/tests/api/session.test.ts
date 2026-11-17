import {describe, expect, it} from 'vitest';
import {
    MANAGED_CONNECTION_DENIED_CODE,
    resolveConnectionCapabilities,
    STANDALONE_CONNECTION_CAPABILITIES,
    type ConnectionCapabilities,
    type SessionNegotiation,
} from '@/api/session';

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

describe('resolveConnectionCapabilities', () => {
    it('is unrestricted without a session (desktop)', () => {
        expect(resolveConnectionCapabilities(null)).toBe(STANDALONE_CONNECTION_CAPABILITIES);
        expect(resolveConnectionCapabilities(undefined)).toBe(STANDALONE_CONNECTION_CAPABILITIES);
    });

    it('is unrestricted for a server that predates managed mode', () => {
        const legacy = {authenticated: true} as SessionNegotiation;
        expect(resolveConnectionCapabilities(legacy)).toEqual(STANDALONE_CONNECTION_CAPABILITIES);
    });

    it('reports exactly what the server negotiated', () => {
        const session = {authenticated: true, connections: MANAGED} as SessionNegotiation;
        expect(resolveConnectionCapabilities(session)).toEqual(MANAGED);
    });

    it('allows every action and is not managed by default', () => {
        const {managed, ...actions} = STANDALONE_CONNECTION_CAPABILITIES;
        expect(managed).toBe(false);
        expect(Object.values(actions).every(Boolean)).toBe(true);
    });
});

describe('MANAGED_CONNECTION_DENIED_CODE', () => {
    it('matches the code the backend returns', () => {
        expect(MANAGED_CONNECTION_DENIED_CODE).toBe('managed_connection_denied');
    });
});
