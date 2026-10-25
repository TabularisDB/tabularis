import {describe, expect, it} from 'vitest';
import type {SessionNegotiation} from '@/api/session';
import {canManageCredentialProfiles} from '@/utils/sessionAccess';

const WEB_SESSION_BASE: SessionNegotiation = {
    apiVersion: 'v1',
    serverVersion: '1.0.0',
    serverBuild: {target: 'linux-x86_64', profile: 'release', commit: null},
    authenticated: true,
    csrfToken: 'csrf',
    access: {
        remote: true,
        authorizationLevel: 'database',
        highRiskCapabilities: false,
    },
    capabilities: {
        rpc: true,
        events: true,
        uploads: true,
        downloads: true,
        pluginAssets: true,
        mcpHostConfiguration: false,
        serverFileBrowser: false,
        nativeUpdater: false,
    },
    queryResponsePolicy: {
        maxRowsPerPage: 10_000,
        maxResponseBytes: 16_777_216,
        streaming: false,
    },
};

describe('canManageCredentialProfiles', () => {
    it('allows management on the trusted desktop shell', () => {
        expect(canManageCredentialProfiles('tauri', null)).toBe(true);
    });

    it('allows management for local-admin browser sessions', () => {
        expect(
            canManageCredentialProfiles('browser', {
                ...WEB_SESSION_BASE,
                access: {
                    remote: false,
                    authorizationLevel: 'local-admin',
                    highRiskCapabilities: true,
                },
            }),
        ).toBe(true);
    });

    it('denies management for database-only remote browser sessions', () => {
        expect(canManageCredentialProfiles('browser', WEB_SESSION_BASE)).toBe(false);
    });

    it('denies management when the browser session is not negotiated yet', () => {
        expect(canManageCredentialProfiles('browser', null)).toBe(false);
    });
});
