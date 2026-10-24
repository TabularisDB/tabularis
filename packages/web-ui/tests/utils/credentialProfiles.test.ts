import {describe, expect, it, vi} from 'vitest';
import {loadCredentialProfiles} from '@/utils/credentialProfiles';

describe('loadCredentialProfiles', () => {
    it('returns an empty list when the transport response is missing or not an array', async () => {
        const client = {
            call: vi.fn().mockResolvedValue(undefined),
        };
        await expect(loadCredentialProfiles(client)).resolves.toEqual([]);
    });

    it('returns profiles from a successful list response', async () => {
        const profiles = [{id: 'p1', name: 'Shared', username: 'user'}];
        const client = {
            call: vi.fn().mockResolvedValue(profiles),
        };
        await expect(loadCredentialProfiles(client)).resolves.toEqual(profiles);
        expect(client.call).toHaveBeenCalledWith('list_credential_profiles', undefined);
    });

    it('returns an empty list when the transport call fails', async () => {
        const client = {
            call: vi.fn().mockRejectedValue(new Error('network')),
        };
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(loadCredentialProfiles(client)).resolves.toEqual([]);
        consoleError.mockRestore();
    });
});
