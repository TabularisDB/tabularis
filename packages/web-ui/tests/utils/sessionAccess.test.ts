import {describe, expect, it} from 'vitest';
import type {SessionNegotiation} from '@/api/session';
import {hasLocalAdminAccess} from '@/utils/sessionAccess';

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

describe('hasLocalAdminAccess', () => {
    it('allows management on the trusted desktop shell', () => {
        expect(hasLocalAdminAccess('tauri', null)).toBe(true);
    });

    it('allows management for local-admin browser sessions', () => {
        expect(
            hasLocalAdminAccess('browser', {
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
        expect(hasLocalAdminAccess('browser', WEB_SESSION_BASE)).toBe(false);
    });

    it('denies management when the browser session is not negotiated yet', () => {
        expect(hasLocalAdminAccess('browser', null)).toBe(false);
    });

    it('denies management when a remote session is downgraded to database authorization', () => {
        const downgraded: SessionNegotiation = {
            ...WEB_SESSION_BASE,
            access: {
                remote: true,
                authorizationLevel: 'database',
                highRiskCapabilities: false,
            },
        };
        expect(hasLocalAdminAccess('browser', downgraded)).toBe(false);
    });

    it('allows management after bootstrap negotiates local-admin access', () => {
        const elevated: SessionNegotiation = {
            ...WEB_SESSION_BASE,
            access: {
                remote: true,
                authorizationLevel: 'local-admin',
                highRiskCapabilities: true,
            },
        };
        expect(hasLocalAdminAccess('browser', elevated)).toBe(true);
    });
});
