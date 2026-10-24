import {describe, expect, it} from 'vitest';
import {TabularisClientError} from '@/api/errors';
import {
    CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE,
    parseCredentialProfileDeleteBlockedError,
} from '@/utils/credentialProfileErrors';

describe('parseCredentialProfileDeleteBlockedError', () => {
    const payload = JSON.stringify({
        code: CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE,
        message: "Credential profile 'p1' is still used by 1 connection(s)",
        connections: [{id: 'conn-1', name: 'Linked'}],
    });

    it('parses a raw JSON error string from Tauri', () => {
        const parsed = parseCredentialProfileDeleteBlockedError(payload);
        expect(parsed?.connections).toEqual([{id: 'conn-1', name: 'Linked'}]);
    });

    it('parses JSON embedded in a TabularisClientError message from web RPC', () => {
        const error = new TabularisClientError({
            code: 'APPLICATION_ERROR',
            message: payload,
            details: null,
            requestId: 'req-1',
        });
        const parsed = parseCredentialProfileDeleteBlockedError(error);
        expect(parsed?.code).toBe(CREDENTIAL_PROFILE_DELETE_BLOCKED_CODE);
    });

    it('returns null for unrelated errors', () => {
        expect(parseCredentialProfileDeleteBlockedError('Credential profile not found')).toBeNull();
    });
});
