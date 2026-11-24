import {describe, expect, it, vi} from 'vitest';
import {
    getCredentialProfileDependents,
    loadCredentialProfiles,
    validateCredentialProfileForm,
} from '@/utils/credentialProfiles';

describe('validateCredentialProfileForm', () => {
    const profiles = [
        {id: 'p1', name: 'Prod'},
        {id: 'p2', name: 'Dev'},
    ];

    it('rejects a name that matches another profile ignoring case', () => {
        const result = validateCredentialProfileForm(
            {name: ' prod ', username: 'user', password: 'secret'},
            {requirePassword: true, profiles},
        );
        expect(result).toEqual({
            isValid: false,
            errorKey: 'credentialProfiles.errors.nameExists',
        });
    });

    it('does not reject an unknown name', () => {
        const result = validateCredentialProfileForm(
            {name: 'Staging', username: 'user', password: 'secret'},
            {requirePassword: true, profiles},
        );
        expect(result).toEqual({isValid: true});
    });

    it('allows update to keep its own name even with a different case', () => {
        const result = validateCredentialProfileForm(
            {name: 'PROD', username: 'user'},
            {requirePassword: false, profiles, editingProfileId: 'p1'},
        );
        expect(result).toEqual({isValid: true});
    });

    it('still rejects the name of another profile during update', () => {
        const result = validateCredentialProfileForm(
            {name: 'Dev', username: 'user'},
            {requirePassword: false, profiles, editingProfileId: 'p1'},
        );
        expect(result).toEqual({
            isValid: false,
            errorKey: 'credentialProfiles.errors.nameExists',
        });
    });
});

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

describe('getCredentialProfileDependents', () => {
    // Mirrors the redacted payload `get_connections` returns: the credential
    // profile id is kept, the password is stripped by the backend.
    const connection = (id: string, name: string, credentialProfileId?: string) => ({
        id,
        name,
        params: {
            driver: 'postgres',
            database: 'db',
            credential_profile_id: credentialProfileId,
        },
    });

    it('keeps only the connections that reference the profile', async () => {
        const client = {
            call: vi
                .fn()
                .mockResolvedValue([
                    connection('c1', 'Linked A', 'profile-1'),
                    connection('c2', 'Unrelated', 'profile-2'),
                    connection('c3', 'Linked B', 'profile-1'),
                ]),
        };

        await expect(getCredentialProfileDependents('profile-1', client)).resolves.toEqual([
            {id: 'c1', name: 'Linked A'},
            {id: 'c3', name: 'Linked B'},
        ]);
        expect(client.call).toHaveBeenCalledWith('get_connections', undefined);
    });

    it('ignores connections that use inline credentials', async () => {
        const client = {
            call: vi
                .fn()
                .mockResolvedValue([connection('c1', 'Inline'), connection('c2', 'Linked', 'p1')]),
        };

        await expect(getCredentialProfileDependents('p1', client)).resolves.toEqual([
            {id: 'c2', name: 'Linked'},
        ]);
    });

    it('returns an empty list when no connection references the profile', async () => {
        const client = {call: vi.fn().mockResolvedValue([])};

        await expect(getCredentialProfileDependents('profile-1', client)).resolves.toEqual([]);
    });

    it('propagates transport failures so the confirmation can refuse to delete', async () => {
        const client = {call: vi.fn().mockRejectedValue(new Error('offline'))};

        await expect(getCredentialProfileDependents('profile-1', client)).rejects.toThrow(
            'offline',
        );
    });
});
